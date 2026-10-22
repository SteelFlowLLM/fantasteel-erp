import { Injectable } from '@nestjs/common';
import { AI_RESEARCH_STATUS, type AiResearchEventPayloads, type AiResearchEventType, type AiResearchSeed, type AiResearchStatus } from '@fantasteel/shared';
import { Prisma, type AiResearchSchedule } from '../../generated/prisma/client';
import { claimAiResearchRun, claimAiResearchSchedule, findClaimableAiResearchRuns, findDueAiResearchSchedules, listAiResearchRuns, lockAiResearchEmployee, renewAiResearchLease } from '../../generated/prisma/sql';
import { seedSources, storedPlan } from './ai-research.rules';
import type { Tx } from '../../prisma/prisma.service';

/** 진행 중(끝나지 않은) 상태. 사원별 동시 진행 수를 셀 때 쓴다 */
export const ACTIVE_STATUSES: AiResearchStatus[] = [AI_RESEARCH_STATUS.PLANNING, AI_RESEARCH_STATUS.AWAITING_APPROVAL, AI_RESEARCH_STATUS.QUEUED, AI_RESEARCH_STATUS.RUNNING];

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

/** seed와 그 출처를 저장할 열로 (없으면 빈 객체: 열 기본값을 쓴다) */
export function seedColumns(seed: AiResearchSeed | null): { seed?: Prisma.InputJsonObject; sources?: Prisma.InputJsonArray } {
  if (!seed) return {};
  return { seed: seed as unknown as Prisma.InputJsonObject, sources: seedSources(seed) as unknown as Prisma.InputJsonArray };
}

/** 반복과 반복을 건 조사의 제목 (계획 제목, 없으면 질문) */
export type ScheduleWithRun = AiResearchSchedule & { title: string };

@Injectable()
export class AiResearchRepository {
  /** seed가 있으면 그 출처를 조사 출처로 함께 넣는다 (이슈 #408) */
  create(tx: Tx, data: { employeeId: number; question: string; budget: Prisma.InputJsonObject; seed?: Prisma.InputJsonObject; sources?: Prisma.InputJsonArray }) {
    return tx.aiResearchRun.create({ data: { ...data, status: AI_RESEARCH_STATUS.PLANNING } });
  }

  /** 다시 조사: 가져온 계획으로 계획 확인 대기부터 (계획 세우기를 건너뛴다) */
  createPlanned(
    tx: Tx,
    data: { employeeId: number; question: string; budget: Prisma.InputJsonObject; plan: Prisma.InputJsonObject; researchState: Prisma.InputJsonObject; seed?: Prisma.InputJsonObject; sources?: Prisma.InputJsonArray },
  ) {
    return tx.aiResearchRun.create({ data: { ...data, status: AI_RESEARCH_STATUS.AWAITING_APPROVAL, planRevision: 1 } });
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

  /** 맡을 후보 (오래된 것부터). 맡기는 claim이 조건부로 한다. 시각은 DB의 now() */
  findClaimable(tx: Tx, take: number) {
    return tx.$queryRawTyped(findClaimableAiResearchRuns(take));
  }

  /** 상태가 그대로이고 아무도 맡지 않았을(표시가 끊겼을) 때만 맡는다. QUEUED는 RUNNING이 된다. 맡았으면 true */
  async claim(tx: Tx, id: number, status: AiResearchStatus, owner: string, leaseMs: number): Promise<boolean> {
    return (await tx.$queryRawTyped(claimAiResearchRun(id, status, owner, leaseMs))).length === 1;
  }

  /** 내가 맡은 행만 바꾼다 (그 사이 취소됐거나 남이 맡았으면 0건) */
  updateLeased(tx: Tx, id: number, owner: string, status: AiResearchStatus, data: Prisma.AiResearchRunUncheckedUpdateManyInput) {
    return tx.aiResearchRun.updateMany({ where: { id, leaseOwner: owner, status }, data });
  }

  /** 표시를 지금(DB now()) + leaseMs로. 내가 맡은 계획·조사 중 행이 아니면 false */
  async renewLease(tx: Tx, id: number, owner: string, leaseMs: number): Promise<boolean> {
    return (await tx.$queryRawTyped(renewAiResearchLease(id, owner, leaseMs))).length === 1;
  }

  /** Notion 내보내기 잡기 (이슈 #521부터 다시 내보낼 수 있다): 완료한 내 조사이고, 아무도 잡지 않았거나 잡은 지 오래됐을 때만 */
  claimNotionExport(tx: Tx, id: number, employeeId: number, claimedAt: Date, staleBefore: Date) {
    return tx.aiResearchRun.updateMany({
      where: { id, employeeId, status: AI_RESEARCH_STATUS.COMPLETED, OR: [{ notionExportClaimedAt: null }, { notionExportClaimedAt: { lt: staleBefore } }] },
      data: { notionExportClaimedAt: claimedAt },
    });
  }

  /** 내가 잡은 내보내기만 끝낸다: 마지막 페이지 주소·시각·판을 남기고 잡기를 푼다 */
  finishNotionExport(tx: Tx, id: number, claimedAt: Date, done: { notionPageUrl: string; exportedAt: Date; version: number | null }) {
    return tx.aiResearchRun.updateMany({
      where: { id, notionExportClaimedAt: claimedAt },
      data: { notionPageUrl: done.notionPageUrl, notionExportedAt: done.exportedAt, notionExportedVersion: done.version, notionExportClaimedAt: null },
    });
  }

  /** 내보내기가 실패하면 잡은 것을 푼다 */
  releaseNotionExport(tx: Tx, id: number, claimedAt: Date) {
    return tx.aiResearchRun.updateMany({ where: { id, notionExportClaimedAt: claimedAt }, data: { notionExportClaimedAt: null } });
  }

  /** 보고서 판 목록 (본문 없이, 오래된 것부터, 이슈 #418) */
  listVersions(tx: Tx, runId: number) {
    return tx.aiResearchReportVersion.findMany({ where: { runId }, orderBy: { version: 'asc' }, select: { version: true, instruction: true, search: true, createdAt: true } });
  }

  findVersion(tx: Tx, runId: number, version: number) {
    return tx.aiResearchReportVersion.findUnique({ where: { runId_version: { runId, version } } });
  }

  async lastVersion(tx: Tx, runId: number): Promise<number> {
    const last = await tx.aiResearchReportVersion.findFirst({ where: { runId }, orderBy: { version: 'desc' }, select: { version: true } });
    return last?.version ?? 0;
  }

  createVersion(tx: Tx, data: { runId: number; version: number; instruction: string | null; search: boolean; report: string; charts: Prisma.InputJsonValue }) {
    return tx.aiResearchReportVersion.create({ data });
  }

  /** 사원별 잠금 (트랜잭션이 끝날 때까지). 진행 중 수를 세고 만드는 사이에 다른 요청이 끼지 못하게 */
  async lockEmployee(tx: Tx, employeeId: number): Promise<void> {
    await tx.$queryRawTyped(lockAiResearchEmployee(employeeId));
  }

  // ───────────────────────────── 반복 (이슈 #521) ─────────────────────────────

  /** 반복이 차례에 만든 조사: 계획 확인 없이(이미 승인한 계획) 바로 차례를 기다린다 */
  createScheduled(
    tx: Tx,
    data: { employeeId: number; question: string; budget: Prisma.InputJsonObject; plan: Prisma.InputJsonObject; researchState: Prisma.InputJsonObject; scheduleId: number; seed?: Prisma.InputJsonObject; sources?: Prisma.InputJsonArray },
  ) {
    return tx.aiResearchRun.create({ data: { ...data, status: AI_RESEARCH_STATUS.QUEUED, planRevision: 1 } });
  }

  async findScheduleById(tx: Tx, id: number): Promise<ScheduleWithRun | null> {
    const row = await tx.aiResearchSchedule.findUnique({ where: { id } });
    return row ? (await this.withTitles(tx, [row]))[0] : null;
  }

  async findScheduleByRunId(tx: Tx, runId: number): Promise<ScheduleWithRun | null> {
    const row = await tx.aiResearchSchedule.findUnique({ where: { runId } });
    return row ? (await this.withTitles(tx, [row]))[0] : null;
  }

  /** 내 반복 (켜진 것 먼저, 다음 차례가 빠른 것부터) */
  async listSchedules(tx: Tx, employeeId: number): Promise<ScheduleWithRun[]> {
    return this.withTitles(tx, await tx.aiResearchSchedule.findMany({ where: { employeeId }, orderBy: [{ enabled: 'desc' }, { nextRunAt: 'asc' }, { id: 'asc' }] }));
  }

  countEnabledSchedules(tx: Tx, employeeId: number) {
    return tx.aiResearchSchedule.count({ where: { employeeId, enabled: true } });
  }

  async upsertSchedule(tx: Tx, runId: number, data: { employeeId: number; frequency: string; weekdays: number[]; runTime: string; nextRunAt: Date }): Promise<ScheduleWithRun> {
    const values = { ...data, enabled: true };
    return (await this.withTitles(tx, [await tx.aiResearchSchedule.upsert({ where: { runId }, create: { runId, ...values }, update: values })]))[0];
  }

  async updateSchedule(tx: Tx, id: number, data: Prisma.AiResearchScheduleUncheckedUpdateInput): Promise<ScheduleWithRun> {
    return (await this.withTitles(tx, [await tx.aiResearchSchedule.update({ where: { id }, data })]))[0];
  }

  /** 반복을 건 조사의 제목을 붙인다 (반복과 조사는 Prisma 관계로 잇지 않았다: schema의 AiResearchSchedule.runId 참고) */
  private async withTitles(tx: Tx, rows: AiResearchSchedule[]): Promise<ScheduleWithRun[]> {
    const runs = await tx.aiResearchRun.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.runId))] } }, select: { id: true, plan: true, question: true } });
    const titles = new Map(runs.map((r) => [r.id, storedPlan(r.plan)?.title ?? r.question]));
    return rows.map((row) => ({ ...row, title: titles.get(row.runId) ?? '' }));
  }

  /** 퇴사하지 않은 사원인지 (반복은 퇴사한 사원 대신 돌지 않는다) */
  async isEmployeeActive(tx: Tx, employeeId: number): Promise<boolean> {
    return (await tx.employee.findUnique({ where: { id: employeeId }, select: { isActive: true } }))?.isActive === true;
  }

  /** 차례가 된 반복 (오래된 차례부터). 시각은 DB의 now() */
  findDueSchedules(tx: Tx, take: number) {
    return tx.$queryRawTyped(findDueAiResearchSchedules(take));
  }

  /** 다음 차례가 본 값 그대로일 때만 next로 넘긴다. 다른 서버가 먼저 차지했으면 null */
  async claimSchedule(tx: Tx, id: number, expected: Date, next: Date): Promise<claimAiResearchSchedule.Result | null> {
    return (await tx.$queryRawTyped(claimAiResearchSchedule(id, expected, next)))[0] ?? null;
  }

}
