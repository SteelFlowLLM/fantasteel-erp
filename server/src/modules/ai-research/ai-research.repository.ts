import { Injectable } from '@nestjs/common';
import { AI_RESEARCH_STATUS, type AiResearchEventPayloads, type AiResearchEventType, type AiResearchStatus } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { listAiResearchRuns } from '../../generated/prisma/sql';
import type { Tx } from '../../prisma/prisma.service';

/** 진행 중(끝나지 않은) 상태. 사원별 동시 진행 수를 셀 때 쓴다 */
export const ACTIVE_STATUSES: AiResearchStatus[] = [AI_RESEARCH_STATUS.PLANNING, AI_RESEARCH_STATUS.AWAITING_APPROVAL, AI_RESEARCH_STATUS.QUEUED, AI_RESEARCH_STATUS.RUNNING];
/** 일꾼이 맡을 수 있는 상태 (RUNNING은 맡은 표시가 끊긴 것만) */
const CLAIMABLE_STATUSES: AiResearchStatus[] = [AI_RESEARCH_STATUS.PLANNING, AI_RESEARCH_STATUS.QUEUED, AI_RESEARCH_STATUS.RUNNING];

export type NewResearchEvent = { [K in AiResearchEventType]: { type: K; payload: AiResearchEventPayloads[K] } }[AiResearchEventType];

/** 사용자 동작과 일꾼이 같은 조사에 이벤트를 동시에 붙이면 순번 unique가 겹친다. 트랜잭션을 통째로 다시 한다 */
export async function retryOnSeqConflict<T>(work: () => Promise<T>, tries = 3): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      const conflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
      if (!conflict || attempt >= tries) throw error;
    }
  }
}

const leaseFree = (now: Date): Prisma.AiResearchRunWhereInput => ({ OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] });

@Injectable()
export class AiResearchRepository {
  create(tx: Tx, data: { employeeId: number; question: string; budget: Prisma.InputJsonObject }) {
    return tx.aiResearchRun.create({ data: { ...data, status: AI_RESEARCH_STATUS.PLANNING } });
  }

  findById(tx: Tx, id: number) {
    return tx.aiResearchRun.findUnique({ where: { id } });
  }

  countActive(tx: Tx, employeeId: number) {
    return tx.aiResearchRun.count({ where: { employeeId, status: { in: ACTIVE_STATUSES } } });
  }

  countByEmployee(tx: Tx, employeeId: number) {
    return tx.aiResearchRun.count({ where: { employeeId } });
  }

  list(tx: Tx, employeeId: number, limit: number, offset: number) {
    return tx.$queryRawTyped(listAiResearchRuns(employeeId, limit, offset));
  }

  eventsAfter(tx: Tx, runId: number, afterSeq: number) {
    return tx.aiResearchEvent.findMany({ where: { runId, seq: { gt: afterSeq } }, orderBy: { seq: 'asc' }, take: 500 });
  }

  async lastSeq(tx: Tx, runId: number): Promise<number> {
    const last = await tx.aiResearchEvent.findFirst({ where: { runId }, orderBy: { seq: 'desc' }, select: { seq: true } });
    return last?.seq ?? 0;
  }

  /** 순번을 이어 붙인다. 같은 순번이 겹치면(unique) 부르는 쪽이 트랜잭션을 다시 한다 */
  async appendEvents(tx: Tx, runId: number, events: readonly NewResearchEvent[]) {
    if (!events.length) return;
    const start = (await this.lastSeq(tx, runId)) + 1;
    await tx.aiResearchEvent.createMany({ data: events.map((e, i) => ({ runId, seq: start + i, type: e.type, payload: e.payload as Prisma.InputJsonObject })) });
  }

  /** 사용자 동작(계획 고치기·시작·더 조사·취소): 내 조사이고 상태(·계획 판)가 맞을 때만 바꾼다 */
  updateOwned(tx: Tx, where: { id: number; employeeId: number; status: AiResearchStatus[]; planRevision?: number; updatedAt?: Date }, data: Prisma.AiResearchRunUncheckedUpdateManyInput) {
    const { status, ...rest } = where;
    return tx.aiResearchRun.updateMany({ where: { ...rest, status: { in: status } }, data });
  }

  /** 맡을 후보 (오래된 것부터). 맡기는 claim이 조건부로 한다 */
  findClaimable(tx: Tx, now: Date, take: number) {
    return tx.aiResearchRun.findMany({
      where: { status: { in: CLAIMABLE_STATUSES }, ...leaseFree(now) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, status: true },
      take,
    });
  }

  /** 상태가 그대로이고 아무도 맡지 않았을(표시가 끊겼을) 때만 맡는다. QUEUED는 RUNNING이 된다 */
  claim(tx: Tx, id: number, status: AiResearchStatus, owner: string, now: Date, expiresAt: Date) {
    return tx.aiResearchRun.updateMany({
      where: { id, status, ...leaseFree(now) },
      data: { leaseOwner: owner, leaseExpiresAt: expiresAt, ...(status === AI_RESEARCH_STATUS.QUEUED ? { status: AI_RESEARCH_STATUS.RUNNING } : {}) },
    });
  }

  /** 내가 맡은 행만 바꾼다 (그 사이 취소됐거나 남이 맡았으면 0건) */
  updateLeased(tx: Tx, id: number, owner: string, status: AiResearchStatus, data: Prisma.AiResearchRunUncheckedUpdateManyInput) {
    return tx.aiResearchRun.updateMany({ where: { id, leaseOwner: owner, status }, data });
  }

  renewLease(tx: Tx, id: number, owner: string, expiresAt: Date) {
    return tx.aiResearchRun.updateMany({ where: { id, leaseOwner: owner, status: { in: [AI_RESEARCH_STATUS.PLANNING, AI_RESEARCH_STATUS.RUNNING] } }, data: { leaseExpiresAt: expiresAt } });
  }
}
