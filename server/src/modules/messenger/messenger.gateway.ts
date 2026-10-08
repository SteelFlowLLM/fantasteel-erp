import { Logger } from '@nestjs/common';
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
} from '@fantasteel/shared';
import type { Server, Socket } from 'socket.io';
import { AuthTokenService } from '../../common/auth/auth-token.service';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MessengerPresence } from './messenger.presence';
import { MessengerRepository } from './messenger.repository';

/** handshake에서 확인한 사원. 끊길 때·입력 중 신호에서 다시 쓴다 */
interface SocketUser {
  employeeId: number;
  employeeName: string;
}

const socketUserOf = (client: Socket): SocketUser | undefined => (client.data as { user?: SocketUser }).user;

/** 사원별 소켓 방. 채팅방이 아니라 사원 단위로 보내야 새로 초대된 방도 다시 join 없이 받는다 */
const employeeChannel = (employeeId: number) => `employee:${employeeId}`;

/**
 * 메신저 실시간 수신 (REQ-MSG-002). 보내기는 HTTP API로 하고, 저장(커밋)이 끝난 뒤 service가 여기로 알린다.
 * handshake 쿠키(access_token)로 사원을 확인하고, 아니면 연결을 끊는다 (messenger.md 4장).
 */
@WebSocketGateway({
  namespace: MESSENGER_SOCKET_NAMESPACE,
  cors: { origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(','), credentials: true },
})
export class MessengerGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(MessengerGateway.name);
  private readonly presence = new MessengerPresence();

  @WebSocketServer()
  private readonly server!: Server;

  constructor(
    private readonly tokens: AuthTokenService,
    private readonly users: AuthUserService,
    private readonly prisma: PrismaService,
    private readonly repository: MessengerRepository,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const employeeId = await this.tokens.verifyCookieHeader(client.handshake.headers.cookie);
    const user = employeeId === null ? null : await this.users.load(employeeId);
    if (!user) {
      client.disconnect(true);
      return;
    }
    (client.data as { user?: SocketUser }).user = { employeeId: user.employeeId, employeeName: user.employeeName };
    await client.join(employeeChannel(user.employeeId));
    // 사내 접속 상태는 메신저를 쓰는 모든 사원에게 보인다 (방 멤버로 좁히지 않는다)
    if (this.presence.connect(user.employeeId)) this.broadcast(MESSENGER_EVENT.PRESENCE_CHANGED, { employeeId: user.employeeId, online: true } satisfies PresenceChangedEvent);
    client.emit(MESSENGER_EVENT.PRESENCE_SNAPSHOT, { onlineEmployeeIds: this.presence.onlineEmployeeIds() } satisfies PresenceSnapshotEvent);
  }

  handleDisconnect(client: Socket): void {
    const user = socketUserOf(client);
    if (user && this.presence.disconnect(user.employeeId)) this.broadcast(MESSENGER_EVENT.PRESENCE_CHANGED, { employeeId: user.employeeId, online: false } satisfies PresenceChangedEvent);
  }

  /** 입력 중: 방 멤버인지 확인하고 나를 뺀 멤버에게 알린다. 저장하지 않는다. 멤버가 아니거나 형식이 틀리면 조용히 무시한다 */
  @SubscribeMessage(MESSENGER_EVENT.TYPING)
  async handleTyping(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<void> {
    const user = socketUserOf(client);
    const chatRoomId = (body as { chatRoomId?: unknown } | null)?.chatRoomId;
    if (!user || typeof chatRoomId !== 'number' || !Number.isInteger(chatRoomId)) return;
    if (!(await this.repository.findMembership(this.prisma, chatRoomId, user.employeeId))) return;
    const others = (await this.repository.findMemberIds(this.prisma, chatRoomId)).map((m) => m.employeeId).filter((id) => id !== user.employeeId);
    const event: TypingEvent = { chatRoomId, employeeId: user.employeeId, employeeName: user.employeeName };
    for (const employeeId of others) this.emit(employeeId, MESSENGER_EVENT.TYPING, event);
  }

  /** 멤버마다 isMine이 달라서 사원별로 보낸다 */
  emitMessage(memberIds: readonly number[], toView: (employeeId: number) => ChatMessageView): void {
    for (const employeeId of memberIds) this.emit(employeeId, MESSENGER_EVENT.MESSAGE_NEW, toView(employeeId));
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
