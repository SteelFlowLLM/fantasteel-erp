import { forwardRef, Inject, Injectable } from '@nestjs/common';
import {
  ALLOCATION_STATUS,
  BUSINESS_EVENT_TYPE,
  INSPECTION_RESULT,
  ITEM_TYPE,
  LOT_RELATION_EVIDENCE,
  LOT_STATUS,
  LOT_TYPE,
  PROCESS_TYPE,
  PROCESS_TYPE_LABEL,
  PRODUCTION_PLAN_STATUS,
  RAW_MATERIAL_TYPE,
  type AuthUser,
  type InspectionResult,
  type ItemType,
  type OpenWork,
  type PageResult,
  type ProcessType,
  type ProductionResultView,
  type RawMaterialStock,
  type WorkContext,
} from '@fantasteel/shared';
import { BusinessEventRecorder } from '../../common/business-event/business-event.recorder';
import { AppException } from '../../common/errors/app.exception';
import { formatCoilNumber, formatSlabNumber } from '../../common/numbering/number-format';
import { NumberingService } from '../../common/numbering/numbering.service';
import { seoulDateOnly } from '../../common/time/seoul-date';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import type { CompleteProductionResultDto, ListProductionResultsDto, RegisterProductionResultDto } from './dto/production-result.dto';
import { consumptionTon, planFifoDeduction, roundTon, type FifoTake } from './fifo.calculator';
import { slabQtyFromHeat } from './heat-plan.calculator';
import { planProgressOf } from './production-plan.mapper';
import { startedHeatLotIdOf, toResultView } from './production-result.mapper';
import { ProductionResultRepository } from './production-result.repository';
import { ProductionService, type HeatPlanBasis } from './production.service';
import { ProductionRepository, type PlanSummaryRow } from './production.repository';

type Actor = AuthUser | 'SYSTEM';

/** 작업 완료 때 공정별로 받는 값 */
export interface WorkOutputs {
  heatLotId?: number;
  hotMetalTon?: string;
  inputHotMetalTon?: string;
  slabQty?: number;
  allocationIds?: number[];
}

/** 실적 시뮬레이션이 덧붙이는 값 (04 8장: 샘플 손실률은 실적에, 시드·손실 매수는 작업 로그에) */
export interface SimulationMark {
  simulatedLossRate?: string | null;
  after?: Record<string, unknown>;
}

interface PlanContext {
  plan: PlanSummaryRow;
  basis: HeatPlanBasis;
  salesOrderId: number | null;
}

/** 작업 시작 입력 */
export interface StartWorkInput {
  processType: ProcessType;
  productionPlanId?: number;
  blastFurnaceCode?: string;
  converterCode?: string;
  heatLotId?: number;
  startedAt: Date;
}

const ton3 = (v: Prisma.Decimal) => v.toFixed(3);
const label = (p: ProcessType) => PROCESS_TYPE_LABEL[p];

/**
 * 작업 실적 등록 (REQ-PRD-003, REQ-LOT-001~004, BP-PRD-02, docs/backend/production.md 4장).
 * 작업 시작과 완료를 나눠 기록한다(완료 시각이 비면 작업 중). 완료 때 투입 LOT을 FIFO로 차감하고 산출 LOT·관계를 만든다.
 */
@Injectable()
export class ProductionResultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: ProductionResultRepository,
    private readonly plans: ProductionRepository,
    private readonly production: ProductionService,
    private readonly numbering: NumberingService,
    private readonly businessEventRecorder: BusinessEventRecorder,
    @Inject(forwardRef(() => InventoryService)) private readonly inventory: InventoryService,
  ) {}

  // ── 조회 ─────────────────────────────────────────────

  async listResults(query: ListProductionResultsDto): Promise<PageResult<ProductionResultView>> {
    const page = query.page ?? 1;
    const size = query.size ?? 20;
    const filter = { productionPlanId: query.productionPlanId, processType: query.processType };
    const [rows, total] = await Promise.all([
      this.repository.findResults(this.prisma, filter, { skip: (page - 1) * size, take: size }),
      this.repository.countResults(this.prisma, filter),
    ]);
    const events = await this.repository.findResultEvents(this.prisma, rows.map((r) => r.id));
    return { items: rows.map((r) => toResultView(r, events)), page, size, total };
  }

  async getResult(id: number, tx: Tx = this.prisma): Promise<ProductionResultView> {
    const row = await this.repository.findResultView(tx, id);
    if (!row) throw new AppException('COM-003', '작업 실적을 찾을 수 없어요');
    return toResultView(row, await this.repository.findResultEvents(tx, [id]));
  }

  /** 실적 입력 기준값: 수율·용량, 쓸 수 있는 용선·원료 잔량, 연주 전 히트, 작업 중 실적 */
  async workContext(productionPlanId: number): Promise<WorkContext> {
    const tx = this.prisma;
    const plan = await this.plans.findPlan(tx, productionPlanId);
    if (!plan) throw new AppException('COM-003', '생산계획을 찾을 수 없어요');
    const basis = await this.production.heatPlanBasisOf(tx, plan.itemId);
    const [hotMetalLots, consumptions, heats, planOpen, ironOpen, lastCodes] = await Promise.all([
      this.repository.findAvailableHotMetalLots(tx),
      this.repository.findConsumptions(tx, basis.steelGradeId),
      this.repository.findHeatsOfPlan(tx, productionPlanId),
      this.repository.findOpenResults(tx, { productionPlanId }),
      this.repository.findOpenResults(tx, { productionPlanId: null, processType: PROCESS_TYPE.IRONMAKING }),
      this.repository.findLastEquipmentCodes(tx),
    ]);
    const stockOf = async (c: (typeof consumptions)[number], isKgPerTon: boolean): Promise<RawMaterialStock> => ({
      itemId: c.rawMaterialItem.id,
      itemCode: c.rawMaterialItem.itemCode,
      itemName: c.rawMaterialItem.itemName,
      consumptionRate: c.consumptionRate.toFixed(4),
      isKgPerTon,
      remainingTon: ton3(await this.repository.sumRawMaterialRemaining(tx, c.rawMaterialItem.id)),
    });
    const ironmaking = consumptions.filter((c) => c.steelGradeId === null && c.rawMaterialItem.rawMaterialType !== RAW_MATERIAL_TYPE.FERROALLOY);
    const ferroalloys = consumptions.filter((c) => c.steelGradeId !== null && c.steelGradeId === basis.steelGradeId);
    const open = [...ironOpen, ...planOpen];
    const events = await this.repository.findResultEvents(tx, open.map((o) => o.id));
    const hotMetalAvailable = hotMetalLots.reduce((sum, l) => sum.add(l.remainingTon ?? '0'), new Prisma.Decimal(0));
    return {
      productionPlanId: plan.id,
      productionPlanNo: plan.productionPlanNo,
      productionPlanStatus: plan.productionPlanStatus as WorkContext['productionPlanStatus'],
      itemType: basis.itemType,
      steelGradeCode: plan.item.steelGrade?.steelGradeCode ?? null,
      heatCount: plan.heatCount,
      castingYieldRate: basis.castingYieldRate.toFixed(4),
      steelmakingYieldRate: basis.steelmakingYieldRate.toFixed(4),
      heatCapacityTon: ton3(basis.heatCapacityTon),
      hotMetalTonPerHeat: ton3(roundTon(basis.heatCapacityTon.div(basis.steelmakingYieldRate))),
      slabItemId: basis.slabItem.id,
      slabItemCode: basis.slabItem.itemCode,
      slabTheoreticalWeightTon: ton3(basis.slabItem.theoreticalWeightTon),
      hotMetalLots: hotMetalLots.map((l) => ({ lotId: l.id, lotNo: l.lotNo, remainingTon: ton3(l.remainingTon ?? new Prisma.Decimal(0)) })),
      hotMetalAvailableTon: ton3(hotMetalAvailable),
      ironmakingMaterials: await Promise.all(ironmaking.map((c) => stockOf(c, false))),
      ferroalloys: await Promise.all(ferroalloys.map((c) => stockOf(c, true))),
      heatsToMakeQty: Math.max(0, plan.heatCount - heats.length),
      uncastHeats: heats
        .filter((h) => h._count.lotRelationsAsParentLot === 0)
        .map((h) => ({
          lotId: h.id,
          lotNo: h.lotNo,
          heatTon: ton3(h.initialTon ?? new Prisma.Decimal(0)),
          maxSlabQty: slabQtyFromHeat(h.initialTon ?? '0', basis.castingYieldRate, basis.slabItem.theoreticalWeightTon),
          inspectionResult: (h.qualityInspection?.inspectionResult ?? null) as InspectionResult | null,
        })),
      openWork: open.map(
        (o): OpenWork => ({
          productionResultId: o.id,
          processType: o.processType as ProcessType,
          startedAt: o.startedAt.toISOString(),
          blastFurnaceCode: o.blastFurnaceCode,
          converterCode: o.converterCode,
          heatLotId: startedHeatLotIdOf(events, o.id),
        }),
      ),
      lastBlastFurnaceCode: lastCodes.blastFurnaceCode,
      lastConverterCode: lastCodes.converterCode,
    };
  }

  // ── 등록 (API-208) ────────────────────────────────────

  /** 작업 시작(완료 시각 없음) 또는 시작·완료를 한 번에 */
  async register(user: AuthUser, dto: RegisterProductionResultDto): Promise<ProductionResultView> {
    const completedAt = dto.completedAt ? new Date(dto.completedAt) : null;
    const startedAt = dto.startedAt ? new Date(dto.startedAt) : (completedAt ?? new Date());
    const id = await this.prisma.$transaction(async (tx) => {
      const started = await this.startInTx(tx, user, { ...dto, startedAt });
      if (completedAt) await this.completeInTx(tx, user, started.id, { ...dto, completedAt });
      return started.id;
    });
    return this.getResult(id);
  }

  /** 작업 완료·실적 등록 (작업 시작으로 만든 실적) */
  async complete(user: AuthUser, resultId: number, dto: CompleteProductionResultDto): Promise<ProductionResultView> {
    await this.prisma.$transaction(async (tx) => {
      await this.completeInTx(tx, user, resultId, { ...dto, completedAt: dto.completedAt ? new Date(dto.completedAt) : new Date() });
    });
    return this.getResult(resultId);
  }

  /** 작업 시작: 실적 행(완료 시각 없음) + PRODUCTION_STARTED. 계획은 첫 실적에서 진행중이 된다 */
  async startInTx(tx: Tx, actor: Actor, input: StartWorkInput) {
    const processType = input.processType;
    const ironmaking = processType === PROCESS_TYPE.IRONMAKING;
    if (!ironmaking && input.productionPlanId === undefined) throw new AppException('COM-004', `${label(processType)} 실적은 생산계획을 골라야 해요`);
    if (ironmaking && !input.blastFurnaceCode) throw new AppException('COM-004', '제선 실적은 고로 코드가 필요해요');
    if (processType === PROCESS_TYPE.STEELMAKING && !input.converterCode) throw new AppException('COM-004', '제강 실적은 전로 코드가 필요해요');
    const ctx = input.productionPlanId === undefined ? null : await this.lockOpenPlan(tx, input.productionPlanId, processType);

    const open = ironmaking
      ? await this.repository.findOpenResults(tx, { productionPlanId: null, processType, blastFurnaceCode: input.blastFurnaceCode })
      : await this.repository.findOpenResults(tx, { productionPlanId: ctx?.plan.id, processType });
    if (open.length > 0) throw new AppException('COM-001', `작업 중인 ${label(processType)} 실적이 있어요. 작업 완료로 먼저 마쳐 주세요`);

    let heatLotId: number | null = null;
    if (processType === PROCESS_TYPE.CONTINUOUS_CASTING && ctx) {
      if (input.heatLotId === undefined) throw new AppException('COM-004', '연주할 히트를 골라 주세요');
      heatLotId = (await this.loadCastableHeat(tx, ctx, input.heatLotId)).id;
    }

    const result = await this.repository.createResult(tx, {
      // ERD: 제선 실적은 계획에 묶지 않는다(용선은 공용 풀). 어느 계획 때문에 했는지는 작업 로그에 남긴다
      productionPlanId: ironmaking ? null : (ctx?.plan.id ?? null),
      processType,
      blastFurnaceCode: ironmaking ? (input.blastFurnaceCode ?? null) : null,
      converterCode: processType === PROCESS_TYPE.STEELMAKING ? (input.converterCode ?? null) : null,
      startedAt: input.startedAt,
      completedAt: null,
    });
    await this.businessEventRecorder.record(tx, {
      type: BUSINESS_EVENT_TYPE.PRODUCTION_STARTED,
      actor,
      target: { table: 'production_result', id: result.id },
      salesOrderId: ctx?.salesOrderId ?? null,
      lotIds: heatLotId === null ? [] : [heatLotId],
      after: {
        processType,
        productionPlanId: ctx?.plan.id ?? null,
        productionPlanNo: ctx?.plan.productionPlanNo ?? null,
        blastFurnaceCode: result.blastFurnaceCode,
        converterCode: result.converterCode,
        startedAt: result.startedAt.toISOString(),
        heatLotId,
      },
      reason: `${label(processType)} 작업 시작${ctx ? ` (${ctx.plan.productionPlanNo})` : ''}`,
    });
    if (ctx) await this.refreshPlanStatus(tx, ctx.plan.id);
    return result;
  }

  /** 작업 완료·실적 등록: 공정별 투입 차감·산출 LOT·관계 + PRODUCTION_RESULT_REGISTERED */
  async completeInTx(tx: Tx, actor: Actor, resultId: number, input: WorkOutputs & { completedAt: Date } & SimulationMark): Promise<{ outputLotIds: number[] }> {
    const result = await this.repository.findResult(tx, resultId);
    if (!result) throw new AppException('COM-003', '작업 실적을 찾을 수 없어요');
    if (result.completedAt !== null) throw new AppException('COM-001', '이미 완료한 작업 실적이에요');
    const processType = result.processType as ProcessType;
    if (input.completedAt < result.startedAt) throw new AppException('COM-004', '작업 완료 일시가 작업 시작 일시보다 빨라요');

    const startEvent = await this.repository.findResultEvents(tx, [resultId]);
    const planId = result.productionPlanId ?? this.planIdOfStart(startEvent);
    const ctx = planId === null ? null : await this.lockOpenPlan(tx, planId, processType);
    const window = { startedAt: result.startedAt, completedAt: input.completedAt };

    let done: { inputLotIds: number[]; outputLotIds: number[]; after: Record<string, unknown> };
    switch (processType) {
      case PROCESS_TYPE.IRONMAKING:
        done = await this.completeIronmaking(tx, resultId, result.blastFurnaceCode ?? '', window, input);
        break;
      case PROCESS_TYPE.STEELMAKING:
        done = await this.completeSteelmaking(tx, resultId, result.converterCode ?? '', this.required(ctx), window, input);
        break;
      case PROCESS_TYPE.CONTINUOUS_CASTING: {
        const startedHeat = startedHeatLotIdOf(startEvent, resultId);
        if (startedHeat !== null && input.heatLotId !== undefined && input.heatLotId !== startedHeat) {
          throw new AppException('COM-004', '작업을 시작한 히트와 다른 히트예요');
        }
        done = await this.completeCasting(tx, resultId, this.required(ctx), window, { ...input, heatLotId: input.heatLotId ?? startedHeat ?? undefined });
        break;
      }
      default:
        done = await this.completeHotRolling(tx, this.required(ctx), resultId, window, input);
    }

    await this.repository.completeResult(tx, resultId, { completedAt: input.completedAt, simulatedLossRate: input.simulatedLossRate ?? null });
    await this.businessEventRecorder.record(tx, {
      type: BUSINESS_EVENT_TYPE.PRODUCTION_RESULT_REGISTERED,
      actor,
      target: { table: 'production_result', id: resultId },
      salesOrderId: ctx?.salesOrderId ?? null,
      lotIds: [...new Set([...done.inputLotIds, ...done.outputLotIds])],
      after: {
        processType,
        productionPlanId: ctx?.plan.id ?? null,
        productionPlanNo: ctx?.plan.productionPlanNo ?? null,
        startedAt: result.startedAt.toISOString(),
        completedAt: input.completedAt.toISOString(),
        ...done.after,
        ...(input.after ?? {}),
      },
      reason: `${label(processType)} 실적 등록${ctx ? ` (${ctx.plan.productionPlanNo})` : ''}`,
    });
    if (ctx) await this.refreshPlanStatus(tx, ctx.plan.id);
    return { outputLotIds: done.outputLotIds };
  }

  // ── 공정별 완료 ──────────────────────────────────────

  /** 제선: 원료별 투입량 = 용선량 × 원단위(t/t)를 입고일 FIFO로 차감 → 용선 LOT, 원료→용선 기간 기반 관계 */
  private async completeIronmaking(tx: Tx, resultId: number, blastFurnaceCode: string, window: { startedAt: Date; completedAt: Date }, input: WorkOutputs) {
    if (!input.hotMetalTon || new Prisma.Decimal(input.hotMetalTon).lte(0)) throw new AppException('COM-004', '용선량(t)을 0보다 크게 입력해 주세요');
    const hotMetalTon = roundTon(new Prisma.Decimal(input.hotMetalTon));
    const consumptions = (await this.repository.findConsumptions(tx, null)).filter((c) => c.steelGradeId === null && c.rawMaterialItem.rawMaterialType !== RAW_MATERIAL_TYPE.FERROALLOY);
    if (consumptions.length === 0) throw new AppException('MST-001', '제선 원료 원단위가 없어요');
    const needs = consumptions.map((c) => ({ item: c.rawMaterialItem, ton: consumptionTon(hotMetalTon, c.consumptionRate, false) }));
    const takes = await this.deductRawMaterials(tx, needs, window.completedAt);

    const lotNo = await this.numbering.nextLotNumber(tx, 'HOT_METAL', blastFurnaceCode, window.completedAt);
    const hotMetal = await this.repository.createLot(tx, { lotNo, lotType: LOT_TYPE.HOT_METAL, productionResultId: resultId, initialTon: hotMetalTon, remainingTon: hotMetalTon });
    await this.repository.createLotRelations(
      tx,
      takes.map((t) => ({ parentLotId: t.lotId, childLotId: hotMetal.id, lotRelationEvidence: LOT_RELATION_EVIDENCE.PERIOD_BASED, inputTon: t.ton, inputStartedAt: window.startedAt, inputEndedAt: window.completedAt })),
    );
    return {
      inputLotIds: takes.map((t) => t.lotId),
      outputLotIds: [hotMetal.id],
      after: { blastFurnaceCode, hotMetalTon: ton3(hotMetalTon), outputLotNo: lotNo, rawMaterialInputs: takes.map((t) => ({ lotNo: t.lotNo, ton: ton3(t.ton) })) },
    };
  }

  /**
   * 제강: 히트 톤 = 투입 용선 × 제강 수율. 용선 LOT은 생산 순 FIFO, 합금철 = 히트 톤 × kg/t ÷ 1,000을 입고일 FIFO로 차감
   * → 히트 LOT, 용선→히트·합금철→히트 실제 투입 관계 (REQ-LOT-002)
   */
  private async completeSteelmaking(tx: Tx, resultId: number, converterCode: string, ctx: PlanContext, window: { startedAt: Date; completedAt: Date }, input: WorkOutputs) {
    if (!input.inputHotMetalTon || new Prisma.Decimal(input.inputHotMetalTon).lte(0)) throw new AppException('COM-004', '투입 용선량(t)을 0보다 크게 입력해 주세요');
    const heats = await this.repository.findHeatsOfPlan(tx, ctx.plan.id);
    if (heats.length >= ctx.plan.heatCount) throw new AppException('COM-001', `편성한 히트 ${ctx.plan.heatCount}개를 모두 만들었어요`);
    if (ctx.basis.steelGradeId === null) throw new AppException('MST-001', '계획 규격의 강종이 없어요');
    const inputHotMetalTon = roundTon(new Prisma.Decimal(input.inputHotMetalTon));
    const heatTon = roundTon(inputHotMetalTon.mul(ctx.basis.steelmakingYieldRate));

    const ferroalloys = (await this.repository.findConsumptions(tx, ctx.basis.steelGradeId)).filter((c) => c.steelGradeId === ctx.basis.steelGradeId);
    if (ferroalloys.length === 0) throw new AppException('MST-001', '이 강종의 합금철 원단위가 없어요');

    // 용선과 합금철을 모두 확인한 뒤 모자라면 한꺼번에 알린다
    const hotMetalLots = await this.repository.lockHotMetalLots(tx, window.completedAt);
    const hotMetalPlan = planFifoDeduction(hotMetalLots.map((l) => ({ id: l.id, lotNo: l.lot_no, remainingTon: l.remaining_ton ?? '0' })), inputHotMetalTon);
    const shortages = hotMetalPlan.shortageTon.gt(0) ? [`용선 ${ton3(hotMetalPlan.shortageTon)}t`] : [];
    const ferroNeeds = ferroalloys.map((c) => ({ item: c.rawMaterialItem, ton: consumptionTon(heatTon, c.consumptionRate, true) }));
    const ferroTakes = await this.deductRawMaterials(tx, ferroNeeds, window.completedAt, shortages);
    await this.applyTakes(tx, hotMetalPlan.takes);

    const lotNo = await this.numbering.nextLotNumber(tx, 'HEAT', converterCode, window.completedAt);
    const heat = await this.repository.createLot(tx, { lotNo, lotType: LOT_TYPE.HEAT, steelGradeId: ctx.basis.steelGradeId, productionResultId: resultId, initialTon: heatTon });
    await this.repository.createLotRelations(tx, [
      ...hotMetalPlan.takes.map((t) => ({ parentLotId: t.lotId, childLotId: heat.id, lotRelationEvidence: LOT_RELATION_EVIDENCE.ACTUAL_INPUT, inputTon: t.ton })),
      ...ferroTakes.map((t) => ({ parentLotId: t.lotId, childLotId: heat.id, lotRelationEvidence: LOT_RELATION_EVIDENCE.ACTUAL_INPUT, inputTon: t.ton })),
    ]);
    return {
      inputLotIds: [...hotMetalPlan.takes.map((t) => t.lotId), ...ferroTakes.map((t) => t.lotId)],
      outputLotIds: [heat.id],
      after: {
        converterCode,
        heatSeq: heats.length + 1,
        inputHotMetalTon: ton3(inputHotMetalTon),
        heatTon: ton3(heatTon),
        outputLotNo: lotNo,
        hotMetalInputs: hotMetalPlan.takes.map((t) => ({ lotNo: t.lotNo, ton: ton3(t.ton) })),
        ferroalloyInputs: ferroTakes.map((t) => ({ lotNo: t.lotNo, ton: ton3(t.ton) })),
      },
    };
  }

  /** 연주: 히트 1개 → 슬래브 n매(히트번호-SS), 히트→슬래브 1:N. 최대 매수 = floor(히트 톤 × 연주 수율 ÷ 슬래브 1매 이론중량) */
  private async completeCasting(tx: Tx, resultId: number, ctx: PlanContext, window: { startedAt: Date; completedAt: Date }, input: WorkOutputs) {
    if (input.heatLotId === undefined) throw new AppException('COM-004', '연주할 히트를 골라 주세요');
    if (input.slabQty === undefined) throw new AppException('COM-004', '슬래브 생산 매수를 입력해 주세요');
    const heat = await this.loadCastableHeat(tx, ctx, input.heatLotId);
    const maxQty = slabQtyFromHeat(heat.initialTon ?? '0', ctx.basis.castingYieldRate, ctx.basis.slabItem.theoreticalWeightTon);
    if (input.slabQty > maxQty) throw new AppException('COM-004', `히트 ${heat.lotNo}에서 나올 수 있는 슬래브는 최대 ${maxQty}매예요`);

    const slabItem = await tx.item.findUniqueOrThrow({ where: { id: ctx.basis.slabItem.id }, select: { defaultYardId: true } });
    const producedDate = seoulDateOnly(window.completedAt);
    const slabIds: number[] = [];
    const slabNos: string[] = [];
    // 한 트랜잭션에서 여러 매를 만들므로 순번을 직접 늘린다 (numbering.service 주석)
    for (let n = 1; n <= input.slabQty; n++) {
      const slab = await this.repository.createLot(tx, {
        lotNo: formatSlabNumber(heat.lotNo, n),
        lotType: LOT_TYPE.SLAB,
        itemId: ctx.basis.slabItem.id,
        productionResultId: resultId,
        yardId: slabItem.defaultYardId,
        producedDate,
      });
      slabIds.push(slab.id);
      slabNos.push(slab.lotNo);
    }
    await this.repository.createLotRelations(tx, slabIds.map((id) => ({ parentLotId: heat.id, childLotId: id, lotRelationEvidence: LOT_RELATION_EVIDENCE.ACTUAL_INPUT })));
    // 히트는 연주로 모두 투입된다 (LOT_STATUS CONSUMED = 다음 공정에 모두 투입됨)
    await this.repository.updateLot(tx, heat.id, { lotStatus: LOT_STATUS.CONSUMED });
    return {
      inputLotIds: [heat.id],
      outputLotIds: slabIds,
      after: { heatNo: heat.lotNo, itemCode: ctx.basis.slabItem.itemCode, outputQty: input.slabQty, maxQty, outputLotNos: slabNos },
    };
  }

  /**
   * 열연: 확정 배정된 합격 슬래브 1매 → 코일 1개 (C + 슬래브번호, HT- 제외), 슬래브→코일 1:1 실제 투입.
   * 슬래브는 투입 소진, 배정은 CONSUMED, 재고는 rolling −n·현재고 −n (BP-INV-01). 수주 연결이 없는 계획은 열연하지 않는다.
   */
  private async completeHotRolling(tx: Tx, ctx: PlanContext, resultId: number, window: { startedAt: Date; completedAt: Date }, input: WorkOutputs) {
    if (ctx.plan.salesOrderItemId === null) throw new AppException('COM-001', '수주 연결이 없는 코일 계획은 열연하지 않아요. 남은 합격 슬래브는 여재예요');
    const slabItemId = ctx.basis.slabItem.id;
    const allocations = await this.inventory.hotRollingAllocationsOfPlan(tx, ctx.plan.id);
    let chosen = allocations.filter((a) => a.allocationStatus === ALLOCATION_STATUS.CONFIRMED);
    if (input.allocationIds) {
      const byId = new Map(allocations.map((a) => [a.id, a]));
      for (const id of input.allocationIds) {
        const allocation = byId.get(id);
        if (!allocation) throw new AppException('COM-004', `배정(id ${id})은 이 계획의 열연 배정이 아니에요`);
        if (allocation.allocationStatus !== ALLOCATION_STATUS.CONFIRMED) throw new AppException('INV-004', `${allocation.lotNo}은 확정 상태의 배정이 아니에요`);
      }
      chosen = chosen.filter((a) => input.allocationIds?.includes(a.id));
    }
    if (chosen.length === 0) throw new AppException('COM-004', '열연할 확정 배정이 없어요. 열연 투입에서 슬래브를 먼저 배정해 주세요');
    chosen.sort((a, b) => a.lotId - b.lotId);

    const coilItem = await tx.item.findUniqueOrThrow({ where: { id: ctx.plan.itemId }, select: { defaultYardId: true } });
    const producedDate = seoulDateOnly(window.completedAt);
    const coilIds: number[] = [];
    const coilNos: string[] = [];
    for (const allocation of chosen) {
      // 투입 직전 재검증: 같은 규격·재고 상태·제품과 상위 히트 합격 (INV-002·INV-004)
      await this.inventory.assertIssuableLot(tx, allocation.lotId, slabItemId);
      const coil = await this.repository.createLot(tx, {
        lotNo: formatCoilNumber(allocation.lotNo),
        lotType: LOT_TYPE.COIL,
        itemId: ctx.plan.itemId,
        productionResultId: resultId,
        yardId: coilItem.defaultYardId,
        producedDate,
      });
      await this.repository.createLotRelations(tx, [{ parentLotId: allocation.lotId, childLotId: coil.id, lotRelationEvidence: LOT_RELATION_EVIDENCE.ACTUAL_INPUT }]);
      await this.repository.updateLot(tx, allocation.lotId, { lotStatus: LOT_STATUS.CONSUMED });
      coilIds.push(coil.id);
      coilNos.push(coil.lotNo);
    }
    await this.inventory.consumeHotRollingAllocations(tx, { allocationIds: chosen.map((a) => a.id), slabItemId });
    return {
      inputLotIds: chosen.map((a) => a.lotId),
      outputLotIds: coilIds,
      after: { slabNos: chosen.map((a) => a.lotNo), coilNos, outputQty: coilIds.length },
    };
  }

  // ── 내부 ──────────────────────────────────────────────

  /** 원료별 필요 톤을 입고일 FIFO로 잠그고 계산한다. 하나라도 모자라면 아무것도 바꾸지 않고 INV-001 */
  private async deductRawMaterials(tx: Tx, needs: { item: { id: number; itemName: string }; ton: Prisma.Decimal }[], completedAt: Date, shortages: string[] = []): Promise<FifoTake[]> {
    const receivedUntil = seoulDateOnly(completedAt);
    const planned: FifoTake[] = [];
    for (const need of [...needs].sort((a, b) => a.item.id - b.item.id)) {
      if (need.ton.lte(0)) continue;
      const lots = await this.repository.lockRawMaterialLots(tx, need.item.id, receivedUntil);
      const plan = planFifoDeduction(lots.map((l) => ({ id: l.id, lotNo: l.lot_no, remainingTon: l.remaining_ton ?? '0' })), need.ton);
      if (plan.shortageTon.gt(0)) shortages.push(`${need.item.itemName} ${ton3(plan.shortageTon)}t`);
      planned.push(...plan.takes);
    }
    // 오류 코드 정의서 9.3에 원료 부족 코드가 없어 예약·배정 가능 매수 부족(INV-001)에 문구만 바꿔 쓴다 (docs/backend/production.md 8장)
    if (shortages.length > 0) throw new AppException('INV-001', `원료 LOT 잔량이 부족해요: ${shortages.join(', ')}`);
    await this.applyTakes(tx, planned);
    return planned;
  }

  /** 차감 반영: 잔량을 줄이고 0이 되면 투입 소진 */
  private async applyTakes(tx: Tx, takes: readonly FifoTake[]) {
    for (const take of takes) {
      await this.repository.updateLot(tx, take.lotId, { remainingTon: take.remainingTon, ...(take.remainingTon.lte(0) ? { lotStatus: LOT_STATUS.CONSUMED } : {}) });
    }
  }

  /** 실적을 등록할 수 있는 계획: 잠그고, 계획·진행중인지, 라우팅에 그 공정이 있는지 본다 */
  private async lockOpenPlan(tx: Tx, productionPlanId: number, processType: ProcessType): Promise<PlanContext> {
    const locked = await this.plans.lockPlan(tx, productionPlanId);
    if (!locked) throw new AppException('COM-003', '생산계획을 찾을 수 없어요');
    if (locked.production_plan_status !== PRODUCTION_PLAN_STATUS.PLANNED && locked.production_plan_status !== PRODUCTION_PLAN_STATUS.IN_PROGRESS) {
      throw new AppException('COM-001', '완료·취소된 계획에는 작업 실적을 등록할 수 없어요');
    }
    const plan = await this.plans.findPlan(tx, productionPlanId);
    if (!plan) throw new AppException('COM-003', '생산계획을 찾을 수 없어요');
    const routings = await this.plans.findRoutings(tx, plan.item.itemType as ItemType);
    if (!routings.some((r) => r.processType === processType)) throw new AppException('COM-004', `이 계획의 라우팅에는 ${label(processType)} 공정이 없어요`);
    const basis = await this.production.heatPlanBasisOf(tx, plan.itemId);
    return { plan, basis, salesOrderId: plan.salesOrderItem?.salesOrder.id ?? null };
  }

  /** 이 계획의 제강 실적으로 만든, 아직 연주하지 않은 히트 */
  private async loadCastableHeat(tx: Tx, ctx: PlanContext, heatLotId: number) {
    const heat = await this.repository.findHeat(tx, heatLotId);
    if (!heat || heat.lotType !== LOT_TYPE.HEAT) throw new AppException('COM-003', '히트를 찾을 수 없어요');
    if (heat.productionResult?.productionPlanId !== ctx.plan.id) throw new AppException('COM-004', `${heat.lotNo}은 이 계획의 히트가 아니에요`);
    if (heat._count.lotRelationsAsParentLot > 0 || heat.lotStatus !== LOT_STATUS.AVAILABLE) throw new AppException('COM-001', `${heat.lotNo}은 이미 연주한 히트예요`);
    return heat;
  }

  /** 제선 실적은 계획에 묶이지 않아 작업 시작 로그의 계획을 쓴다 */
  private planIdOfStart(events: readonly { businessEventType: string; afterData: unknown }[]): number | null {
    const started = events.find((e) => e.businessEventType === BUSINESS_EVENT_TYPE.PRODUCTION_STARTED);
    const after = started?.afterData as { productionPlanId?: unknown } | null | undefined;
    return typeof after?.productionPlanId === 'number' ? after.productionPlanId : null;
  }

  private required(ctx: PlanContext | null): PlanContext {
    if (!ctx) throw new AppException('COM-004', '생산계획이 필요한 공정이에요');
    return ctx;
  }

  /**
   * 계획 상태: 첫 실적이 생기면 진행중, 생산이 끝나면 완료 (계획 상태는 앞으로만 간다, 06 PRODUCTION_PLAN_STATUS).
   * 완료 = 작업 중 실적이 없고 편성한 히트를 모두 연주했고,
   *        코일 계획(수주 연결)이면 쓸 수 있는 코일이 부족 매수 이상이거나 이 계획에서 더 열연할 슬래브·배정이 없을 때 (사용자 결정 2026-10-06: 생산 완료 기준)
   */
  async refreshPlanStatus(tx: Tx, productionPlanId: number): Promise<void> {
    const plan = await this.plans.findPlan(tx, productionPlanId);
    if (!plan) return;
    const status = plan.productionPlanStatus;
    if (status === PRODUCTION_PLAN_STATUS.CANCELLED || status === PRODUCTION_PLAN_STATUS.COMPLETED) return;
    const [lots, results] = await Promise.all([this.plans.findLotsOfPlans(tx, [productionPlanId]), this.plans.findResultsOfPlan(tx, productionPlanId)]);
    const itemType = plan.item.itemType as ItemType;
    const progress = planProgressOf({ itemId: plan.itemId, itemType, heatCount: plan.heatCount }, lots, results);
    const allHeatsCast = progress.madeHeatQty >= plan.heatCount && progress.castHeatQty >= plan.heatCount;
    let complete = allHeatsCast && progress.openWorkCount === 0;
    if (complete && itemType === ITEM_TYPE.COIL && plan.salesOrderItemId !== null) {
      const usableCoils = progress.coilQty - progress.failedQty;
      const rollableSlabs = lots.filter((l) => l.lotType === LOT_TYPE.SLAB && l.lotStatus === LOT_STATUS.AVAILABLE && !this.isFailed(l)).length;
      const confirmed = await this.repository.countConfirmedRollingAllocations(tx, productionPlanId);
      complete = usableCoils >= plan.shortageQty || (rollableSlabs === 0 && confirmed === 0);
    }
    // 이 함수는 계획에 실적(제선은 그 계획 때문에 한 작업)이 생긴 뒤에만 부르므로 완료가 아니면 진행중이다
    const next = complete ? PRODUCTION_PLAN_STATUS.COMPLETED : PRODUCTION_PLAN_STATUS.IN_PROGRESS;
    if (next !== status) await this.plans.updatePlan(tx, productionPlanId, { productionPlanStatus: next });
  }

  private isFailed(lot: { qualityInspection: { inspectionResult: string } | null; lotRelationsAsChildLot: { parentLot: { lotType: string; qualityInspection: { inspectionResult: string } | null } }[] }): boolean {
    const heat = lot.lotRelationsAsChildLot.find((r) => r.parentLot.lotType === LOT_TYPE.HEAT)?.parentLot;
    return lot.qualityInspection?.inspectionResult === INSPECTION_RESULT.FAIL || heat?.qualityInspection?.inspectionResult === INSPECTION_RESULT.FAIL;
  }
}
