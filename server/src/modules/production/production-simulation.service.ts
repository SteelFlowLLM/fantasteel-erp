import { Injectable } from '@nestjs/common';
import {
  ITEM_TYPE,
  PROCESS_TYPE,
  PRODUCTION_PLAN_STATUS,
  type AuthUser,
  type ProcessType,
  type ProductionPlanStatus,
  type SimulationResult,
  type SimulationStep,
} from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { seoulDateOnly } from '../../common/time/seoul-date';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import type { SimulateResultsDto } from './dto/simulation.dto';
import { roundTon } from './fifo.calculator';
import { slabQtyFromHeat } from './heat-plan.calculator';
import { HotRollingService } from './hot-rolling.service';
import { ProductionResultRepository } from './production-result.repository';
import { ProductionResultService, type SimulationMark, type WorkOutputs } from './production-result.service';
import { ProductionService } from './production.service';
import { ProductionRepository } from './production.repository';
import { castingLoss, drawSampleLossRate, layoutSteps, MAX_RANDOM_SEED, seededRandom, SIMULATION_HOURS } from './simulation.calculator';

/** 시뮬레이션 기본 고로·전로 (문서 예시 BF2·BOF1) */
const SIMULATION_BLAST_FURNACE = 'BF2';
const SIMULATION_CONVERTER = 'BOF1';
const NO_ELIGIBLE_SLAB = '검사 합격한 슬래브가 없어 열연은 건너뛰었어요. 검사 후 열연 투입에서 진행해 주세요';

type PlannedStep = { processType: ProcessType; heatLotId?: number };

/**
 * 실적 시뮬레이션 (REQ-PRD-007, 업무 프로세스 8장 BP-SEED-01): 생산계획을 골라 공정별 실적을 한 번에 만든다.
 * 계획 수율 고정, 재현 가능한 난수 시드, 연주에서만 0~5% 손실을 슬래브 매수 감소로 표현, 열연은 필요한 슬래브만(추가 손실 없음).
 * 실적 등록과 같은 함수(ProductionResultService)를 써서 FIFO 차감·LOT·관계·작업 로그 규칙이 같다. 검사는 하지 않는다(품질 담당).
 */
@Injectable()
export class ProductionSimulationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: ProductionRepository,
    private readonly resultRepository: ProductionResultRepository,
    private readonly results: ProductionResultService,
    private readonly production: ProductionService,
    private readonly hotRolling: HotRollingService,
  ) {}

  async simulate(user: AuthUser, productionPlanId: number, dto: SimulateResultsDto, now: Date = new Date()): Promise<SimulationResult> {
    const randomSeed = dto.randomSeed ?? Math.floor(now.getTime() / 1000) % MAX_RANDOM_SEED;
    return this.prisma.$transaction(
      async (tx) => {
        const locked = await this.plans.lockPlan(tx, productionPlanId);
        if (!locked) throw new AppException('COM-003', '생산계획을 찾을 수 없어요');
        if (locked.production_plan_status !== PRODUCTION_PLAN_STATUS.PLANNED && locked.production_plan_status !== PRODUCTION_PLAN_STATUS.IN_PROGRESS) {
          throw new AppException('COM-001', '완료·취소된 계획은 시뮬레이션할 수 없어요');
        }
        if ((await this.resultRepository.findOpenResults(tx, { productionPlanId })).length > 0) {
          throw new AppException('COM-001', '작업 중인 실적이 있어요. 작업 완료로 먼저 마쳐 주세요');
        }
        const plan = await this.plans.findPlan(tx, productionPlanId);
        if (!plan) throw new AppException('COM-003', '생산계획을 찾을 수 없어요');
        const basis = await this.production.heatPlanBasisOf(tx, plan.itemId);
        const random = seededRandom(randomSeed);
        const mark = { simulation: true, randomSeed };

        // 1. 할 일: 만든 히트 중 연주 전 히트를 먼저, 그다음 모자란 히트마다 (용선이 모자라면 제선) → 제강 → 연주
        const heats = await this.resultRepository.findHeatsOfPlan(tx, productionPlanId);
        const steps: PlannedStep[] = heats.filter((h) => h._count.lotRelationsAsParentLot === 0).map((h) => ({ processType: PROCESS_TYPE.CONTINUOUS_CASTING, heatLotId: h.id }));
        const hotMetalPerHeat = roundTon(basis.heatCapacityTon.div(basis.steelmakingYieldRate));
        let hotMetal = (await this.resultRepository.findAvailableHotMetalLots(tx)).reduce((sum, l) => sum.add(l.remainingTon ?? '0'), new Prisma.Decimal(0));
        for (let n = heats.length; n < plan.heatCount; n++) {
          if (hotMetal.lt(hotMetalPerHeat)) {
            steps.push({ processType: PROCESS_TYPE.IRONMAKING });
            hotMetal = hotMetal.add(hotMetalPerHeat);
          }
          hotMetal = hotMetal.sub(hotMetalPerHeat);
          steps.push({ processType: PROCESS_TYPE.STEELMAKING }, { processType: PROCESS_TYPE.CONTINUOUS_CASTING });
        }
        const rolls = basis.itemType === ITEM_TYPE.COIL && plan.salesOrderItemId !== null;
        const todayStart = new Date(seoulDateOnly(now).getTime() - 9 * 3_600_000);
        const slots = layoutSteps([...steps.map((s) => SIMULATION_HOURS[s.processType]), ...(rolls ? [SIMULATION_HOURS.HOT_ROLLING] : [])], now, todayStart);

        // 2. 실행
        const done: SimulationStep[] = [];
        let castHeatId: number | undefined;
        for (const [index, step] of steps.entries()) {
          const slot = slots[index];
          if (step.processType === PROCESS_TYPE.STEELMAKING) {
            const result = await this.run(tx, user, productionPlanId, step.processType, slot, { inputHotMetalTon: hotMetalPerHeat.toFixed(3) }, { after: mark });
            castHeatId = (await tx.lot.findFirstOrThrow({ where: { productionResultId: result.productionResultId }, select: { id: true } })).id;
            done.push(result);
          } else if (step.processType === PROCESS_TYPE.CONTINUOUS_CASTING) {
            const heatLotId = step.heatLotId ?? castHeatId;
            if (heatLotId === undefined) throw new Error('연주할 히트가 없습니다');
            const heat = await this.resultRepository.findHeat(tx, heatLotId);
            const plannedQty = slabQtyFromHeat(heat?.initialTon ?? '0', basis.castingYieldRate, basis.slabItem.theoreticalWeightTon);
            if (plannedQty < 1) throw new AppException('MST-001', '히트 톤으로 슬래브를 1매도 만들 수 없어요 (수율·규격 확인)');
            const sampleLossRate = drawSampleLossRate(random);
            const loss = castingLoss(plannedQty, sampleLossRate);
            const simulation = { ...mark, plannedQty, sampleLossRate, lossQty: loss.lossQty, actualLossRate: loss.actualLossRate };
            const result = await this.run(tx, user, productionPlanId, step.processType, slot, { heatLotId, slabQty: loss.outputQty }, { simulatedLossRate: sampleLossRate, after: simulation });
            done.push({ ...result, plannedQty, sampleLossRate, lossQty: loss.lossQty, outputQty: loss.outputQty, actualLossRate: loss.actualLossRate });
          } else {
            done.push(await this.run(tx, user, productionPlanId, step.processType, slot, { hotMetalTon: hotMetalPerHeat.toFixed(3) }, { after: mark }));
          }
        }

        // 3. 코일: 필요한 슬래브만 열연. 방금 연주한 슬래브는 검사 전이라 보통 건너뛴다
        let skippedRolling: string | null = null;
        if (basis.itemType === ITEM_TYPE.COIL) {
          if (!rolls) {
            skippedRolling = '수주 연결이 없는 코일 계획은 열연하지 않아요';
          } else {
            const detail = await this.hotRolling.detail(productionPlanId, tx);
            const lotIds = detail.candidates.filter((c) => c.isRecommended).map((c) => c.lotId);
            if (lotIds.length > 0) await this.hotRolling.confirmInTx(tx, user, productionPlanId, lotIds);
            const confirmed = (await this.hotRolling.detail(productionPlanId, tx)).confirmedAllocationQty;
            if (confirmed > 0) done.push(await this.run(tx, user, productionPlanId, PROCESS_TYPE.HOT_ROLLING, slots[slots.length - 1], {}, { after: mark }));
            else skippedRolling = NO_ELIGIBLE_SLAB;
          }
        }
        const after = await this.plans.findPlan(tx, productionPlanId);
        return {
          productionPlanId,
          productionPlanNo: plan.productionPlanNo,
          randomSeed,
          steps: done,
          skippedRolling,
          productionPlanStatus: (after?.productionPlanStatus ?? plan.productionPlanStatus) as ProductionPlanStatus,
        };
      },
      // 히트가 여러 개면 실적·LOT이 많아 기본 제한시간(5초)을 넘을 수 있다
      { maxWait: 5_000, timeout: 60_000 },
    );
  }

  /** 공정 하나: 작업 시작 + 완료(실적 등록)를 실적 등록과 같은 함수로 */
  private async run(tx: Tx, user: AuthUser, productionPlanId: number, processType: ProcessType, slot: { startedAt: Date; completedAt: Date }, outputs: WorkOutputs, mark: SimulationMark): Promise<SimulationStep> {
    const started = await this.results.startInTx(tx, user, {
      processType,
      productionPlanId,
      blastFurnaceCode: processType === PROCESS_TYPE.IRONMAKING ? SIMULATION_BLAST_FURNACE : undefined,
      converterCode: processType === PROCESS_TYPE.STEELMAKING ? SIMULATION_CONVERTER : undefined,
      heatLotId: outputs.heatLotId,
      startedAt: slot.startedAt,
    });
    const { outputLotIds } = await this.results.completeInTx(tx, user, started.id, { ...outputs, completedAt: slot.completedAt, ...mark });
    const lots = await tx.lot.findMany({ where: { id: { in: outputLotIds } }, select: { lotNo: true }, orderBy: { id: 'asc' } });
    return {
      processType,
      productionResultId: started.id,
      startedAt: slot.startedAt.toISOString(),
      completedAt: slot.completedAt.toISOString(),
      outputLotNos: lots.map((l) => l.lotNo),
      plannedQty: null,
      sampleLossRate: null,
      lossQty: null,
      outputQty: processType === PROCESS_TYPE.CONTINUOUS_CASTING || processType === PROCESS_TYPE.HOT_ROLLING ? lots.length : null,
      actualLossRate: null,
    };
  }
}
