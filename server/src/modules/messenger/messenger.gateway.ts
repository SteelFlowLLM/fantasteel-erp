import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConnectedSocket, MessageBody, type OnGatewayConnection, type OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import {
  MESSENGER_EVENT,
  MESSENGER_SOCKET_NAMESPACE,
  type ChatMemberReadEvent,
  type ChatMessageView,
  type ChatRoomReadEvent,
  type ChatRoomUpdatedEvent,
  type PresenceChangedEvent,
  type PresenceSnapshotEvent,
  type TypingEvent,
  TYPING_SEND_INTERVAL_MS,
} from '@fantasteel/shared';
import type { Server, Socket } from 'socket.io';
import { AuthSessionEvents, type AuthRevocation } from '../../common/auth/auth-sessions';
import { AuthTokenService } from '../../common/auth/auth-token.service';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MessengerPresence } from './messenger.presence';
import { MessengerRepository } from './messenger.repository';

/** handshake에서 확인한 사원. 끊길 때·입력 중 신호에서 다시 쓴다. 접속 상태에 센 소켓에만 있다 */
interface SocketUser {
  employeeId: number;
  employeeName: string;
  /** 로그아웃한 브라우저의 소켓만 끊으려고 둔다 */
  token: string;
}

interface SocketData {
  user?: SocketUser;
  /** 토큰 만료 시각에 끊는 타이머 */
  expiryTimer?: NodeJS.Timeout;
  /** 방별로 마지막 입력 중 신호를 받은 시각 */
  typingAt?: Map<number, number>;
}

const socketDataOf = (client: Socket): SocketData => client.data as SocketData;
const socketUserOf = (client: Socket): SocketUser | undefined => socketDataOf(client).user;

/** setTimeout이 받는 최대 지연(약 24.8일). 더 먼 만료는 그때 끊지 않는다(지금 토큰은 12시간) */
const MAX_TIMER_MS = 2_147_483_647;
/** 입력 중 신호를 방마다 이 간격보다 자주 받으면 버린다. 화면은 TYPING_SEND_INTERVAL_MS마다 보내므로 그 절반 (이슈 #488) */
const TYPING_MIN_INTERVAL_MS = TYPING_SEND_INTERVAL_MS / 2;

/** 사원별 소켓 방. 채팅방이 아니라 사원 단위로 보내야 새로 초대된 방도 다시 join 없이 받는다 */
const employeeChannel = (employeeId: number) => `employee:${employeeId}`;

/**
 * 메신저 실시간 수신 (REQ-MSG-002). 보내기는 HTTP API로 하고, 저장(커밋)이 끝난 뒤 service가 여기로 알린다.
 * handshake 쿠키(access_token)로 사원을 확인하고, 아니면 연결을 끊는다 (messenger.md 4장).
 * 접속 뒤에도 토큰 만료 시각·로그아웃·퇴사 처리 때 끊는다 (이슈 #488).
 */
@WebSocketGateway({
  namespace: MESSENGER_SOCKET_NAMESPACE,
  cors: { origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(','), credentials: true },
})
export class MessengerGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessengerGateway.name);
  private readonly presence = new MessengerPresence();

  @WebSocketServer()
  private readonly server!: Server;

  private stopRevocations: (() => void) | null = null;

  constructor(
    private readonly sessions: AuthSessionEvents,
    private readonly tokens: AuthTokenService,
    private readonly users: AuthUserService,
    private readonly prisma: PrismaService,
    private readonly repository: MessengerRepository,
  ) {}

  onModuleInit(): void {
    this.stopRevocations = this.sessions.on((revocation) => void this.disconnectRevoked(revocation));
  }

  onModuleDestroy(): void {
    this.stopRevocations?.();
  }

  /** Nest는 이 promise를 기다리지 않고 버린다. 여기서 던지면 처리 안 된 rejection이 되어 서버 프로세스가 끝나므로 오류는 모두 여기서 받는다 */
  async handleConnection(client: Socket): Promise<void> {
    try {
      await this.connect(client);
    } catch (error) {
      this.logger.warn(`소켓 연결 처리 실패: ${String(error)}`);
      client.disconnect(true);
    }
  }

  private async connect(client: Socket): Promise<void> {
    const session = await this.tokens.verifyCookieSession(client.handshake.headers.cookie);
    const user = session === null ? null : await this.users.load(session.employeeId);
    if (!session || !user) {
      client.disconnect(true);
      return;
    }
    await client.join(employeeChannel(user.employeeId));
    // 여기부터는 기다리지 않는다: 확인하는 사이 끊겼으면 접속 상태에 세지 않는다(세면 handleDisconnect가 이미 지나가 온라인으로 남는다)
    if (!client.connected) return;
    const data = socketDataOf(client);
    data.user = { employeeId: user.employeeId, employeeName: user.employeeName, token: session.token };
    if (session.expiresAt !== null) {
      const left = session.expiresAt - Date.now();
      if (left <= 0) {
        client.disconnect(true);
        return;
      }
      if (left <= MAX_TIMER_MS) {
        data.expiryTimer = setTimeout(() => client.disconnect(true), left);
        data.expiryTimer.unref();
      }
    }
    // 사내 접속 상태는 메신저를 쓰는 모든 사원에게 보인다 (방 멤버로 좁히지 않는다)
    if (this.presence.connect(user.employeeId)) this.broadcast(MESSENGER_EVENT.PRESENCE_CHANGED, { employeeId: user.employeeId, online: true } satisfies PresenceChangedEvent);
    client.emit(MESSENGER_EVENT.PRESENCE_SNAPSHOT, { onlineEmployeeIds: this.presence.onlineEmployeeIds() } satisfies PresenceSnapshotEvent);
  }

  handleDisconnect(client: Socket): void {
    const data = socketDataOf(client);
    if (data.expiryTimer) clearTimeout(data.expiryTimer);
    const user = data.user;
    // 한 번만 센다 (끊김이 두 번 와도 접속 수가 어긋나지 않게)
    data.user = undefined;
    if (user && this.presence.disconnect(user.employeeId)) this.broadcast(MESSENGER_EVENT.PRESENCE_CHANGED, { employeeId: user.employeeId, online: false } satisfies PresenceChangedEvent);
  }

  /** 퇴사 처리면 그 사원의 모든 소켓, 로그아웃이면 그 토큰의 소켓을 끊는다 */
  private async disconnectRevoked(revocation: AuthRevocation): Promise<void> {
    try {
      if ('employeeId' in revocation) {
        this.server?.in(employeeChannel(revocation.employeeId)).disconnectSockets(true);
        return;
      }
      for (const socket of (await this.server?.fetchSockets()) ?? []) {
        if ((socket.data as SocketData).user?.token === revocation.token) socket.disconnect(true);
      }
    } catch (error) {
      this.logger.warn(`로그인이 끝난 소켓 끊기 실패: ${String(error)}`);
    }
  }

  /** 입력 중: 방 멤버인지 확인하고 나를 뺀 멤버에게 알린다. 저장하지 않는다. 멤버가 아니거나 형식이 틀리면 조용히 무시한다 */
  @SubscribeMessage(MESSENGER_EVENT.TYPING)
  async handleTyping(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<void> {
    const user = socketUserOf(client);
    const chatRoomId = (body as { chatRoomId?: unknown } | null)?.chatRoomId;
    if (!user || typeof chatRoomId !== 'number' || !Number.isInteger(chatRoomId)) return;
    // 화면이 정한 간격보다 자주 오면 DB를 읽지 않고 버린다 (이슈 #488)
    const data = socketDataOf(client);
    const typingAt = (data.typingAt ??= new Map());
    const now = Date.now();
    if (now - (typingAt.get(chatRoomId) ?? 0) < TYPING_MIN_INTERVAL_MS) return;
    typingAt.set(chatRoomId, now);
    if (!(await this.repository.findMembership(this.prisma, chatRoomId, user.employeeId))) return;
    const others = (await this.repository.findMemberIds(this.prisma, chatRoomId)).map((m) => m.employeeId).filter((id) => id !== user.employeeId);
    const event: TypingEvent = { chatRoomId, employeeId: user.employeeId, employeeName: user.employeeName };
    for (const employeeId of others) this.emit(employeeId, MESSENGER_EVENT.TYPING, event);
  }

  /** 입력 중 표시를 멤버에게 보낸다 (사람은 handleTyping, AI 답을 만드는 동안은 service가 부른다) */
  emitTyping(memberIds: readonly number[], event: TypingEvent): void {
    for (const employeeId of memberIds) this.emit(employeeId, MESSENGER_EVENT.TYPING, event);
  }

  /** 멤버마다 isMine이 달라서 사원별로 보낸다 */
  emitMessage(memberIds: readonly number[], toView: (employeeId: number) => ChatMessageView): void {
    for (const employeeId of memberIds) this.emit(employeeId, MESSENGER_EVENT.MESSAGE_NEW, toView(employeeId));
  }

  /** 고친·삭제한 메시지를 방 멤버에게 다시 보낸다 */
  emitMessageUpdated(memberIds: readonly number[], toView: (employeeId: number) => ChatMessageView): void {
    for (const employeeId of memberIds) this.emit(employeeId, MESSENGER_EVENT.MESSAGE_UPDATED, toView(employeeId));
  }

  /** 내 다른 탭·기기의 안 읽은 수를 맞춘다 */
  emitRead(employeeId: number, event: ChatRoomReadEvent): void {
    this.emit(employeeId, MESSENGER_EVENT.ROOM_READ, event);
  }

  /** 다른 멤버의 메시지별 안 읽은 사람 수를 맞춘다 */
  emitMemberRead(memberIds: readonly number[], event: ChatMemberReadEvent): void {
    for (const employeeId of memberIds) this.emit(employeeId, MESSENGER_EVENT.MEMBER_READ, event);
  }

  /** 방이 생기거나 멤버가 바뀌면 목록을 다시 읽게 한다 */
  emitRoomUpdated(memberIds: readonly number[], event: ChatRoomUpdatedEvent): void {
    for (const employeeId of memberIds) this.emit(employeeId, MESSENGER_EVENT.ROOM_UPDATED, event);
  }

  private broadcast(event: string, payload: unknown): void {
    try {
      this.server?.emit(event, payload);
    } catch (error) {
      this.logger.warn(`소켓 발송 실패 (${event}): ${String(error)}`);
    }
  }

  /** 소켓 발송 실패가 이미 커밋된 거래를 실패로 만들지 않게 로그만 남긴다 */
  private emit(employeeId: number, event: string, payload: unknown): void {
    try {
      this.server?.to(employeeChannel(employeeId)).emit(event, payload);
    } catch (error) {
      this.logger.warn(`소켓 발송 실패 (${event}, 사원 ${employeeId}): ${String(error)}`);
    }
  }
}
