// 생산계획 API (REQ-PRD-001·002·006, BP-PRD-01, BP-QC-01 재생산, 업무 프로세스 4.4·4.5·10장).
// 계획은 수주 등록 때 core 서비스가 히트 편성까지 계산해 만든다. 이 화면은 편성표·진행·LOT을 보여 주고,
// 생산 담당은 PLANNED 계획 취소와 재생산 계획 만들기를 한다 (PRODUCTION_PLAN_CONFIRM 사용 권한).
// 규칙·작업 로그는 core 서비스(@/mock/services)가 처리한다. 이 파일은 권한 확인(requireActor) + 서비스 호출 + 화면용 조회만 한다.
// 서버 모드(기본)면 실제 서버를 부른다 (api/server/production.ts).
import { PERMISSION, type AllocationPurpose, type InspectionResult, type LotStatus, type LotType, type ProductItemType, type ProductionPlanStatus, type SalesOrderItemStatus } from '@/codes';
import { mockMutation, mockQuery } from '@/api/client';
import { requireActor } from '@/api/actor';
import { isServerDataSource } from '@/api/http';
import { serverProductionPlanApi } from '@/api/server/production';
import type { LotRow, MockTables, ProductionPlanRow, SalesOrderItemRow } from '@/mock/schema';
import {
  cancelProductionPlan,
  confirmedAllocationOf,
  createReproductionPlan,
  employeeNameOf,
  findById,
  heatOf,
  itemShortageOf,
  listProductionPlans,
  mustGet,
  planProgressOf,
  productionPlanView,
  userActor,
  type ProductionPlanSummary,
} from '@/mock/services';

type Tables = Readonly<MockTables>;

export const productionPlanKeys = {
  all: ['production-plans'] as const,
  list: () => ['production-plans', 'list'] as const,
  detail: (id: number) => ['production-plans', 'detail', id] as const,
};

/** 생산계획을 볼 수 있는 권한 (조회 이상) */
const PLAN_VIEW = [PERMISSION.PRODUCTION_PLAN_CONFIRM] as const;

/**
 * LOT 품질 표시: NONE 검사 없음(원료·용선) · PENDING 판정 대기 · PASS 합격 · FAIL 불합격
 * · HEAT_PENDING 제품은 합격, 상위 히트 판정 대기 · HEAT_FAILED 상위 히트 불합격으로 제외
 */
export type LotQuality = 'NONE' | 'PENDING' | 'PASS' | 'FAIL' | 'HEAT_PENDING' | 'HEAT_FAILED';

/** LOT의 품질 표시 (판정 값만 본다. 적격 여부 계산은 core의 lotEligibility) */
export function lotQualityOf(lot: Pick<LotRow, 'lotType' | 'isPassed'>, heat: Pick<LotRow, 'isPassed'> | null | undefined): LotQuality {
  if (lot.lotType === 'RAW_MATERIAL' || lot.lotType === 'HOT_METAL') return 'NONE';
  if (lot.isPassed === false) return 'FAIL';
  if (lot.lotType !== 'HEAT' && heat?.isPassed === false) return 'HEAT_FAILED';
  if (lot.isPassed === null) return 'PENDING';
  if (lot.lotType !== 'HEAT' && (!heat || heat.isPassed === null)) return 'HEAT_PENDING';
  return 'PASS';
}

export interface PlanLotRow {
  id: number;
  lotNo: string;
  lotType: LotType;
  lotStatus: LotStatus;
  itemCode: string | null;
  /** 상위 히트 (슬래브·코일) */
  heatLotId: number | null;
  heatNo: string | null;
  /** 생산완료일 (날짜) */
  producedDate: string;
  /** 용선: 용선량 · 히트: 히트 톤 */
  initialTon: string | null;
  /** 용선 잔량 */
  remainingTon: string | null;
  quality: LotQuality;
  /** 여재 표시 시각 (미배정 합격 슬래브) */
  surplusAt: string | null;
  dispositionStatus: LotRow['dispositionStatus'];
  /** CONFIRMED 배정의 목적 (없으면 null) */
  allocationPurpose: AllocationPurpose | null;
  yardName: string | null;
}

export function planLotRowOf(tables: Tables, lot: LotRow): PlanLotRow {
  const heat = heatOf(tables, lot);
  return {
    id: lot.id,
    lotNo: lot.lotNo,
    lotType: lot.lotType,
    lotStatus: lot.lotStatus,
    itemCode: findById(tables, 'item', lot.itemId)?.itemCode ?? null,
    heatLotId: heat?.id ?? null,
    heatNo: heat?.lotNo ?? null,
    producedDate: lot.producedDate,
    initialTon: lot.initialTon,
    remainingTon: lot.remainingTon,
    quality: lotQualityOf(lot, heat),
    surplusAt: lot.surplusAt,
    dispositionStatus: lot.dispositionStatus,
    allocationPurpose: confirmedAllocationOf(tables, lot.id)?.allocationPurpose ?? null,
    yardName: findById(tables, 'yard', lot.yardId)?.yardName ?? null,
  };
}

export interface OpenPlanOfItem {
  id: number;
  productionPlanNo: string;
  productionPlanStatus: ProductionPlanStatus;
  isReproduction: boolean;
  shortageQty: number;
  remainingTargetQty: number;
}

/** 수주 품목의 부족·재생산 판단 (4.5, 14.1-6) */
export interface ReproductionCheck {
  salesOrderItemId: number;
  salesOrderId: number;
  salesOrderNo: string;
  lineNo: number;
  salesOrderItemStatus: SalesOrderItemStatus;
  orderedQty: number;
  shippedQty: number;
  /** 미출하 = 수주 매수 − 출고 누계 */
  unshippedQty: number;
  activeReservedQty: number;
  /** 현재 미확보 = max(0, 미출하 − ACTIVE 예약) */
  unsecuredQty: number;
  /** 진행 계획 잔여 목표 합계 */
  openPlanRemainingQty: number;
  /** 추가 계획 필요 = max(0, 현재 미확보 − 진행 계획 잔여 목표) */
  additionalPlanQty: number;
  /** 같은 규격 예약 가용 (여재 포함) */
  reservationAvailableQty: number;
  /**
   * 재생산 계획을 만들 때 먼저 여재로 예약하는 매수 = min(현재 미확보, 예약 가용).
   * core createReproductionPlan → reserveUpToShortage가 실제로 예약하는 수와 같다 (진행 계획 잔여 목표로 덮인 몫도 재고로 먼저 잡는다).
   */
  surplusReserveQty: number;
  /** 재생산 필요 = max(0, 추가 계획 필요 − 예약 가용) */
  reproductionNeedQty: number;
  openPlans: OpenPlanOfItem[];
  /** 진행중인 품목이라 재생산·여재 채우기를 할 수 있는지 */
  canReproduce: boolean;
}

export function reproductionCheckOf(tables: Tables, soItem: SalesOrderItemRow): ReproductionCheck {
  const so = mustGet(tables, 'salesOrder', soItem.salesOrderId, '수주');
  const shortage = itemShortageOf(tables, soItem);
  const openPlans = tables.productionPlan
    .filter((p) => p.salesOrderItemId === soItem.id && p.productionPlanStatus !== 'CANCELLED')
    .sort((a, b) => a.id - b.id)
    .map((p: ProductionPlanRow) => ({
      id: p.id,
      productionPlanNo: p.productionPlanNo,
      productionPlanStatus: p.productionPlanStatus,
      isReproduction: p.isReproduction,
      shortageQty: p.shortageQty,
      remainingTargetQty: planProgressOf(tables, p).remainingTargetQty,
    }));
  return {
    salesOrderItemId: soItem.id,
    salesOrderId: so.id,
    salesOrderNo: so.salesOrderNo,
    lineNo: soItem.lineNo,
    salesOrderItemStatus: soItem.salesOrderItemStatus,
    orderedQty: soItem.orderedQty,
    shippedQty: soItem.shippedQty,
    unshippedQty: shortage.unshippedQty,
    activeReservedQty: shortage.activeReservedQty,
    unsecuredQty: shortage.unsecuredQty,
    openPlanRemainingQty: shortage.openPlanRemainingQty,
    additionalPlanQty: shortage.additionalPlanQty,
    reservationAvailableQty: shortage.reservationAvailableQty,
    surplusReserveQty: Math.min(shortage.unsecuredQty, shortage.reservationAvailableQty),
    reproductionNeedQty: shortage.reproductionNeedQty,
    openPlans,
    canReproduce: soItem.salesOrderItemStatus === 'OPEN' || soItem.salesOrderItemStatus === 'PARTIALLY_SHIPPED',
  };
}

export interface PlanProgress {
  /** 편성한 히트 수 */
  heatCount: number;
  /** 제강 실적으로 만든 히트 수 */
  heatsMadeQty: number;
  /** 연주까지 끝난 히트 수 */
  heatsCastQty: number;
  /** 이 계획에서 나온 용선 톤 합계 */
  hotMetalTon: string;
  slabQty: number;
  coilQty: number;
  /** 코일 계획: 불합격(히트 불합격 포함)을 뺀 코일 = 합격 + 판정 대기. 불합격 코일은 '만든 코일'로 세지 않는다 (BP-QC-01) */
  usableCoilQty: number;
  /** 계획 품목(슬래브 계획 = 슬래브, 코일 계획 = 코일) 중 합격(히트 합격 포함) 매수 — 소진·출고 포함 */
  passedQty: number;
  /** 계획 품목 중 판정 대기 매수 (미소진) */
  pendingQty: number;
  /** 계획 품목 중 불합격·히트 불합격 매수 */
  failedQty: number;
  /** 코일 계획: 이 계획에 열연 배정(CONFIRMED)된 슬래브 매수 */
  hotRollingAllocatedQty: number;
  /** 코일 계획: 이 계획이 만든, 아직 열연할 수 있는 슬래브(적격·판정 대기, 미배정) */
  ownRollableSlabQty: number;
  /**
   * 코일 계획: 그 슬래브 중 지금 열연 배정할 수 있는 몫 = 판정 대기 + min(적격 미배정, 슬래브 규격 예약 가용).
   * 적격 슬래브는 예약 가용에 들어 있어 다른 수주가 재고 우선 예약으로 가져갈 수 있다 (REQ-INV-008).
   */
  ownAllocatableSlabQty: number;
  /** 모든 히트를 연주까지 마쳤는지 */
  allHeatsCast: boolean;
  /** 산출 완료 (COMPLETED 조건). 코일 계획(수주 연결)은 불합격을 뺀 코일 ≥ 부족 매수 */
  outputComplete: boolean;
  /**
   * 진행 계획 잔여 목표 매수 (4.5): 취소·수주 연결 없음 → 0. 아직 연주할 히트가 남았으면 부족 매수 − 합격 매수.
   * 모두 연주했으면 그 값과 '아직 합격할 수 있는 매수' 중 작은 값. 아직 합격할 수 있는 매수 = 판정 대기
   * + (코일 계획이 완료 전이면) 열연 배정 + 지금 배정할 수 있는 자기 슬래브. 완료된 계획은 더 열연하지 않으므로 판정 대기만.
   */
  remainingTargetQty: number;
}

export interface PlanHeatView {
  /** 편성 안의 순번 (1부터) */
  seq: number;
  heatLotId: number | null;
  heatNo: string | null;
  converterCode: string | null;
  producedDate: string | null;
  heatTon: string | null;
  /** 히트 성분 판정: null = 아직 히트 없음 */
  inspectionResult: InspectionResult | null;
  castDone: boolean;
  slabQty: number;
}

export interface ProductionResultView {
  id: number;
  processType: string;
  blastFurnaceCode: string | null;
  converterCode: string | null;
  startedAt: string;
  completedAt: string | null;
  inputTon: string | null;
  outputTon: string | null;
  outputQty: number | null;
  lossQty: number | null;
  sampleLossRate: string | null;
  randomSeed: number | null;
  isSimulated: boolean;
  operatorName: string | null;
  outputLotNos: string[];
}

export interface ProductionPlanView {
  id: number;
  productionPlanNo: string;
  productionPlanStatus: ProductionPlanStatus;
  isReproduction: boolean;
  isSurplusOnCompletion: boolean;
  createdAt: string;
  createdEmployeeName: string | null;
  cancelledAt: string | null;
  updatedAt: string;
  item: { id: number; itemCode: string; itemName: string; itemType: ProductItemType; steelGradeCode: string | null; theoreticalWeightTon: string };
  /** 연주할 슬래브 규격 (코일 계획 = 매핑된 슬래브) */
  slabSpec: { id: number; itemCode: string; itemName: string; theoreticalWeightTon: string } | null;
  salesOrder: { salesOrderId: number; salesOrderNo: string; salesOrderItemId: number; lineNo: number; customerName: string | null; dueDate: string; orderedQty: number } | null;
  /** 편성표 (14.1-2: 히트 전체 톤과 수주 목표를 나눠 보인다) */
  formation: {
    shortageQty: number;
    /** 수주 목표 = 부족 매수 × 1매 이론중량 */
    targetWeightTon: string;
    cumulativeYieldRate: string;
    requiredSteelTon: string;
    heatCount: number;
    heatCapacityTon: string;
    heatTon: string;
    slabQtyPerHeat: number;
    plannedSlabQty: number;
    expectedSurplusSlabQty: number;
  } | null;
  progress: PlanProgress;
  heats: PlanHeatView[];
  results: ProductionResultView[];
  /** PLANNED일 때만 취소 가능 */
  canCancel: boolean;
}

export interface ProductionPlanDetail extends ProductionPlanView {
  /** 연결된 수주 품목의 상태·담당 (연결이 없으면 null) */
  salesOrderItemStatus: SalesOrderItemStatus | null;
  salesOrderOwnerName: string | null;
  /** 이 계획에서 나온 LOT (용선·히트·슬래브·코일) */
  lots: PlanLotRow[];
  /** 연결 수주 품목의 부족·재생산 판단 (연결이 없으면 null) */
  reproduction: ReproductionCheck | null;
}

function planDetailOf(tables: Tables, planId: number): ProductionPlanDetail {
  const view = productionPlanView(tables, planId);
  const soItem = view.salesOrder ? findById(tables, 'salesOrderItem', view.salesOrder.salesOrderItemId) : undefined;
  const so = soItem ? findById(tables, 'salesOrder', soItem.salesOrderId) : undefined;
  const lots = tables.lot.filter((l) => l.productionPlanId === planId).sort((a, b) => a.id - b.id);
  return {
    ...view,
    salesOrderItemStatus: soItem?.salesOrderItemStatus ?? null,
    salesOrderOwnerName: so ? employeeNameOf(tables, so.ownerEmployeeId) : null,
    lots: lots.map((lot) => planLotRowOf(tables, lot)),
    reproduction: soItem ? reproductionCheckOf(tables, soItem) : null,
  };
}

/** 목록 한 줄: 계획 요약 + 고객사 (옛 화면처럼 수주번호·고객사로 찾고 구분한다, reports/3 A-1) */
export type ProductionPlanListRow = ProductionPlanSummary & { customerName: string | null };

export function withCustomerNames(tables: Tables, plans: readonly ProductionPlanSummary[]): ProductionPlanListRow[] {
  return plans.map((p) => {
    const so = p.salesOrderId !== null ? findById(tables, 'salesOrder', p.salesOrderId) : undefined;
    return { ...p, customerName: so ? (findById(tables, 'customer', so.customerId)?.customerName ?? null) : null };
  });
}

export interface CancelPlanInput {
  productionPlanId: number;
  reasonText?: string | null;
  /** 화면을 연 시점의 updatedAt (다른 탭에서 바뀌었으면 COM-001) */
  expectedUpdatedAt?: string | null;
}

export interface ReproductionResult {
  /** 여재(예약 가용)로 먼저 예약한 매수 */
  reservedFromSurplusQty: number;
  /** 새로 만든 재생산 계획 (여재로 다 채웠으면 null) */
  plan: { id: number; productionPlanNo: string; shortageQty: number } | null;
}

export const productionPlanApi = {
  /** 생산계획 목록 (최근 것 먼저, 고객사 포함) */
  list: (): Promise<ProductionPlanListRow[]> =>
    isServerDataSource()
      ? serverProductionPlanApi.list()
      : mockQuery((tables) => {
      requireActor(tables, { view: PLAN_VIEW });
      return withCustomerNames(tables, listProductionPlans(tables));
    }),

  /** 생산계획 상세: 편성표·히트·작업 실적·LOT·재생산 판단 */
  detail: (productionPlanId: number): Promise<ProductionPlanDetail> =>
    isServerDataSource()
      ? serverProductionPlanApi.detail(productionPlanId)
      : mockQuery((tables) => {
      requireActor(tables, { view: PLAN_VIEW });
      return planDetailOf(tables, productionPlanId);
    }),

  /** 생산 담당의 계획 취소: PLANNED일 때만 (10장). 작업 로그 PRODUCTION_PLAN_CANCELLED는 서비스가 남긴다. */
  cancel: (input: CancelPlanInput): Promise<{ id: number; productionPlanNo: string }> =>
    isServerDataSource()
      ? serverProductionPlanApi.cancel(input)
      : mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: [PERMISSION.PRODUCTION_PLAN_CONFIRM] });
      const plan = cancelProductionPlan(tx, userActor(actor.employee.id), {
        productionPlanId: input.productionPlanId,
        reasonText: input.reasonText?.trim() ? input.reasonText.trim().slice(0, 500) : null,
        expectedUpdatedAt: input.expectedUpdatedAt ?? null,
      });
      return { id: plan.id, productionPlanNo: plan.productionPlanNo };
    }),

  /**
   * 재생산 (REQ-PRD-006, 14.1-6): 사람이 누를 때만 만든다. 먼저 같은 규격 여재로 미확보분(min(현재 미확보, 예약 가용))을 예약하고,
   * 그래도 '추가 계획 필요'가 남으면 is_reproduction 계획을 만든다 (REPRODUCTION_PLAN_CREATED).
   */
  createReproduction: (input: { salesOrderItemId: number }): Promise<ReproductionResult> =>
    isServerDataSource()
      ? serverProductionPlanApi.createReproduction(input)
      : mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: [PERMISSION.PRODUCTION_PLAN_CONFIRM] });
      const result = createReproductionPlan(tx, userActor(actor.employee.id), { salesOrderItemId: input.salesOrderItemId });
      return {
        reservedFromSurplusQty: result.reservedFromSurplusQty,
        plan: result.plan ? { id: result.plan.id, productionPlanNo: result.plan.productionPlanNo, shortageQty: result.plan.shortageQty } : null,
      };
    }),
};

export type { ProductionPlanSummary };
