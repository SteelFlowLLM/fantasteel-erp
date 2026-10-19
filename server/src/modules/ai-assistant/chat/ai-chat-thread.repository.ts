import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { lockAiChatThread } from '../../../generated/prisma/sql';
import type { Tx } from '../../../prisma/prisma.service';

/** 저장한 대화(이슈 #399)의 DB 접근. 함수의 첫 인자는 tx (컨벤션 8장) */
@Injectable()
export class AiChatThreadRepository {
  countByEmployee(tx: Tx, employeeId: number) {
    return tx.aiChatThread.count({ where: { employeeId } });
  }

  list(tx: Tx, employeeId: number, take: number, skip: number) {
    return tx.aiChatThread.findMany({ where: { employeeId }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take, skip });
  }

  findOwned(tx: Tx, id: number, employeeId: number) {
    return tx.aiChatThread.findFirst({ where: { id, employeeId } });
  }

  findMessages(tx: Tx, threadId: number) {
    return tx.aiChatMessage.findMany({ where: { threadId }, orderBy: { seq: 'asc' } });
  }

  /** 최근 take개 (새것부터) */
  findRecentMessages(tx: Tx, threadId: number, take: number) {
    return tx.aiChatMessage.findMany({ where: { threadId }, orderBy: { seq: 'desc' }, take, select: { role: true, content: true, meta: true } });
  }

  async lastSeq(tx: Tx, threadId: number): Promise<number> {
    const { _max } = await tx.aiChatMessage.aggregate({ where: { threadId }, _max: { seq: true } });
    return _max.seq ?? 0;
  }

  createThread(tx: Tx, employeeId: number, title: string) {
    return tx.aiChatThread.create({ data: { employeeId, title } });
  }

  /** 마지막으로 묻고 답한 시각을 지금으로 (목록 순서) */
  touch(tx: Tx, id: number) {
    return tx.aiChatThread.update({ where: { id }, data: { updatedAt: new Date() } });
  }

  createMessage(tx: Tx, data: Prisma.AiChatMessageUncheckedCreateInput) {
    return tx.aiChatMessage.create({ data, select: { id: true } });
  }

  /** 내 대화의 답 한 줄 (카드 상태를 바꿀 때) */
  findOwnedAnswer(tx: Tx, messageId: number, employeeId: number, role: string) {
    return tx.aiChatMessage.findFirst({ where: { id: messageId, role, thread: { employeeId } }, select: { id: true, threadId: true, actionCards: true } });
  }

  updateActionCards(tx: Tx, messageId: number, actionCards: Prisma.InputJsonValue) {
    return tx.aiChatMessage.update({ where: { id: messageId }, data: { actionCards } });
  }

  /** 메시지가 남아 있으면 대화를 지울 수 없어서(Restrict) 메시지를 먼저 지운다 */
  async deleteThread(tx: Tx, id: number): Promise<void> {
    await tx.aiChatMessage.deleteMany({ where: { threadId: id } });
    await tx.aiChatThread.delete({ where: { id } });
  }

  /** 같은 대화를 트랜잭션이 끝날 때까지 잠근다 (순번·카드 상태가 겹치지 않게) */
  async lock(tx: Tx, threadId: number): Promise<void> {
    await tx.$queryRawTyped(lockAiChatThread(threadId));
  }
}
