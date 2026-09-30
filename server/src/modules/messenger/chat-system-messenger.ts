import { Injectable } from '@nestjs/common';
import { MESSAGE_TYPE } from '@fantasteel/shared';
import type { Tx } from '../../prisma/prisma.service';
import { MessagePublisher } from './message.publisher';
import { MessengerRepository } from './messenger.repository';

export interface SystemMessageInput {
  salesOrderId: number;
  /** 업무방에 남길 한 줄. 예: "출고 확정: 슬래브 6매 (GI-20260930-0001)". 수주·LOT 번호를 넣으면 링크가 붙는다. */
  content: string;
}

/**
 * 다른 모듈이 수주 업무방에 시스템 메시지를 남길 때 쓴다 (전역 제공 — import 없이 주입).
 *
 *   await this.chatSystem.post(tx, { salesOrderId, content: '생산계획 PP-… 편성 확정' });
 *
 * - 본 거래와 같은 tx를 넘긴다. 롤백되면 메시지도 남지 않고, 실시간 전달은 커밋 뒤에 나간다.
 * - 그 수주의 업무방이 없으면 아무것도 하지 않고 null을 돌려준다 (방을 새로 만들지 않는다).
 * - sender는 null, message_type = SYSTEM. 안 읽은 수에는 들어가지만 알림은 만들지 않는다
 *   (업무 알림은 부르는 모듈이 NotificationSender로 따로 보낸다).
 */
@Injectable()
export class ChatSystemMessenger {
  constructor(
    private readonly repo: MessengerRepository,
    private readonly publisher: MessagePublisher,
  ) {}

  /** @returns 만들어진 메시지 id, 업무방이 없으면 null */
  async post(tx: Tx, input: SystemMessageInput): Promise<number | null> {
    const content = input.content.trim();
    if (!content) return null;
    const room = await this.repo.findWorkRoom(tx, input.salesOrderId);
    if (!room) return null;
    const message = await this.publisher.publish(tx, { chatRoomId: room.id, senderId: null, messageType: MESSAGE_TYPE.SYSTEM, content });
    return message.id;
  }
}
