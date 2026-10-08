// 생산 화면(생산계획·작업 실적·열연 투입) ↔ 서버 API (server/src/modules/production). 서버 응답을 화면이 쓰는 모양(가짜 DB와 같은 타입)으로 바꾼다.
// 생산계획·LOT·실적·배정·규격 id는 서버 id를 그대로 쓴다. 응답에 없는 규격 이론중량·이름만 시드의 같은 코드로 채운다(api/server/masterIds.ts).
// LOT 추적·검사 입력도 서버 모드라 생산 화면의 LOT 링크는 같은 서버 LOT을 연다.
import type {
  HotRollingDetail as ServerHotRollingDetail,
  PageResult,
  PlanLot,
  ProductionPlanDetail as ServerPlanDetail,
  ProductionPlanSummary as ServerPlanSummary,
  ProductionResultView as ServerResultView,
  ReproductionResult as ServerReproductionResult,
  SimulationResult as ServerSimulationResult,
  WorkContext as ServerWorkContext,
} from '@fantasteel/shared';
import { ApiError } from '@/api/errors';
import { serverRequest } from '@/api/http';
import { seedItemOf } from '@/api/server/masterIds';
import type { CancelPlanInput, LotQuality, PlanLotRow, ProductionPlanDetail, ProductionPlanListRow, ReproductionCheck, ReproductionResult } from '@/api/production';
import type {
  CastingResultInput,
  IronmakingResultInput,
  RawMaterialStock,
  RegisteredResult,
  SimulateInput,
  SteelmakingResultInput,
  StartWorkInput,
  WorkContext,
} from '@/api/productionResults';
import type { ChangeRollingInput, ConfirmRollingInput, HotRollingResultInput, RollingDetail, RollingPlanListRow } from '@/api/rolling';
import type { InspectionResult, ProductItemType } from '@/codes';
import { decMul, decSum } from '@/lib/decimal';
import type { ProductionPlanView, ProductionResultView, SimulationResult } from '@/mock/services';

/** 목록은 화면이 한 번에 다 보여 주고 거르므로 서버 최대 페이지 크기로 끝까지 읽는다 */
const PAGE_SIZE = 100;

const productType = (itemType: string): ProductItemType => (itemType === 'COIL' ? 'COIL' : 'SLAB');
/** 화면 규격 id (규격 코드로 찾는다). 화면에 없는 서버 규격이면 서버 id를 그대로 둔다 */
const upper = (value: string | null | undefined) => (value ?? '').trim().toUpperCase() || undefined;

async function listAllPlans(query: Record<string, string | number | undefined> = {}): Promise<ServerPlanSummary[]> {
  const items: ServerPlanSummary[] = [];
  for (let page = 1; ; page++) {
    const result = await serverRequest<PageResult<ServerPlanSummary>>('GET', '/production-plans', { query: { ...query, page, size: PAGE_SIZE } });
    items.push(...result.items);
    if (items.length >= result.total || result.items.length === 0) return items;
  }
}

/** 수주 취소로 연결이 풀린(수주 없는) 계획 = 완료 후 여재 (BP-SO-02). 서버 계획은 처음엔 모두 수주 품목에 연결된다 */
const isSurplusOnCompletion = (p: { salesOrderId: number | null; productionPlanStatus: string }) => p.salesOrderId === null && p.productionPlanStatus !== 'CANCELLED';

function toListRow(s: ServerPlanSummary): ProductionPlanListRow {
  return {
    id: s.id,
    productionPlanNo: s.productionPlanNo,
    productionPlanStatus: s.productionPlanStatus,
    isReproduction: s.isReproduction,
    isSurplusOnCompletion: isSurplusOnCompletion(s),
    itemId: s.itemId,
    itemCode: s.itemCode,
    itemName: s.itemName,
    itemType: productType(s.itemType),
    steelGradeCode: s.steelGradeCode,
    salesOrderId: s.salesOrderId,
    salesOrderNo: s.salesOrderNo,
    dueDate: s.dueDate,
    shortageQty: s.shortageQty,
    heatCount: s.heatCount,
    requiredSteelTon: s.requiredMoltenSteelTon ?? '0.000',
    heatsMadeQty: s.heatsMadeQty,
    heatsCastQty: s.heatsCastQty,
    passedQty: s.passedQty,
    remainingTargetQty: s.remainingTargetQty,
    createdAt: s.createdAt,
    customerName: s.customerName,
  };
}

function toResultView(r: ServerResultView): ProductionResultView {
  return {
    id: r.id,
    processType: r.processType,
    blastFurnaceCode: r.blastFurnaceCode,
    converterCode: r.converterCode,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    inputTon: r.inputTon,
    outputTon: r.outputTon,
    outputQty: r.outputQty,
    lossQty: r.simulation?.lossQty ?? null,
    sampleLossRate: r.simulatedLossRate ?? r.simulation?.sampleLossRate ?? null,
    randomSeed: r.simulation?.randomSeed ?? null,
    isSimulated: r.isSimulated,
    operatorName: r.operatorName,
    outputLotNos: r.outputs.map((o) => o.lotNo),
  };
}

/** 품질 표시: 원료·용선은 검사 없음, 제품은 자기 판정과 상위 히트 판정을 함께 본다 (api/production.ts lotQualityOf와 같은 순서) */
function qualityOf(lot: Pick<PlanLot, 'lotType' | 'inspectionResult' | 'heatInspectionResult'>): LotQuality {
  if (lot.lotType === 'RAW_MATERIAL' || lot.lotType === 'HOT_METAL') return 'NONE';
  if (lot.inspectionResult === 'FAIL') return 'FAIL';
  if (lot.lotType !== 'HEAT' && lot.heatInspectionResult === 'FAIL') return 'HEAT_FAILED';
  if (lot.inspectionResult === null || lot.inspectionResult === 'PENDING') return 'PENDING';
  if (lot.lotType !== 'HEAT' && (lot.heatInspectionResult === null || lot.heatInspectionResult === 'PENDING')) return 'HEAT_PENDING';
  return 'PASS';
}

function toPlanLotRow(lot: PlanLot, heatDates: Map<number, string>): PlanLotRow {
  return {
    id: lot.lotId,
    lotNo: lot.lotNo,
    lotType: lot.lotType,
    lotStatus: lot.lotStatus,
    itemCode: lot.itemCode,
    heatLotId: lot.heatLotId,
    heatNo: lot.heatLotNo,
    // 히트는 생산완료일 칸이 없어 제강 완료일을 쓴다
    producedDate: lot.producedDate ?? heatDates.get(lot.lotId) ?? '',
    initialTon: lot.initialTon,
    remainingTon: lot.remainingTon,
    quality: qualityOf(lot),
    // 여재는 저장하지 않는다 (ERD: 적격 + 재고 + 확정 배정 없는 슬래브를 계산)
    surplusAt: null,
    dispositionStatus: lot.dispositionStatus,
    allocationPurpose: lot.allocationPurpose,
    yardName: lot.yardName,
  };
}

function toPlanView(d: ServerPlanDetail): ProductionPlanView {
  const f = d.formation;
  const slabSeed = f ? seedItemOf(f.slabItemCode) : undefined;
  // 용선 톤: 이 계획 히트에 투입한 용선 (제선 실적은 계획에 묶이지 않는다)
  const hotMetalTons = d.results.filter((r) => r.processType === 'STEELMAKING').flatMap((r) => r.inputs.filter((i) => i.lotType === 'HOT_METAL' && i.inputTon !== null).map((i) => i.inputTon ?? '0'));
  const plannedSlabQty = f ? f.slabQtyPerHeat * d.heatCount : 0;
  return {
    id: d.id,
    productionPlanNo: d.productionPlanNo,
    productionPlanStatus: d.productionPlanStatus,
    isReproduction: d.isReproduction,
    isSurplusOnCompletion: isSurplusOnCompletion(d),
    createdAt: d.createdAt,
    createdEmployeeName: d.createdEmployeeName,
    cancelledAt: d.cancelledAt,
    updatedAt: d.updatedAt,
    item: {
      id: d.itemId,
      itemCode: d.itemCode,
      itemName: d.itemName,
      itemType: productType(d.itemType),
      steelGradeCode: d.steelGradeCode,
      theoreticalWeightTon: f?.theoreticalWeightTon ?? seedItemOf(d.itemCode)?.theoreticalWeightTon ?? '0.000',
    },
    slabSpec: f ? { id: f.slabItemId, itemCode: f.slabItemCode, itemName: slabSeed?.itemName ?? f.slabItemCode, theoreticalWeightTon: f.slabTheoreticalWeightTon } : null,
    salesOrder:
      d.salesOrderId !== null && d.salesOrderNo !== null && d.salesOrderItemId !== null
        ? {
            salesOrderId: d.salesOrderId,
            salesOrderNo: d.salesOrderNo,
            salesOrderItemId: d.salesOrderItemId,
            lineNo: d.salesOrderLineNo ?? 1,
            customerName: d.customerName,
            dueDate: d.dueDate ?? '',
            orderedQty: d.salesOrderItem?.orderedQty ?? 0,
          }
        : null,
    // 화면 편성표는 저장된 히트 수 기준이다 (기준정보가 바뀌어 다시 계산한 값은 '히트 편성 확정'으로 저장)
    formation: f
      ? {
          shortageQty: f.shortageQty,
          targetWeightTon: f.targetTon,
          cumulativeYieldRate: f.cumulativeYieldRate,
          requiredSteelTon: f.requiredMoltenSteelTon,
          heatCount: d.heatCount,
          heatCapacityTon: f.heatCapacityTon,
          heatTon: decMul(f.heatCapacityTon, d.heatCount),
          slabQtyPerHeat: f.slabQtyPerHeat,
          plannedSlabQty,
          expectedSurplusSlabQty: Math.max(0, plannedSlabQty - f.shortageQty),
        }
      : null,
    progress: {
      heatCount: d.progress.heatCount,
      heatsMadeQty: d.progress.madeHeatQty,
      heatsCastQty: d.progress.castHeatQty,
      hotMetalTon: decSum(hotMetalTons),
      slabQty: d.progress.slabQty,
      coilQty: d.progress.coilQty,
      usableCoilQty: d.progress.usableCoilQty,
      passedQty: d.progress.passedQty,
      pendingQty: d.progress.pendingQty,
      failedQty: d.progress.failedQty,
      hotRollingAllocatedQty: d.progress.hotRollingAllocatedQty,
      ownRollableSlabQty: d.progress.ownRollableSlabQty,
      ownAllocatableSlabQty: d.progress.ownRollableSlabQty,
      allHeatsCast: d.progress.allHeatsCast,
      outputComplete: d.productionPlanStatus === 'COMPLETED',
      remainingTargetQty: d.progress.remainingTargetQty,
    },
    heats: d.heats.map((h) => ({ ...h, inspectionResult: h.inspectionResult })),
    results: [...d.results].sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id - b.id).map(toResultView),
    canCancel: d.canCancel,
  };
}

function toReproduction(r: NonNullable<ServerPlanDetail['reproduction']>): ReproductionCheck {
  return {
    salesOrderItemId: r.salesOrderItemId,
    salesOrderId: r.salesOrderId,
    salesOrderNo: r.salesOrderNo,
    lineNo: r.lineNo,
    salesOrderItemStatus: r.salesOrderItemStatus,
    orderedQty: r.orderedQty,
    shippedQty: r.shippedQty,
    unshippedQty: r.unshippedQty,
    activeReservedQty: r.activeReservedQty,
    unsecuredQty: r.unsecuredQty,
    openPlanRemainingQty: r.openPlanRemainingQty,
    additionalPlanQty: r.additionalPlanQty,
    reservationAvailableQty: r.reservationAvailableQty,
    // 서버 재생산은 추가 계획 필요 매수 안에서 여재를 먼저 예약한다
    surplusReserveQty: Math.min(r.additionalPlanQty, r.reservationAvailableQty),
    reproductionNeedQty: r.reproductionNeedQty,
    openPlans: r.openPlans,
    canReproduce: r.salesOrderItemStatus === 'OPEN' || r.salesOrderItemStatus === 'PARTIALLY_SHIPPED',
  };
}

function toPlanDetail(d: ServerPlanDetail): ProductionPlanDetail {
  const heatDates = new Map(d.heats.flatMap((h) => (h.heatLotId !== null && h.producedDate !== null ? [[h.heatLotId, h.producedDate] as const] : [])));
  return {
    ...toPlanView(d),
    salesOrderItemStatus: d.salesOrderItem?.salesOrderItemStatus ?? null,
    salesOrderOwnerName: d.salesOrderOwnerName,
    lots: d.lots.map((lot) => toPlanLotRow(lot, heatDates)),
    reproduction: d.reproduction ? toReproduction(d.reproduction) : null,
  };
}

const planDetail = (id: number) => serverRequest<ServerPlanDetail>('GET', `/production-plans/${id}`);

export const serverProductionPlanApi = {
  list: async (): Promise<ProductionPlanListRow[]> => (await listAllPlans()).map(toListRow),

  detail: async (productionPlanId: number): Promise<ProductionPlanDetail> => toPlanDetail(await planDetail(productionPlanId)),

  /** 서버에는 낙관적 잠금이 없어 화면을 연 뒤 바뀌었는지 먼저 확인한다 (COM-001) */
  cancel: async (input: CancelPlanInput): Promise<{ id: number; productionPlanNo: string }> => {
    if (input.expectedUpdatedAt) {
      const current = await planDetail(input.productionPlanId);
      if (current.updatedAt !== input.expectedUpdatedAt) throw new ApiError('COM-001');
    }
    const reason = input.reasonText?.trim() ? input.reasonText.trim().slice(0, 200) : undefined;
    const d = await serverRequest<ServerPlanDetail>('POST', `/production-plans/${input.productionPlanId}/cancel`, { body: { reason } });
    return { id: d.id, productionPlanNo: d.productionPlanNo };
  },

  createReproduction: async (input: { salesOrderItemId: number }): Promise<ReproductionResult> => {
    const r = await serverRequest<ServerReproductionResult>('POST', '/production-plans', { body: { salesOrderItemId: input.salesOrderItemId } });
    return { reservedFromSurplusQty: r.reservedFromSurplusQty, plan: r.plan ? { id: r.plan.id, productionPlanNo: r.plan.productionPlanNo, shortageQty: r.plan.shortageQty } : null };
  },
};

// ── 작업 실적 ────────────────────────────────────────────

function toStock(m: ServerWorkContext['ironmakingMaterials'][number]): RawMaterialStock {
  return { itemId: m.itemId, itemCode: m.itemCode, itemName: m.itemName, rawMaterialType: m.rawMaterialType, consumptionRate: m.consumptionRate, remainingTon: m.remainingTon };
}

const registered = (r: ServerResultView): RegisteredResult => ({ productionResultId: r.id, outputLotNos: r.outputs.map((o) => o.lotNo) });

/** 작업 시작 없이 바로 등록하면 시작·완료를 한 번에, 작업 시작한 실적이면 그 실적을 완료한다 */
function registerOrComplete(productionResultId: number | null | undefined, start: Record<string, unknown>, complete: Record<string, unknown>): Promise<ServerResultView> {
  return productionResultId
    ? serverRequest<ServerResultView>('POST', `/production-results/${productionResultId}/complete`, { body: complete })
    : serverRequest<ServerResultView>('POST', '/production-results', { body: { ...start, ...complete } });
}

export const serverProductionResultApi = {
  plans: async (): Promise<ProductionPlanListRow[]> => (await listAllPlans()).filter((p) => p.productionPlanStatus !== 'CANCELLED').map(toListRow),

  work: async (productionPlanId: number): Promise<WorkContext> => {
    const [detail, context] = await Promise.all([planDetail(productionPlanId), serverRequest<ServerWorkContext>('GET', `/production-plans/${productionPlanId}/work-context`)]);
    const plan = toPlanView(detail);
    const heatNoOf = (lotId: number | null) => (lotId === null ? null : (detail.heats.find((h) => h.heatLotId === lotId)?.heatNo ?? null));
    return {
      plan,
      isOpen: plan.productionPlanStatus === 'PLANNED' || plan.productionPlanStatus === 'IN_PROGRESS',
      steelmakingYieldRate: context.steelmakingYieldRate,
      castingYieldRate: context.castingYieldRate,
      heatCapacityTon: context.heatCapacityTon,
      hotMetalTonPerHeat: context.hotMetalTonPerHeat,
      hotMetalLots: context.hotMetalLots.map((l) => ({ lotNo: l.lotNo, producedDate: l.producedDate ?? '', remainingTon: l.remainingTon })),
      hotMetalAvailableTon: context.hotMetalAvailableTon,
      ironmakingMaterials: context.ironmakingMaterials.map(toStock),
      ferroalloys: context.ferroalloys.map(toStock),
      heatsToMakeQty: context.heatsToMakeQty,
      uncastHeats: context.uncastHeats.map((h) => ({ heatLotId: h.lotId, heatNo: h.lotNo, heatTon: h.heatTon, maxSlabQty: h.maxSlabQty, inspectionResult: (h.inspectionResult ?? 'PENDING') as InspectionResult })),
      openWork: context.openWork.map((o) => ({ productionResultId: o.productionResultId, processType: o.processType, startedAt: o.startedAt, heatLotId: o.heatLotId, heatNo: heatNoOf(o.heatLotId) })),
      lastBlastFurnaceCode: context.lastBlastFurnaceCode,
      lastConverterCode: context.lastConverterCode,
    };
  },

  startWork: async (input: StartWorkInput): Promise<{ productionResultId: number }> => {
    const r = await serverRequest<ServerResultView>('POST', '/production-results', {
      body: {
        processType: input.processType,
        productionPlanId: input.productionPlanId,
        startedAt: input.startedAt,
        blastFurnaceCode: input.processType === 'IRONMAKING' ? upper(input.blastFurnaceCode) : undefined,
        converterCode: input.processType === 'STEELMAKING' ? upper(input.converterCode) : undefined,
        heatLotId: input.processType === 'CONTINUOUS_CASTING' ? (input.heatLotId ?? undefined) : undefined,
      },
    });
    return { productionResultId: r.id };
  },

  registerIronmaking: async (input: IronmakingResultInput): Promise<RegisteredResult> =>
    registered(
      await registerOrComplete(
        input.productionResultId,
        { processType: 'IRONMAKING', productionPlanId: input.productionPlanId, blastFurnaceCode: upper(input.blastFurnaceCode), startedAt: input.startedAt },
        { completedAt: input.completedAt, hotMetalTon: input.outputTon },
      ),
    ),

  registerSteelmaking: async (input: SteelmakingResultInput): Promise<RegisteredResult> =>
    registered(
      await registerOrComplete(
        input.productionResultId,
        { processType: 'STEELMAKING', productionPlanId: input.productionPlanId, converterCode: upper(input.converterCode), startedAt: input.startedAt },
        { completedAt: input.completedAt, inputHotMetalTon: input.inputHotMetalTon },
      ),
    ),

  registerCasting: async (input: CastingResultInput): Promise<RegisteredResult> =>
    registered(
      await registerOrComplete(
        input.productionResultId,
        { processType: 'CONTINUOUS_CASTING', productionPlanId: input.productionPlanId, startedAt: input.startedAt },
        { completedAt: input.completedAt, heatLotId: input.heatLotId, slabQty: input.outputQty },
      ),
    ),

  simulate: async (input: SimulateInput): Promise<SimulationResult> => {
    const r = await serverRequest<ServerSimulationResult>('POST', `/production-plans/${input.productionPlanId}/simulate-results`, {
      body: { randomSeed: input.randomSeed ?? undefined },
    });
    return {
      productionPlanId: r.productionPlanId,
      randomSeed: r.randomSeed,
      skippedRolling: r.skippedRolling,
      steps: r.steps.map((s) => ({
        processType: s.processType,
        productionResultId: s.productionResultId,
        outputLotNos: s.outputLotNos,
        plannedQty: s.plannedQty ?? undefined,
        sampleLossRate: s.sampleLossRate ?? undefined,
        lossQty: s.lossQty ?? undefined,
        outputQty: s.outputQty ?? undefined,
      })),
    };
  },
};

// ── 열연 투입 ────────────────────────────────────────────

/** 배정 → 계획 (화면의 변경·해제 입력에 계획 id가 없어 상세를 읽을 때 기억해 둔다) */
const planOfAllocation = new Map<number, number>();

const hotRolling = (planId: number) => serverRequest<ServerHotRollingDetail>('GET', `/production-plans/${planId}/hot-rolling`);

function toRollingDetail(d: ServerHotRollingDetail): RollingDetail {
  for (const a of d.rollingAllocations) planOfAllocation.set(a.allocationId, d.plan.id);
  const confirmed = d.rollingAllocations.filter((a) => a.allocationStatus === 'CONFIRMED');
  return {
    plan: {
      productionPlanId: d.plan.id,
      productionPlanNo: d.plan.productionPlanNo,
      productionPlanStatus: d.plan.productionPlanStatus,
      salesOrderNo: d.plan.salesOrderNo,
      dueDate: d.plan.dueDate,
      coilItem: d.coilItem,
      slabItem: d.slabItem,
      shortageQty: d.shortageQty,
      rolledQty: d.usableCoilQty,
      failedCoilQty: d.failedCoilQty,
      allocatedQty: d.confirmedAllocationQty,
      neededQty: d.neededQty,
      slabPool: {
        itemId: d.slabItem.id,
        eligibleQty: d.slabPool.onHandQty,
        activeReservedQty: d.slabPool.reservedQty,
        hotRollingConfirmedQty: d.slabPool.rollingAllocatedQty,
        shipmentConfirmedQty: 0,
        availableQty: d.slabPool.availableQty,
      },
      recommendableQty: d.recommendableQty,
      allocations: confirmed.map((a) => ({
        allocationId: a.allocationId,
        lotId: a.lotId,
        lotNo: a.lotNo,
        producedDate: a.producedDate ?? '',
        heatNo: a.heatNo,
        sourcePlanNo: a.sourcePlanNo,
        surplusAt: null,
        confirmedAt: a.confirmedAt,
        confirmedEmployeeName: null,
      })),
      rollable: d.isRollable,
      notRollableReason: d.notRollableReason,
    },
    salesOrderId: d.plan.salesOrderId,
    candidates: d.candidates.map((c) => ({
      lotId: c.lotId,
      lotNo: c.lotNo,
      producedDate: c.producedDate ?? '',
      heatNo: c.heatNo,
      sourcePlanNo: c.sourcePlanNo,
      isOwnPlan: c.isOwnPlan,
      surplusAt: null,
      yardName: c.yardName,
      fifoRank: c.fifoRank,
      isRecommended: c.isRecommended,
    })),
    recommendedLotIds: d.candidates.filter((c) => c.isRecommended).map((c) => c.lotId),
    rollableAllocationIds: d.rollingAllocations.filter((a) => a.isRollable).map((a) => a.allocationId),
    results: [...d.results].sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id - b.id).map(toResultView),
    coils: d.coils.map((c) => ({
      lotId: c.lotId,
      lotNo: c.lotNo,
      slabNo: c.parentSlabNo,
      producedDate: c.producedDate ?? '',
      quality: qualityOf(c),
      lotStatus: c.lotStatus,
      hasConfirmedAllocation: c.hasConfirmedAllocation,
    })),
  };
}

async function planIdOfAllocation(allocationId: number): Promise<number> {
  const known = planOfAllocation.get(allocationId);
  if (known !== undefined) return known;
  // 화면을 새로 열지 않고 바로 부른 경우: 코일 계획을 읽어 찾는다
  for (const plan of await listAllPlans({ itemType: 'COIL' })) {
    const d = await hotRolling(plan.id).catch(() => null);
    if (d?.rollingAllocations.some((a) => a.allocationId === allocationId)) return plan.id;
  }
  throw new ApiError('COM-003', '열연 배정을 찾을 수 없어요');
}

export const serverRollingApi = {
  /** 코일 계획 목록: 계획마다 열연 투입 화면 값을 읽는다 (기준정보가 모자란 계획은 빠진다) */
  plans: async (): Promise<RollingPlanListRow[]> => {
    const plans = await listAllPlans({ itemType: 'COIL' });
    const details = await Promise.all(plans.map((p) => hotRolling(p.id).catch(() => null)));
    return details.flatMap((d) =>
      d
        ? [
            {
              productionPlanId: d.plan.id,
              productionPlanNo: d.plan.productionPlanNo,
              productionPlanStatus: d.plan.productionPlanStatus,
              salesOrderNo: d.plan.salesOrderNo,
              dueDate: d.plan.dueDate,
              coilItemCode: d.coilItem.itemCode,
              slabItemCode: d.slabItem.itemCode,
              shortageQty: d.shortageQty,
              rolledQty: d.usableCoilQty,
              failedCoilQty: d.failedCoilQty,
              allocatedQty: d.confirmedAllocationQty,
              neededQty: d.neededQty,
              rollable: d.isRollable,
            },
          ]
        : [],
    );
  },

  detail: async (productionPlanId: number): Promise<RollingDetail> => toRollingDetail(await hotRolling(productionPlanId)),

  /** 추천을 작업 로그로 남기고(ALLOCATION_RECOMMENDED) 고른 슬래브를 확정한다 */
  confirm: async (input: ConfirmRollingInput): Promise<{ allocatedQty: number }> => {
    await serverRequest<ServerHotRollingDetail>('POST', `/production-plans/${input.productionPlanId}/hot-rolling/recommend`);
    const d = await serverRequest<ServerHotRollingDetail>('POST', `/production-plans/${input.productionPlanId}/hot-rolling/allocations`, { body: { lotIds: input.lotIds } });
    toRollingDetail(d);
    return { allocatedQty: input.lotIds.length };
  },

  change: async (input: ChangeRollingInput): Promise<{ allocationId: number }> => {
    const planId = await planIdOfAllocation(input.allocationId);
    const d = await serverRequest<ServerHotRollingDetail>('POST', `/production-plans/${planId}/hot-rolling/allocations/${input.allocationId}/release`, {
      body: { newLotId: input.newLotId, reason: input.reasonText.trim().slice(0, 200) },
    });
    toRollingDetail(d);
    const created = d.rollingAllocations.find((a) => a.lotId === input.newLotId && a.allocationStatus === 'CONFIRMED');
    return { allocationId: created?.allocationId ?? input.allocationId };
  },

  release: async (input: { allocationId: number; reasonText?: string | null }): Promise<{ allocationId: number }> => {
    const planId = await planIdOfAllocation(input.allocationId);
    const reason = input.reasonText?.trim() ? input.reasonText.trim().slice(0, 200) : undefined;
    toRollingDetail(await serverRequest<ServerHotRollingDetail>('POST', `/production-plans/${planId}/hot-rolling/allocations/${input.allocationId}/release`, { body: { reason } }));
    return { allocationId: input.allocationId };
  },

  registerHotRolling: async (input: HotRollingResultInput): Promise<{ productionResultId: number; coilNos: string[] }> => {
    const r = await serverRequest<ServerResultView>('POST', '/production-results', {
      body: {
        processType: 'HOT_ROLLING',
        productionPlanId: input.productionPlanId,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        allocationIds: input.allocationIds && input.allocationIds.length > 0 ? input.allocationIds : undefined,
      },
    });
    return { productionResultId: r.id, coilNos: r.outputs.map((o) => o.lotNo) };
  },
};
