import { Injectable } from '@nestjs/common';
import { serialize } from '../../common/http/response.interceptor';
import { RealtimeService } from '../../common/realtime/realtime.service';
import type { Tx } from '../../prisma/prisma.service';
import { ErpReferenceResolver } from './erp-reference.resolver';
import { MessengerRepository, type NewMessage } from './messenger.repository';
import { toMessageView, type MessageView } from './messenger.views';

export const SOCKET_EVENT_MESSAGE = 'message';
export const SOCKET_EVENT_CHAT_READ = 'chat-read';

/** 메시지를 저장하고 방 멤버 전원의 채널로 내보낸다. 사람·파일·시스템 메시지가 모두 이 한 곳을 지난다. */
@Injectable()
export class MessagePublisher {
  constructor(
    private readonly repo: MessengerRepository,
    private readonly links: ErpReferenceResolver,
    private readonly realtime: RealtimeService,
  ) {}

  /** 반드시 트랜잭션 안에서 부른다. 소켓 전달은 커밋 뒤에 나간다 (보낸 사람의 다른 창도 받는다). */
  async publish(tx: Tx, input: NewMessage): Promise<MessageView> {
    const row = await this.repo.createMessage(tx, input);
    const view = toMessageView(row, await this.links.resolve(tx, row.content));
    const memberIds = await this.repo.findMemberIds(tx, input.chatRoomId);
    // REST 응답과 같은 모양(Date → ISO)으로 보낸다
    this.realtime.toEmployees(memberIds, SOCKET_EVENT_MESSAGE, serialize(view));
    return view;
  }
}
