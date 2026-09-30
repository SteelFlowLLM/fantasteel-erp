import { HttpStatus, Injectable, StreamableFile } from '@nestjs/common';
import { extname } from 'node:path';
import { CHAT_ROOM_TYPE, ERROR_CODE, MESSAGE_TYPE, NOTIFICATION_TYPE, type AuthUser } from '@fantasteel/shared';
import { AppException, badInput, notFound } from '../../common/errors/app.exception';
import { StorageService } from '../../common/storage/storage.service';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { NotificationSender } from '../notification/notification.sender';
import { ChatRoomService } from './chat-room.service';
import type { ListMessagesDto } from './dto/list-messages.dto';
import type { PostMessageDto } from './dto/post-message.dto';
import { ErpReferenceResolver } from './erp-reference.resolver';
import { parseMentions } from './mention.parser';
import { MessagePublisher } from './message.publisher';
import { MessengerRepository, type ChatRoomRow } from './messenger.repository';
import { chatRoomLinkPath, previewOf, toMessageView, type MessageView } from './messenger.views';

/** 첨부 제한 (REQ-MSG-003 — 구현 단계 결정). */
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const ATTACHMENT_MAX_LABEL = '20MB';
/** 받은 사람 PC에서 바로 실행될 수 있는 형식은 막는다. */
export const BLOCKED_ATTACHMENT_EXTENSIONS = [
  '.exe', '.msi', '.bat', '.cmd', '.com', '.scr', '.pif', '.cpl', '.dll', '.sys', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh',
  '.ps1', '.sh', '.jar', '.app', '.apk', '.dmg', '.pkg', '.deb', '.rpm', '.lnk', '.reg', '.hta',
];
const FILE_NAME_MAX_LENGTH = 200;
const DEFAULT_PAGE_SIZE = 50;

export interface UploadedAttachment {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface MessagePageView {
  /** 오래된 것 → 최신 순 */
  items: MessageView[];
  /** 더 오래된 메시지가 남아 있는지. 있으면 items[0].id를 beforeId로 다시 부른다. */
  hasMore: boolean;
}

@Injectable()
export class MessageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: MessengerRepository,
    private readonly rooms: ChatRoomService,
    private readonly publisher: MessagePublisher,
    private readonly links: ErpReferenceResolver,
    private readonly notifications: NotificationSender,
    private readonly storage: StorageService,
  ) {}

  async list(chatRoomId: number, query: ListMessagesDto, user: AuthUser): Promise<MessagePageView> {
    await this.rooms.requireMember(this.prisma, chatRoomId, user.employeeId);
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const rows = await this.repo.listMessages(this.prisma, chatRoomId, query.beforeId, limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse();
    const links = await this.links.resolveMany(this.prisma, page.map((r) => r.content));
    return { items: page.map((row, i) => toMessageView(row, links[i])), hasMore };
  }

  /** 메시지 보내기 (REQ-MSG-002): 저장 → 멘션·업무방 알림 → 커밋 뒤 멤버 전원에게 소켓 `message`. */
  async post(chatRoomId: number, dto: PostMessageDto, user: AuthUser): Promise<MessageView> {
    const content = dto.content.trim();
    if (!content) throw badInput('메시지 내용을 입력해 주세요');
    return this.prisma.tx(async (tx) => {
      const { room } = await this.rooms.requireMember(tx, chatRoomId, user.employeeId);
      const message = await this.publisher.publish(tx, {
        chatRoomId, senderId: user.employeeId, messageType: MESSAGE_TYPE.TEXT, content,
        mentionEmployeeIds: this.resolveMentions(room, user.employeeId, content, dto.mentionEmployeeIds),
      });
      await this.notify(tx, room, message, user);
      return message;
    });
  }

  /** 파일 첨부 (REQ-MSG-003). 파일은 서버를 거쳐 저장소에 넣고, 메시지에는 저장 경로만 둔다. */
  async postFile(chatRoomId: number, file: UploadedAttachment | undefined, contentInput: string | undefined, user: AuthUser): Promise<MessageView> {
    if (!file) throw badInput('첨부할 파일을 선택해 주세요');
    const fileName = file.originalname.replace(/^.*[\\/]/, '').trim().slice(0, FILE_NAME_MAX_LENGTH);
    if (!fileName) throw badInput('파일 이름이 올바르지 않습니다');
    if (file.size <= 0) throw badInput('빈 파일은 첨부할 수 없습니다');
    if (file.size > ATTACHMENT_MAX_BYTES) throw attachmentTooLarge();
    if (BLOCKED_ATTACHMENT_EXTENSIONS.includes(extname(fileName).toLowerCase())) throw badInput('실행 파일 형식은 첨부할 수 없습니다');

    // 멤버가 아닌 사람의 파일을 저장소에 남기지 않으려고 저장 전에 먼저 확인한다 (트랜잭션 안에서 한 번 더 본다)
    await this.rooms.requireMember(this.prisma, chatRoomId, user.employeeId);
    const filePath = await this.storage.save('attachments', fileName, file.buffer);
    const content = contentInput?.trim() || fileName;
    return this.prisma.tx(async (tx) => {
      const { room } = await this.rooms.requireMember(tx, chatRoomId, user.employeeId);
      const message = await this.publisher.publish(tx, {
        chatRoomId, senderId: user.employeeId, messageType: MESSAGE_TYPE.FILE, content,
        mentionEmployeeIds: this.resolveMentions(room, user.employeeId, content, undefined),
        fileName, filePath, fileSize: file.size, mimeType: file.mimetype || 'application/octet-stream',
      });
      await this.notify(tx, room, message, user);
      return message;
    });
  }

  /** 첨부 내려받기. 그 메시지가 있는 방의 멤버만. */
  async openFile(messageId: number, user: AuthUser): Promise<StreamableFile> {
    const message = await this.repo.findMessage(this.prisma, messageId);
    if (!message) throw notFound('첨부 파일');
    await this.rooms.requireMember(this.prisma, message.chatRoomId, user.employeeId);
    if (message.messageType !== MESSAGE_TYPE.FILE || !message.filePath || !this.storage.exists(message.filePath)) throw notFound('첨부 파일');
    const fileName = message.fileName ?? 'file';
    return new StreamableFile(this.storage.read(message.filePath), {
      type: message.mimeType ?? 'application/octet-stream',
      length: message.fileSize ?? undefined,
      // 한글 파일 이름을 위해 RFC 5987 형식으로 보낸다. 항상 attachment — 브라우저가 첨부를 페이지로 열지 않게.
      disposition: `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
  }

  // ───────── 내부 ─────────

  /** 멘션 대상은 방 멤버만, 보낸 사람 자신은 뺀다. 화면이 id를 주면 그것을, 아니면 내용의 `@이름`을 쓴다. */
  private resolveMentions(room: ChatRoomRow, senderId: number, content: string, given: number[] | undefined): number[] {
    const others = room.members.filter((m) => m.employeeId !== senderId);
    if (given !== undefined) {
      const memberIds = new Set(others.map((m) => m.employeeId));
      return [...new Set(given)].filter((id) => memberIds.has(id));
    }
    return parseMentions(content, others.map((m) => ({ employeeId: m.employeeId, employeeName: m.employee.employeeName })));
  }

  /**
   * 알림 연동 (REQ-MSG-005).
   * - 멘션: 멘션된 멤버에게 MENTION. 메시지마다 보낸다.
   * - 업무방 새 메시지: 나머지 멤버에게 WORK_ROOM_MESSAGE. 단, 그 방의 업무방 알림을 아직 읽지 않은 사람에게는
   *   또 보내지 않는다 (대화가 이어질 때 알림이 쌓이지 않게). 방을 끝까지 읽거나 알림을 읽으면 다음 메시지부터 다시 간다.
   * - 같은 메시지로 멘션 알림을 받은 사람에게는 업무방 알림을 겹쳐 보내지 않는다. 보낸 사람은 항상 제외.
   */
  private async notify(tx: Tx, room: ChatRoomRow, message: MessageView, user: AuthUser): Promise<void> {
    const linkPath = chatRoomLinkPath(room.id);
    const roomLabel = room.chatRoomName ?? (room.salesOrder ? `#${room.salesOrder.salesOrderNo}` : null);
    const preview = previewOf(message.content);
    const activeOthers = room.members.filter((m) => m.employeeId !== user.employeeId && m.employee.employeeStatus === 'ACTIVE').map((m) => m.employeeId);
    const mentioned = message.mentionEmployeeIds.filter((id) => activeOthers.includes(id));

    await this.notifications.toEmployees(tx, mentioned, {
      notificationType: NOTIFICATION_TYPE.MENTION,
      title: `${user.employeeName}님이 멘션했습니다`,
      body: roomLabel ? `${roomLabel} · ${preview}` : preview,
      linkPath,
      dedupeKey: `MENTION:${message.id}`,
      excludeEmployeeId: user.employeeId,
    });

    if (room.chatRoomType !== CHAT_ROOM_TYPE.WORK) return;
    const rest = activeOthers.filter((id) => !mentioned.includes(id));
    const stillUnread = new Set(await this.repo.findRecipientsWithUnreadWorkRoomNotification(tx, rest, linkPath));
    await this.notifications.toEmployees(tx, rest.filter((id) => !stillUnread.has(id)), {
      notificationType: NOTIFICATION_TYPE.WORK_ROOM_MESSAGE,
      title: `${roomLabel ?? '업무방'} 새 메시지`,
      body: `${user.employeeName}: ${preview}`,
      linkPath,
      dedupeKey: `WORK_ROOM_MESSAGE:${message.id}`,
      excludeEmployeeId: user.employeeId,
    });
  }
}

export const attachmentTooLarge = () =>
  new AppException(ERROR_CODE.COM_003, `첨부 파일은 ${ATTACHMENT_MAX_LABEL}까지 올릴 수 있습니다`, HttpStatus.PAYLOAD_TOO_LARGE);
