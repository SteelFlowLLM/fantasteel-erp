import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { AI_RESEARCH_LIMITS, AI_RESEARCH_SCHEDULE_FREQUENCY, nextAiResearchRunAt, type AiResearchScheduleRule } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';
import type { findDueAiResearchSchedules } from '../../generated/prisma/sql';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { LlmSettingsStore } from '../llm/llm-settings.store';
import { NotificationService } from '../notification/notification.service';
import { notifyResearchScheduleSkipped, researchTitleOf } from './ai-research.notify';
import { ACTIVE_STATUSES, AiResearchRepository, seedColumns } from './ai-research.repository';
import { EMPTY_STATE, readBudget, storedPlan, storedSeed } from './ai-research.rules';
import { AiResearchRunner } from './ai-research.runner';

/** 차례를 찾는 간격. 반복 시각은 분 단위라 1분이면 정한 시각에서 1분 안에 시작한다 (가정값) */
const POLL_MS = 60_000;
/** 한 번에 차지해 볼 차례 수 */
const DUE_BATCH = 20;

export const SCHEDULE_SKIP_NO_MODEL = 'AI 모델이 정해지지 않았어요';
export const SCHEDULE_SKIP_PREVIOUS_ACTIVE = '앞 반복 조사가 아직 끝나지 않았어요';
export const SCHEDULE_SKIP_TOO_MANY = `진행 중인 조사가 ${AI_RESEARCH_LIMITS.activeRunsPerEmployee}개예요`;
export const SCHEDULE_OFF_NO_SOURCE = '반복할 조사의 계획을 찾지 못해 반복을 껐어요';
export const SCHEDULE_OFF_INACTIVE = '퇴사한 사원의 반복이라 껐어요';

export type ScheduleFireResult = { scheduleId: number } & ({ kind: 'created'; runId: number } | { kind: 'skipped' | 'disabled'; reason: string } | { kind: 'lost' });

/**
 * 심층 조사 반복 실행 (이슈 #521). factory-agent 스케줄러처럼 스케줄 패키지 없이 타이머로 1분마다 차례가 된 반복을 찾는다.
 * 차례마다 한 트랜잭션에서 (사원별 잠금 → next_run_at 조건부 UPDATE로 차지 → 새 조사 만들기)를 하므로 서버가 여러 대여도 한 서버만 한 번 실행한다.
 * 새 조사는 원래 조사의 질문·계획(이미 승인)·예산·먼저 알아본 것을 복사해 QUEUED로 두고 일꾼을 깨운다. 끝나면 일꾼이 평소처럼 완료 알림을 보낸다.
 * AI_RESEARCH_WORKER=off면 일꾼과 함께 돌지 않는다(시험은 fireDue를 직접 부른다).
 */
@Injectable()
export class AiResearchScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AiResearchScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  /** 시험이 시계를 바꿔 본다 (다음 차례 계산용. 차례가 됐는지는 DB now()로 본다) */
  now: () => Date = () => new Date();

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: AiResearchRepository,
    private readonly llmSettings: LlmSettingsStore,
    private readonly notifications: NotificationService,
    private readonly runner: AiResearchRunner,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.AI_RESEARCH_WORKER === 'off') return;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    // 타이머가 서버 종료를 붙잡지 않게 한다
    this.timer.unref();
    // 켤 때 바로 한 번: 서버가 꺼져 있던 동안 지난 차례를 한 번 한다
    void this.tick();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.fireDue();
    } catch (error) {
      this.logger.warn(`심층 조사 반복 확인 실패: ${error instanceof Error ? error.message : 'unknown'}`);
    } finally {
      this.busy = false;
    }
  }

  /** 차례가 된 반복을 모두 해 본다. 새 조사를 만들었으면 일꾼을 깨운다 */
  async fireDue(): Promise<ScheduleFireResult[]> {
    const model = (await this.llmSettings.read()).model;
    const due = await this.repository.findDueSchedules(this.prisma, DUE_BATCH);
    const results: ScheduleFireResult[] = [];
    for (const row of due) {
      try {
        results.push(await this.fire(row, Boolean(model)));
      } catch (error) {
        // 한 반복이 실패해도(트랜잭션이 되돌려져 다음 확인 때 다시 한다) 다른 반복은 한다
        this.logger.warn(`심층 조사 반복 ${row.id} 실행 실패: ${error instanceof Error ? error.message : 'unknown'}`);
      }
    }
    if (results.some((r) => r.kind === 'created')) this.runner.wake();
    return results;
  }

  private async fire(row: findDueAiResearchSchedules.Result, hasModel: boolean): Promise<ScheduleFireResult> {
    const expected = row.next_run_at;
    if (!expected) return { scheduleId: row.id, kind: 'lost' };
    const rule: AiResearchScheduleRule = {
      frequency: row.frequency === AI_RESEARCH_SCHEDULE_FREQUENCY.WEEKLY ? AI_RESEARCH_SCHEDULE_FREQUENCY.WEEKLY : AI_RESEARCH_SCHEDULE_FREQUENCY.DAILY,
      weekdays: row.weekdays ?? [],
      time: row.run_time,
    };
    // 서버가 꺼져 있어 차례를 여럿 놓쳤어도 한 번만 하고 지금 뒤 첫 시각으로 넘긴다
    const next = nextAiResearchRunAt(rule, new Date(Math.max(this.now().getTime(), expected.getTime())));
    return this.prisma.$transaction(async (tx) => {
      // 반복 바꾸기와 같은 순서(사원별 잠금 → 반복 행)로 잠근다
      await this.repository.lockEmployee(tx, row.employee_id);
      if (!next) return this.turnOff(tx, row.id, SCHEDULE_OFF_NO_SOURCE);
      const claimed = await this.repository.claimSchedule(tx, row.id, expected, next);
      if (!claimed) return { scheduleId: row.id, kind: 'lost' as const };

      const source = await this.repository.findById(tx, claimed.run_id);
      const plan = source ? storedPlan(source.plan) : null;
      if (!source || !plan) return this.turnOff(tx, row.id, SCHEDULE_OFF_NO_SOURCE);
      if (!(await this.repository.isEmployeeActive(tx, claimed.employee_id))) return this.turnOff(tx, row.id, SCHEDULE_OFF_INACTIVE);

      const last = claimed.last_run_id === null ? null : await this.repository.findById(tx, claimed.last_run_id);
      const skip = !hasModel
        ? SCHEDULE_SKIP_NO_MODEL
        : last && ACTIVE_STATUSES.includes(last.status as (typeof ACTIVE_STATUSES)[number])
          ? SCHEDULE_SKIP_PREVIOUS_ACTIVE
          : (await this.repository.countActive(tx, claimed.employee_id)) >= AI_RESEARCH_LIMITS.activeRunsPerEmployee
            ? SCHEDULE_SKIP_TOO_MANY
            : null;
      if (skip) {
        await this.repository.updateSchedule(tx, row.id, { lastSkipReason: skip });
        await notifyResearchScheduleSkipped(this.notifications, tx, { employeeId: claimed.employee_id, runId: source.id, title: researchTitleOf(source), reason: skip });
        return { scheduleId: row.id, kind: 'skipped' as const, reason: skip };
      }

      const run = await this.repository.createScheduled(tx, {
        employeeId: claimed.employee_id,
        question: source.question,
        budget: { ...readBudget(source.budget) },
        plan: plan as unknown as Prisma.InputJsonObject,
        researchState: { ...EMPTY_STATE } as unknown as Prisma.InputJsonObject,
        scheduleId: row.id,
        ...seedColumns(storedSeed(source.seed)),
      });
      await this.repository.appendEvents(tx, run.id, [{ type: 'plan.ready', payload: { title: plan.title, stepCount: plan.steps.length, revision: run.planRevision, fallback: false, copiedFrom: source.id, scheduled: true } }]);
      await this.repository.updateSchedule(tx, row.id, { lastRunId: run.id, lastSkipReason: null });
      this.logger.log(`심층 조사 반복 ${row.id}: 조사 ${source.id}로 새 조사 ${run.id}를 만들었어요`);
      return { scheduleId: row.id, kind: 'created' as const, runId: run.id };
    });
  }

  /** 더 돌릴 수 없는 반복은 끈다 (켜 두면 차례마다 같은 실패를 되풀이한다) */
  private async turnOff(tx: Tx, id: number, reason: string): Promise<ScheduleFireResult> {
    await this.repository.updateSchedule(tx, id, { enabled: false, nextRunAt: null, lastSkipReason: reason });
    this.logger.warn(`심층 조사 반복 ${id}을 껐어요: ${reason}`);
    return { scheduleId: id, kind: 'disabled', reason };
  }
}
