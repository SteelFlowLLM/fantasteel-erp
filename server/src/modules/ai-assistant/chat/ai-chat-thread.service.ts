import { Injectable } from '@nestjs/common';
import type {
  AiActionCardExecuteResult,
  AiAssistantReplyView,
  AiAssistantTurn,
  AiChatCardRef,
  AiChatThreadRef,
  AiChatThreadSummaryView,
  AiChatThreadView,
  AuthUser,
  PageResult,
} from '@fantasteel/shared';
import type { Prisma } from '../../../generated/prisma/client';
import { AppException } from '../../../common/errors/app.exception';
import { PrismaService, type Tx } from '../../../prisma/prisma.service';
import { MAX_HISTORY_TURNS } from '../assistant.prompt';
import type { HistorySearchSource } from '../history/chat-memory';
import { AiChatThreadRepository } from './ai-chat-thread.repository';
import { AI_CHAT_ROLE, answerMeta, cardsWithDone, chatHistoryTurns, chatThreadTitle, questionMeta, readyCards, toChatMessageView, toChatThreadSummary, type AiChatQuestionInput } from './ai-chat-thread.view';

const asJson = (value: unknown) => value as Prisma.InputJsonValue;

/**
 * 철강맨AI 패널 대화 저장 (이슈 #399, 문서에 없는 기능). 본인 대화만 다루고, 남의 대화는 없는 것처럼 AST-001.
 * 답이 끝났을 때 질문과 답을 한 트랜잭션으로 저장한다. 생각 글·도구 기록·사진·브라우저 화면 사진은 저장하지 않는다(docs/backend/ai-assistant.md).
 * AI 대화라 업무 데이터가 아니므로 작업 로그를 남기지 않는다(REQ-LOG-002 대상 아님).
 */
@Injectable()
export class AiChatThreadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: AiChatThreadRepository,
  ) {}

  async list(user: AuthUser, query: { page?: number; size?: number }): Promise<PageResult<AiChatThreadSummaryView>> {
    const page = query.page ?? 1;
    const size = query.size ?? 20;
    const [rows, total] = await Promise.all([this.repository.list(this.prisma, user.employeeId, size, (page - 1) * size), this.repository.countByEmployee(this.prisma, user.employeeId)]);
    return { items: rows.map(toChatThreadSummary), page, size, total };
  }

  async get(user: AuthUser, id: number): Promise<AiChatThreadView> {
    const thread = await this.owned(this.prisma, user, id);
    const messages = await this.repository.findMessages(this.prisma, thread.id);
    return { ...toChatThreadSummary(thread), messages: messages.map(toChatMessageView) };
  }

  /** 대화와 메시지를 모두 지운다 (되살릴 수 없다) */
  delete(user: AuthUser, id: number): Promise<AiChatThreadSummaryView> {
    return this.prisma.$transaction(async (tx) => {
      await this.repository.lock(tx, id);
      const thread = await this.owned(tx, user, id);
      await this.repository.deleteThread(tx, thread.id);
      return toChatThreadSummary(thread);
    });
  }

  /** 이어 묻는 대화의 지난 대화 (최근 take줄, 오래된 것부터). 화면이 보낸 history 대신 쓴다. take는 모델 문맥 길이로 정한다(이슈 #412) */
  async historyFor(user: AuthUser, threadId: number, take: number = MAX_HISTORY_TURNS): Promise<AiAssistantTurn[]> {
    const thread = await this.owned(this.prisma, user, threadId);
    const recent = await this.repository.findRecentMessages(this.prisma, thread.id, take);
    return chatHistoryTurns(recent.reverse());
  }

  /** 지난 대화 찾기(이슈 #412): 내 저장한 대화만, 새것부터. 대화 제목을 함께 준다 */
  searchSource(user: AuthUser): HistorySearchSource {
    return {
      kind: 'chat',
      search: async (words, limit) => {
        const rows = await this.repository.searchMessages(this.prisma, user.employeeId, words, limit);
        return rows.map((row) => ({ at: row.createdAt, who: row.role === AI_CHAT_ROLE.USER ? '나' : '철강맨AI', where: row.thread.title, text: row.content }));
      },
    };
  }

  /** 질문과 답 한 쌍을 저장한다. threadId가 없으면 첫 질문으로 제목을 지어 새 대화를 만든다 */
  saveTurn(user: AuthUser, threadId: number | undefined, input: AiChatQuestionInput, reply: AiAssistantReplyView): Promise<AiChatThreadRef> {
    return this.prisma.$transaction(async (tx) => {
      let thread: { id: number; title: string };
      let lastSeq = 0;
      if (threadId === undefined) {
        thread = await this.repository.createThread(tx, user.employeeId, chatThreadTitle(input.question));
      } else {
        await this.repository.lock(tx, threadId);
        // 답을 기다리는 사이에 지웠으면 AST-001 (다시 만들지 않는다)
        thread = await this.owned(tx, user, threadId);
        lastSeq = await this.repository.lastSeq(tx, thread.id);
        await this.repository.touch(tx, thread.id);
      }
      const meta = questionMeta(input);
      await this.repository.createMessage(tx, { threadId: thread.id, seq: lastSeq + 1, role: AI_CHAT_ROLE.USER, content: input.question, ...(meta ? { meta } : {}) });
      const replyMeta = answerMeta(input.reasoning, reply);
      const answer = await this.repository.createMessage(tx, {
        threadId: thread.id,
        seq: lastSeq + 2,
        role: AI_CHAT_ROLE.ASSISTANT,
        content: reply.answer,
        sources: asJson(reply.sources),
        ...(reply.webSources ? { webSources: asJson(reply.webSources) } : {}),
        ...(reply.actionCards.length ? { actionCards: asJson(readyCards(reply.actionCards)) } : {}),
        ...(replyMeta ? { meta: replyMeta } : {}),
      });
      return { id: thread.id, title: thread.title, assistantMessageId: answer.id };
    });
  }

  /** 저장한 카드를 실행됨으로 바꾼다. 내 답이 아니거나 그 카드가 없으면 AST-001, 이미 실행됨이면 그대로 둔다 */
  async markCardDone(user: AuthUser, ref: AiChatCardRef, registered: AiActionCardExecuteResult['registered']): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const found = await this.repository.findOwnedAnswer(tx, ref.messageId, user.employeeId, AI_CHAT_ROLE.ASSISTANT);
      if (!found) throw new AppException('AST-001');
      await this.repository.lock(tx, found.threadId);
      // 잠근 뒤에 다시 읽는다 (같은 답의 다른 카드를 함께 실행해도 서로 덮어쓰지 않게)
      const answer = await this.repository.findOwnedAnswer(tx, ref.messageId, user.employeeId, AI_CHAT_ROLE.ASSISTANT);
      if (!answer) throw new AppException('AST-001');
      const cards = cardsWithDone(answer.actionCards, ref.cardKey, registered);
      if (cards) await this.repository.updateActionCards(tx, answer.id, asJson(cards));
    });
  }

  private async owned(tx: Tx, user: AuthUser, id: number) {
    const thread = await this.repository.findOwned(tx, id, user.employeeId);
    if (!thread) throw new AppException('AST-001');
    return thread;
  }
}
