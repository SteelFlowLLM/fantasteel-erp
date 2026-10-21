import { Injectable } from '@nestjs/common';
import type { AiActionCardExecuteResult } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';

/** ai_action_card_run.run_status (CHECK ai_action_card_run_status_check). 공통 코드가 아니다 */
export const CARD_RUN_STATUS = { RUNNING: 'RUNNING', DONE: 'DONE' } as const;

/**
 * 🟡 RUNNING으로 남은 실행을 다시 잡을 수 있는 시간. 업무·일정·구매요청 초안 카드만 다시 잡는다: 실행과 DONE 기록이 한 트랜잭션이라
 * RUNNING이 남았으면 실행도 롤백된 것이다. 다른 카드(수주·배정·Notion 등)는 다른 모듈의 트랜잭션이라 실행됐는지 알 수 없어 다시 잡지 않는다
 */
export const CARD_RUN_STALE_MS = 10 * 60_000;

export type CardRunClaim = { state: 'claimed' } | { state: 'done'; result: AiActionCardExecuteResult } | { state: 'running' } | { state: 'unknown' } | { state: 'other-kind' };

/** 실행 카드 열쇠: 서버가 붙인 카드 번호, 없으면(이 기능 전 카드) Notion 카드 번호나 저장한 대화의 카드 자리. 사원별로 센다 */
export function cardRunKeyOf(dto: { cardId?: string; nonce?: string; chat?: { messageId: number; cardKey: string } }): string | null {
  if (dto.cardId) return dto.cardId;
  if (dto.nonce) return `notion:${dto.nonce}`;
  return dto.chat ? `chat:${dto.chat.messageId}:${dto.chat.cardKey}` : null;
}

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * 실행 카드를 한 번만 실행하게 잡는다 (이슈 #479). 더블클릭·재시도·두 탭이 같은 카드를 보내도 하나만 실행되고,
 * 끝난 카드를 다시 보내면 처음 결과를 그대로 돌려준다. 행 하나짜리 쓰기라 트랜잭션을 열지 않는다
 */
@Injectable()
export class AiActionCardRunLedger {
  constructor(private readonly prisma: PrismaService) {}

  /** reclaimStale: 실행과 DONE 기록이 한 트랜잭션인 카드만 true (멈춘 RUNNING을 다시 실행해도 겹치지 않는다) */
  async claim(cardId: string, employeeId: number, cardKind: string, reclaimStale: boolean, now: Date = new Date()): Promise<CardRunClaim> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.prisma.aiActionCardRun.create({ data: { cardId, employeeId, cardKind, runStatus: CARD_RUN_STATUS.RUNNING } });
        return { state: 'claimed' };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
      const found = await this.prisma.aiActionCardRun.findUnique({ where: { employeeId_cardId: { employeeId, cardId } } });
      // 잡은 쪽이 실패해 그 사이 지웠으면 한 번 더 잡아 본다
      if (!found) continue;
      if (found.cardKind !== cardKind) return { state: 'other-kind' };
      if (found.runStatus === CARD_RUN_STATUS.DONE && found.result !== null) return { state: 'done', result: found.result as unknown as AiActionCardExecuteResult };
      if (found.updatedAt.getTime() > now.getTime() - CARD_RUN_STALE_MS) return { state: 'running' };
      // 실행됐는지 알 수 없는 카드는 다시 실행하지 않는다 (두 번 만들지 않게)
      if (!reclaimStale) return { state: 'unknown' };
      // 멈춘 실행: 내가 읽은 그 행일 때만 다시 잡는다 (두 요청이 함께 다시 잡지 않게)
      const { count } = await this.prisma.aiActionCardRun.updateMany({
        where: { id: found.id, runStatus: CARD_RUN_STATUS.RUNNING, updatedAt: found.updatedAt },
        data: { updatedAt: now },
      });
      return count === 1 ? { state: 'claimed' } : { state: 'running' };
    }
    return { state: 'running' };
  }

  /** 실행이 커밋된 뒤 기록한다 (업무 트랜잭션 밖의 카드). tx를 주면 실행과 같은 트랜잭션에서 기록한다 */
  async finish(cardId: string, employeeId: number, result: AiActionCardExecuteResult, tx: Tx = this.prisma): Promise<void> {
    await tx.aiActionCardRun.updateMany({ where: { employeeId, cardId }, data: { runStatus: CARD_RUN_STATUS.DONE, result: result as unknown as Prisma.InputJsonObject } });
  }

  /** 실행하지 않은 것이 확실할 때 잡기를 푼다 (다시 실행할 수 있게) */
  async release(cardId: string, employeeId: number): Promise<void> {
    await this.prisma.aiActionCardRun.deleteMany({ where: { employeeId, cardId, runStatus: CARD_RUN_STATUS.RUNNING } });
  }
}
