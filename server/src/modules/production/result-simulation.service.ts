import { Injectable } from '@nestjs/common';
import { PROCESS_ORDER, type AuthUser, type ProcessCode } from '@fantasteel/shared';
import { invalidState, notFound } from '../../common/errors/app.exception';
import { RealtimeService } from '../../common/realtime/realtime.service';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { BusinessEventRecorder } from '../business-event/business-event.recorder';
import { StockService } from '../inventory/stock.service';
import { passingValue } from '../quality/inspection-judge';
import { QualityInspectionService } from '../quality/quality-inspection.service';
import type { SimulateResultsDto } from './dto/simulate-results.dto';
import { ProductionMaterialService, rawShortageError, type RawNeed } from './production-material.service';
import { ProductionPlanService } from './production-plan.service';
import { ProductionResultService } from './production-result.service';
import { type PlanRow, ProductionRepository } from './production.repository';
import { slabSpecOf } from './production.view';
import { distributeLoss, lossQtyOf, sampleLossRate, seededRandom } from './simulation-random';
import { YieldCalculator } from './yield.calculator';

const MIN = 60_000;
// 시뮬레이션이 만드는 작업 시간 (분). 실제 조업 시간이 아니라 시계열이 자연스럽게 보이기 위한 값이다.
const DURATION_MIN = { IRONMAKING: 360, STEELMAKING: 50, CASTING: 90, HOT_ROLLING_PER_COIL: 6, INSPECTION: 20, GAP: 10 };
const SIM_FURNACE_NO = '1';
const SIM_CONVERTER_NO = '1';
const STEP_TIMEOUT_MS = 120_000;

export interface SimulationStep {
  /** RESULT = 공정 실적, INSPECTION = 검사(자동 합격값), ALLOCATION = 열연 투입 슬래브 FIFO 배정 */
  kind: 'RESULT' | 'INSPECTION' | 'ALLOCATION';
  processCode: ProcessCode;
  heatSeq: number | null;
  productionResultId: number | null;
  lotNos: string[];
  plannedQty: number | null;
  outputQty: number | null;
  lossQty: number | null;
}

/**
 * 실적 시뮬레이션 (REQ-PRD-007, BP-SEED-01). 고른 생산계획의 남은 공정을 SYSTEM 주체로 끝까지 만든다.
 * - 계획 수율은 고정. 연주에서만 0~5% 손실: 손실 매수 = floor(남은 연주 계획 매수 합계 × 샘플 손실률), 히트별로 나눠 기록
 * - 검사는 품질 모듈의 등록 함수를 그대로 불러 자동 판정·재고 반영·자동 예약·귀속이 실제 로직으로 일어난다
 * - 코일 계획은 필요한 슬래브만 FIFO 추천·배정 확정 후 열연 (추가 손실 없음)
 * - 공정(히트)마다 트랜잭션을 나눠서, 이미 끝난 공정은 건너뛰고 이어서 진행할 수 있다
 * - 원료가 모자라면 아무것도 바꾸기 전에 멈추고 어떤 원료가 몇 톤 부족한지 알려 준다 (409)
 */
@Injectable()
export class ResultSimulationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ProductionRepository,
    private readonly plans: ProductionPlanService,
    private readonly results: ProductionResultService,
    private readonly materials: ProductionMaterialService,
    private readonly yields: YieldCalculator,
    private readonly quality: QualityInspectionService,
    private readonly stock: StockService,
    private readonly events: BusinessEventRecorder,
    private readonly realtime: RealtimeService,
  ) {}

  async simulate(planId: number, dto: SimulateResultsDto, user: AuthUser) {
    const first = await this.repo.findPlan(this.prisma, planId);
    if (!first) throw notFound('생산계획');
    if (first.productionPlanStatus === 'PLANNED') throw invalidState('히트 편성을 먼저 확정해 주세요');
    if (!['CONFIRMED', 'IN_PROGRESS'].includes(first.productionPlanStatus)) throw invalidState('편성 확정·생산 중인 계획만 실적 시뮬레이션을 실행할 수 있습니다');

    const seed = dto.seed ?? Math.floor(Math.random() * 2_147_483_647);
    const sampledLossRate = sampleLossRate(seededRandom(seed));
    const includeInspection = dto.includeInspection ?? true;
    const untilIndex = dto.untilProcess ? PROCESS_ORDER.indexOf(dto.untilProcess as ProcessCode) : PROCESS_ORDER.length - 1;
    const runs = (p: ProcessCode) => PROCESS_ORDER.indexOf(p) <= untilIndex;

    await this.assertRawEnough(first, runs);

    const steps: SimulationStep[] = [];
    const notes: string[] = [];
    const clock = this.clock(first);
    const open = (plan: PlanRow, processCode: ProcessCode) =>
      plan.productionResults.filter((r) => r.processCode === processCode && r.productionResultStatus !== 'COMPLETED').sort((a, b) => (a.heatSeq ?? 0) - (b.heatSeq ?? 0) || a.id - b.id);

    // 제선: 필요량에 못 미쳐 이어진 실적이 생기면 그것까지 끝낸다.
    if (runs('IRONMAKING')) {
      for (let guard = 0; guard < 20; guard++) {
        const row = open(await this.reload(planId), 'IRONMAKING')[0];
        if (!row) break;
        steps.push(await this.runResult(row.id, row.productionResultStatus, clock.take(DURATION_MIN.IRONMAKING), { blastFurnaceNo: SIM_FURNACE_NO }));
      }
    }

    if (runs('STEELMAKING')) {
      for (const row of open(await this.reload(planId), 'STEELMAKING')) {
        steps.push(await this.runResult(row.id, row.productionResultStatus, clock.take(DURATION_MIN.STEELMAKING), { converterNo: SIM_CONVERTER_NO }));
      }
      if (includeInspection) steps.push(...(await this.inspectPending(planId, 'HEAT', 'STEELMAKING', clock.take(DURATION_MIN.INSPECTION).end)));
    }

    let usedLossRate: string | null = null;
    if (runs('CASTING')) {
      const rows = open(await this.reload(planId), 'CASTING');
      if (rows.length) {
        usedLossRate = sampledLossRate;
        const planned = rows.map((r) => r.plannedQty ?? 0);
        const loss = distributeLoss(planned, lossQtyOf(planned.reduce((s, v) => s + v, 0), sampledLossRate));
        for (const [i, row] of rows.entries()) {
          steps.push(await this.runResult(row.id, row.productionResultStatus, clock.take(DURATION_MIN.CASTING), { outputQty: planned[i] - loss[i] }, sampledLossRate));
        }
      }
      if (includeInspection) steps.push(...(await this.inspectPending(planId, 'SLAB', 'CASTING', clock.take(DURATION_MIN.INSPECTION).end)));
    }

    const isCoil = first.productSpec.item.itemType === 'COIL';
    if (isCoil && runs('HOT_ROLLING')) {
      const allocation = await this.allocateForRolling(planId);
      if (allocation.step) steps.push(allocation.step);
      if (allocation.note) notes.push(allocation.note);
      const plan = await this.reload(planId);
      const row = open(plan, 'HOT_ROLLING')[0];
      const confirmed = await this.repo.countConfirmedRollingAllocations(this.prisma, planId);
      if (row && confirmed > 0) {
        steps.push(await this.runResult(row.id, row.productionResultStatus, clock.take(DURATION_MIN.HOT_ROLLING_PER_COIL * confirmed), {}));
      }
      if (includeInspection) steps.push(...(await this.inspectPending(planId, 'COIL', 'HOT_ROLLING', clock.take(DURATION_MIN.INSPECTION).end)));
    }

    const plan = await this.prisma.tx(async (tx) => {
      const p = await this.repo.findPlan(tx, planId);
      await this.events.record(tx, {
        actor: null,
        eventType: 'RESULT_REGISTERED',
        targetType: 'PRODUCTION_PLAN',
        targetId: planId,
        targetNo: first.productionPlanNo,
        salesOrderId: p?.salesOrderItem?.salesOrderId ?? null,
        summary: `${first.productionPlanNo} 실적 시뮬레이션 실행: 실적 ${steps.filter((s) => s.kind === 'RESULT').length}건, 검사 ${steps.filter((s) => s.kind === 'INSPECTION').length}건 (시드 ${seed})`,
        after: { seed, sampledLossRate: usedLossRate, includeInspection, untilProcess: dto.untilProcess ?? null, requestedByEmployeeId: user.employeeId, productionPlanStatus: p?.productionPlanStatus },
        reasonCode: 'SIMULATION',
      });
      return this.plans.detail(tx, planId);
    });
    this.realtime.changed('production-plans', 'production-results', 'lots', 'inventories', 'quality-inspections');
    return {
      productionPlanId: planId,
      /** 이번 실행에 쓴 난수 시드 (같은 시드로 다시 실행하면 같은 손실률) */
      seed,
      /** 연주에 적용한 샘플 손실률. 이번 실행에서 연주를 하지 않았으면 null */
      sampledLossRate: usedLossRate,
      includeInspection,
      untilProcess: dto.untilProcess ?? null,
      steps,
      /** 건너뛴 일과 그 이유 (예: 배정할 합격 슬래브가 없음) */
      notes,
      plan,
    };
  }

  // ───────────────────────────── 단계 실행 ─────────────────────────────

  private async reload(planId: number): Promise<PlanRow> {
    const plan = await this.repo.findPlan(this.prisma, planId);
    if (!plan) throw notFound('생산계획');
    return plan;
  }

  /** 실적 1건을 시작(아직이면)·완료한다. 한 트랜잭션. */
  private async runResult(
    id: number, status: string, time: { start: Date; end: Date },
    body: { blastFurnaceNo?: string; converterNo?: string; outputQty?: number }, sampledLossRate?: string,
  ): Promise<SimulationStep> {
    return this.prisma.tx(async (tx) => {
      if (status === 'READY') await this.results.startResult(tx, id, { actor: null, at: time.start, isSimulated: true });
      const done = await this.results.completeResult(tx, id, body, { actor: null, at: time.end, isSimulated: true, sampledLossRate });
      return {
        kind: 'RESULT' as const, processCode: done.processCode as ProcessCode, heatSeq: done.heatSeq, productionResultId: done.id,
        lotNos: done.lots.map((l) => l.lotNo), plannedQty: done.plannedQty, outputQty: done.outputQty, lossQty: done.lossQty,
      };
    }, { timeout: STEP_TIMEOUT_MS });
  }

  /** 이 계획이 만든 검사 대기 LOT을 기준 안쪽 값으로 검사 등록한다 (품질 모듈과 같은 코드 경로). */
  private async inspectPending(planId: number, lotType: 'HEAT' | 'SLAB' | 'COIL', processCode: ProcessCode, inspectedAt: Date): Promise<SimulationStep[]> {
    return this.prisma.tx(async (tx) => {
      const lots = (await this.repo.planLots(tx, planId)).filter((l) => l.lotType === lotType && l.isPassed === null && l.heatLot?.isPassed !== false);
      const lotNos: string[] = [];
      for (const lot of lots) {
        const spec = await this.quality.inspectionSpecFor(tx, lot);
        const values = spec.filter((s) => s.isRequired || s.minValue !== null || s.maxValue !== null).map((s) => ({ inspectionItemCode: s.inspectionItemCode, measuredValue: passingValue(s.minValue, s.maxValue).toString() }));
        await this.quality.registerInspection(tx, { lotId: lot.id, values, memo: '실적 시뮬레이션 자동 합격값' }, { actor: null, isSimulated: true, inspectedAt });
        lotNos.push(lot.lotNo);
      }
      if (!lotNos.length) return [];
      return [{ kind: 'INSPECTION' as const, processCode, heatSeq: null, productionResultId: null, lotNos, plannedQty: null, outputQty: lotNos.length, lossQty: null }];
    }, { timeout: STEP_TIMEOUT_MS });
  }

  /** 코일 계획: 아직 필요한 매수만큼 슬래브를 FIFO로 추천받아 열연 배정을 확정한다 (귀속 슬래브 우선, 모자라면 여재). */
  private async allocateForRolling(planId: number): Promise<{ step: SimulationStep | null; note: string | null }> {
    return this.prisma.tx(async (tx) => {
      const plan = await this.repo.findPlan(tx, planId);
      if (!plan || !['CONFIRMED', 'IN_PROGRESS'].includes(plan.productionPlanStatus)) return { step: null, note: null };
      const item = plan.salesOrderItem;
      const slabSpec = slabSpecOf(plan);
      if (!item || !slabSpec) return { step: null, note: '수주 품목과 연결되지 않은 계획이라 열연을 하지 않았습니다 (슬래브는 여재로 남습니다)' };
      const rolled = await this.repo.countPlanCoils(tx, plan.id);
      const confirmed = await this.repo.countConfirmedRollingAllocations(tx, plan.id);
      const pendingCoils = (await this.repo.planLots(tx, plan.id)).filter((l) => l.lotType === 'COIL' && l.isPassed === null && l.lotStatus === 'IN_STOCK').length;
      const needByItem = (await this.stock.unsecuredQty(tx, item.id)) - pendingCoils - confirmed;
      const need = Math.min(plan.shortageQty - rolled - confirmed, needByItem);
      if (need <= 0) return { step: null, note: null };
      const lots = await this.stock.recommendLots(tx, { productSpecId: slabSpec.id, qty: need, purpose: 'ROLLING', coilSalesOrderItemId: item.id });
      if (!lots.length) return { step: null, note: '열연에 투입할 합격 슬래브가 없어 배정하지 않았습니다 (슬래브 검사 전이거나 모두 불합격)' };
      const allocationIds: number[] = [];
      for (const lot of lots) {
        const { allocation } = await this.stock.confirmAllocation(tx, { lotId: lot.id, purpose: 'ROLLING', salesOrderItemId: item.id, productionPlanId: plan.id, actor: null });
        allocationIds.push(allocation.id);
      }
      await this.events.record(tx, {
        actor: null,
        eventType: 'ALLOCATION_CONFIRMED',
        targetType: 'PRODUCTION_PLAN',
        targetId: plan.id,
        targetNo: plan.productionPlanNo,
        salesOrderId: item.salesOrderId,
        lotIds: lots.map((l) => l.id),
        summary: `${plan.productionPlanNo} 열연 투입 슬래브 ${lots.length}매 FIFO 추천·배정 확정 (필요 ${need}매)`,
        after: { purpose: 'ROLLING', neededQty: need, recommendedLotNos: lots.map((l) => l.lotNo), allocationIds },
        reasonCode: 'SIMULATION',
      });
      return {
        step: { kind: 'ALLOCATION' as const, processCode: 'HOT_ROLLING' as const, heatSeq: null, productionResultId: null, lotNos: lots.map((l) => l.lotNo), plannedQty: need, outputQty: lots.length, lossQty: null },
        note: lots.length < need ? `합격 슬래브가 모자라 ${need}매 중 ${lots.length}매만 열연에 배정했습니다` : null,
      };
    }, { timeout: STEP_TIMEOUT_MS });
  }

  // ───────────────────────────── 원료 확인·시각 ─────────────────────────────

  /** 남은 제선·제강에 필요한 원료를 한꺼번에 확인한다. 모자라면 아무것도 바꾸지 않고 409. */
  private async assertRawEnough(plan: PlanRow, runs: (p: ProcessCode) => boolean): Promise<void> {
    const tx: Tx = this.prisma;
    const needs: RawNeed[] = [];
    if (runs('IRONMAKING') && plan.productionResults.some((r) => r.processCode === 'IRONMAKING' && r.productionResultStatus !== 'COMPLETED')) {
      const hotMetalTon = await this.materials.remainingHotMetalNeedTon(tx, plan);
      if (hotMetalTon.gt(0)) needs.push(...(await this.materials.ironmakingNeeds(tx, hotMetalTon)));
    }
    if (runs('STEELMAKING')) {
      const heats = plan.productionResults.filter((r) => r.processCode === 'STEELMAKING' && r.productionResultStatus !== 'COMPLETED').length;
      if (heats > 0) needs.push(...(await this.materials.alloyNeeds(tx, plan.steelGradeId, (await this.yields.heatCapacityTon(tx)).mul(heats))));
    }
    const shortages = await this.materials.findShortages(tx, needs);
    if (shortages.length) throw rawShortageError('원료가 부족해 실적 시뮬레이션을 시작하지 않았습니다', shortages);
  }

  /**
   * 시뮬레이션 시각: 남은 작업 시간만큼 과거에서 시작해 지금 쪽으로 채운다 (미래 시각을 만들지 않는다).
   * 이미 끝난 실적이 있으면 그 뒤부터 이어 간다.
   */
  private clock(plan: PlanRow) {
    const open = plan.productionResults.filter((r) => r.productionResultStatus !== 'COMPLETED');
    const count = (p: string) => open.filter((r) => r.processCode === p).length;
    const totalMin =
      count('IRONMAKING') * DURATION_MIN.IRONMAKING + count('STEELMAKING') * DURATION_MIN.STEELMAKING + count('CASTING') * DURATION_MIN.CASTING +
      plan.shortageQty * DURATION_MIN.HOT_ROLLING_PER_COIL + 3 * DURATION_MIN.INSPECTION + (open.length + 4) * DURATION_MIN.GAP;
    const now = Date.now();
    const lastDone = Math.max(0, ...plan.productionResults.map((r) => (r.completedAt ?? r.startedAt)?.getTime() ?? 0));
    let cursor = Math.max(now - totalMin * MIN, lastDone + MIN);
    return {
      take: (minutes: number) => {
        const start = Math.min(cursor, Date.now());
        const end = Math.min(start + minutes * MIN, Date.now());
        cursor = end + DURATION_MIN.GAP * MIN;
        return { start: new Date(start), end: new Date(end) };
      },
    };
  }
}
