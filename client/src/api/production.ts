// 생산계획·히트 편성·공정 실적·실적 시뮬레이션 API — docs/api/production.md 의 모양 그대로.
// Decimal은 문자열(…Ton은 소수 3자리), 날짜·시각은 ISO 문자열이다.
import type { ProcessCode, ProductionPlanStatus, ProductionResultStatus } from '@fantasteel/shared';
import { api } from './client';

export type ProductItemType = 'SLAB' | 'COIL';

export interface SpecView {
  id: number;
  specCode: string;
  itemType: ProductItemType;
  steelGradeCode: string;
  thicknessMm: string;
  widthMm: string;
  lengthMm: string;
  theoreticalWeightTon: string;
}

export interface PlanSalesOrder {
  salesOrderId: number;
  salesOrderNo: string;
  salesOrderItemId: number;
  lineNo: number;
  orderedQty: number;
  salesOrderItemStatus: string;
  customerName: string;
  dueDate: string;
  ownerEmployeeName: string;
}

export interface PlanProgress { processCode: ProcessCode; totalCount: number; startedCount: number; completedCount: number }

/** 목록의 한 줄이자 상세의 앞부분 */
export interface PlanSummary {
  id: number;
  productionPlanNo: string;
  productionPlanStatus: ProductionPlanStatus;
  isReproduction: boolean;
  itemType: ProductItemType;
  productSpec: SpecView;
  /** 연주에서 만들 슬래브 규격. 매핑이 없으면 null */
  slabSpec: SpecView | null;
  steelGrade: { id: number; steelGradeCode: string; steelGradeName: string };
  /** 수주 취소로 연결이 끊긴 계획은 null */
  salesOrder: PlanSalesOrder | null;
  /** 목표 매수 (슬래브 매 / 코일 개) */
  shortageQty: number;
  shortageTon: string;
  surplusUseQty: number;
  heatCount: number;
  plannedSlabQty: number;
  requiredInputTon: string;
  cumulativeYieldRate: string | null;
  progress: PlanProgress[];
  needsAction: boolean;
  createdAt: string;
  confirmedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

export type ProductionLotType = 'HOT_METAL' | 'HEAT' | 'SLAB' | 'COIL';

export interface PlanLotView {
  id: number;
  lotNo: string;
  lotType: ProductionLotType;
  lotStatus: 'IN_STOCK' | 'CONSUMED' | 'SHIPPED';
  /** 자기 검사 결과. null = 검사 전 (용선은 항상 null) */
  isPassed: boolean | null;
  heatLotId: number | null;
  heatLotNo: string | null;
  heatIsPassed: boolean | null;
  isEligible: boolean;
  isEarmarked: boolean;
  confirmedAllocationId: number | null;
  productSpecId: number | null;
  specCode: string | null;
  weightTon: string | null;
  initialTon: string | null;
  remainingTon: string | null;
  salesOrderItemId: number | null;
  productionPlanId: number | null;
  productionResultId: number | null;
  dispositionStatus: 'HOLD' | 'DOWNGRADED' | 'SCRAPPED' | null;
  producedAt: string;
}

export interface ResultLot { id: number; lotNo: string; lotType: string; isPassed: boolean | null }

export interface ResultView {
  id: number;
  productionPlanId: number;
  productionPlanNo: string;
  processCode: ProcessCode;
  /** 제강·연주: 계획 안의 히트 순번(1부터). 제선·열연은 null */
  heatSeq: number | null;
  productionResultStatus: ProductionResultStatus;
  startedAt: string | null;
  completedAt: string | null;
  blastFurnaceNo: string | null;
  converterNo: string | null;
  inputTon: string | null;
  outputTon: string | null;
  plannedQty: number | null;
  outputQty: number | null;
  lossQty: number | null;
  sampledLossRate: string | null;
  isSimulated: boolean;
  operatorEmployeeId: number | null;
  /** 대기·작업 중인 제선 실적에만: 아직 필요한 용선 톤 */
  defaultHotMetalTon: string | null;
  lots: ResultLot[];
}

export type RollingAllocationStatus = 'CONFIRMED' | 'CONSUMED' | 'RELEASED';
export interface PlanRollingAllocation {
  id: number;
  status: RollingAllocationStatus;
  lotId: number;
  lotNo: string;
  heatLotNo: string | null;
  confirmedAt: string;
  consumedAt: string | null;
  releasedAt: string | null;
}

export interface PlanRolling {
  rolledQty: number;
  remainingQty: number;
  rollingNeedQty: number;
  earmarkedSlabQty: number;
  confirmedAllocationQty: number;
}

export interface PlanDetail extends PlanSummary {
  results: ResultView[];
  lots: { hotMetals: PlanLotView[]; heats: PlanLotView[]; slabs: PlanLotView[]; coils: PlanLotView[] };
  earmarkedSlabs: PlanLotView[];
  rollingAllocations: PlanRollingAllocation[];
  /** 코일 계획만. 슬래브 계획은 null */
  rolling: PlanRolling | null;
  surplus: { expectedQty: number; actualQty: number };
  remainingTargetQty: number;
}

export interface HeatPreviewRawMaterial {
  rawMaterialId: number;
  materialCode: string;
  rawMaterialName: string;
  rawMaterialType: 'IRON_ORE' | 'COAL' | 'LIMESTONE' | 'FERROALLOY';
  requiredTon: string;
  remainingTon: string;
  shortageTon: string;
  isShort: boolean;
}

export interface HeatPreview {
  productionPlanId: number;
  productionPlanNo: string;
  productionPlanStatus: string;
  itemType: ProductItemType;
  shortageQty: number;
  surplusUseQty: number;
  targetQty: number;
  targetTon: string;
  steelmakingYieldRate: string;
  castingYieldRate: string;
  hotRollingYieldRate: string;
  cumulativeYieldRate: string;
  requiredInputTon: string;
  heatCapacityTon: string;
  heatCount: number;
  heatTon: string;
  hotMetalTon: string;
  slabQtyPerHeat: number;
  plannedSlabQty: number;
  expectedSurplusQty: number;
  slabSpecId: number;
  surplus: { availableQty: number; maxUseQty: number; lots: PlanLotView[] };
  rawMaterials: HeatPreviewRawMaterial[];
  hasRawShortage: boolean;
}

export interface ReproductionPreview {
  salesOrderItemId: number;
  salesOrderId: number;
  salesOrderNo: string;
  lineNo: number;
  customerName: string;
  salesOrderItemStatus: string;
  productSpec: SpecView;
  orderedQty: number;
  shippedQty: number;
  unsecuredQty: number;
  openPlans: { id: number; productionPlanNo: string; productionPlanStatus: ProductionPlanStatus; shortageQty: number; remainingTargetQty: number }[];
  openPlanRemainingQty: number;
  /** 추가 계획 필요 매수. 0이면 재생산 불가 */
  additionalQty: number;
  stockAvailableQty: number;
  planQty: number;
  /** 코일 품목만 */
  surplus: { slabSpec: SpecView; availableQty: number; lots: PlanLotView[] } | null;
}

export interface ReproductionResult {
  additionalQty: number;
  reservedFromStockQty: number;
  planQty: number;
  /** planQty가 0이면 null (재고로 모두 채워 계획을 만들지 않음) */
  plan: PlanDetail | null;
}

export interface CompleteBody {
  /** 제선 필수. 영문·숫자 4자 이내 */
  blastFurnaceNo?: string;
  /** 제선 선택. 비우면 defaultHotMetalTon */
  hotMetalTon?: string;
  /** 제강 필수. 영문·숫자 4자 이내 */
  converterNo?: string;
  /** 연주 필수. 0 이상 정수, plannedQty 이하 */
  outputQty?: number;
  /** 열연 선택. 비우면 이 계획의 CONFIRMED 열연 배정 전부 */
  allocationIds?: number[];
}

export interface SimulateBody { seed?: number; includeInspection?: boolean; untilProcess?: ProcessCode }

export interface SimulateStep {
  kind: 'RESULT' | 'INSPECTION' | 'ALLOCATION';
  processCode: ProcessCode;
  heatSeq: number | null;
  productionResultId: number | null;
  lotNos: string[];
  plannedQty: number | null;
  outputQty: number | null;
  lossQty: number | null;
}

export interface SimulateResult {
  productionPlanId: number;
  seed: number;
  sampledLossRate: string | null;
  includeInspection: boolean;
  untilProcess: ProcessCode | null;
  steps: SimulateStep[];
  notes: string[];
  plan: PlanDetail;
}

export interface PlanListQuery { status?: ProductionPlanStatus; itemType?: ProductItemType; needsAction?: boolean }
export interface ResultListQuery { planId?: number; processCode?: ProcessCode; status?: ProductionResultStatus }

export const productionApi = {
  plans: (q: PlanListQuery = {}) => api.get<PlanSummary[]>('/production-plans', { ...q }),
  plan: (id: number) => api.get<PlanDetail>(`/production-plans/${id}`),
  heatPreview: (id: number, surplusUseQty: number) => api.post<HeatPreview>(`/production-plans/${id}/heat-preview`, { surplusUseQty }),
  confirm: (input: { id: number; surplusUseQty: number }) => api.post<PlanDetail>(`/production-plans/${input.id}/confirm`, { surplusUseQty: input.surplusUseQty }),
  cancel: (input: { id: number; reason?: string }) => api.post<PlanDetail>(`/production-plans/${input.id}/cancel`, { reason: input.reason || undefined }),
  reproductionPreview: (salesOrderItemId: number) => api.get<ReproductionPreview>('/production-plans/reproduction-preview', { salesOrderItemId }),
  createReproduction: (input: { salesOrderItemId: number; reason?: string }) =>
    api.post<ReproductionResult>('/production-plans', { salesOrderItemId: input.salesOrderItemId, reason: input.reason || undefined }),
  simulate: (input: { id: number; body: SimulateBody }) => api.post<SimulateResult>(`/production-plans/${input.id}/simulate-results`, input.body),

  results: (q: ResultListQuery = {}) => api.get<ResultView[]>('/production-results', { ...q }),
  startResult: (id: number) => api.post<ResultView>(`/production-results/${id}/start`),
  completeResult: (input: { id: number; body: CompleteBody }) => api.post<ResultView>(`/production-results/${input.id}/complete`, input.body),
};
