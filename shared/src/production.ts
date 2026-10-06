// 생산 모듈 응답 타입 (docs/backend/production.md). 톤은 소수 3자리 문자열, 수율은 소수 4자리 문자열, 매수는 정수.
import type { AllocationPurpose, AllocationStatus, DispositionStatus, InspectionResult, ItemType, LotStatus, LotType, ProcessType, ProductionPlanStatus, RawMaterialType, SalesOrderItemStatus } from './codes';
import type { AllocationView } from './shipment';

/** 생산계획 목록 한 줄 (GET /production-plans) */
export interface ProductionPlanSummary {
  id: number;
  productionPlanNo: string;
  productionPlanStatus: ProductionPlanStatus;
  /** 재생산 계획 (REQ-PRD-006) */
  isReproduction: boolean;
  itemId: number;
  itemCode: string;
  itemName: string;
  itemType: ItemType;
  steelGradeCode: string | null;
  /** 부족 매수 (TRM-041). 코일 계획은 코일 개수 */
  shortageQty: number;
  heatCount: number;
  /** 수주 연결이 없으면(수주 취소로 해제) null */
  salesOrderId: number | null;
  salesOrderNo: string | null;
  salesOrderItemId: number | null;
  customerName: string | null;
  /** 품목 납기 'YYYY-MM-DD' */
  dueDate: string | null;
  /** 필요 용강 (지금 기준정보로 계산, 기준정보가 모자라면 null) */
  requiredMoltenSteelTon: string | null;
  /** 제강 실적으로 만든 히트 수 */
  heatsMadeQty: number;
  /** 연주까지 한 히트 수 */
  heatsCastQty: number;
  /** 계획 규격 제품 중 합격 매수 */
  passedQty: number;
  /** 진행 계획 잔여 목표 (4.5) */
  remainingTargetQty: number;
  createdAt: string;
}

/**
 * 히트 편성표 (업무 프로세스 4.4, REQ-PRD-002). 저장하지 않는 계산값.
 * 히트당 슬래브 매수·계획 슬래브·예상 여재는 4.4에 없는 값이라 정했다 (docs/backend/production.md 8장 "계획 슬래브 매수").
 */
export interface HeatFormation {
  shortageQty: number;
  /** 제품(계획 규격) 1매 이론중량 */
  theoreticalWeightTon: string;
  /** 목표중량 = 부족 매수 × 1매 이론중량 */
  targetTon: string;
  castingYieldRate: string;
  /** 코일만: 코일 이론중량 ÷ 슬래브 이론중량 (저장하지 않음). 슬래브 계획은 null */
  hotRollingYieldRate: string | null;
  /** 연주 × 열연 (슬래브는 연주만) */
  cumulativeYieldRate: string;
  /** 필요 용강 = 목표중량 ÷ 누적 계획수율 */
  requiredMoltenSteelTon: string;
  heatCapacityTon: string;
  /** ceil(필요 용강 ÷ 히트 용량) — 지금 기준정보로 다시 계산한 값 */
  heatCount: number;
  heatTon: string;
  steelmakingYieldRate: string;
  /** 필요 용선 = 히트 톤 ÷ 제강 수율 */
  requiredHotMetalTon: string;
  /** 연주할 슬래브 규격 (코일 계획은 매핑된 슬래브) */
  slabItemId: number;
  slabItemCode: string;
  slabTheoreticalWeightTon: string;
  /** floor(히트 용량 × 연주 수율 ÷ 슬래브 1매 이론중량) */
  slabQtyPerHeat: number;
  /** 히트당 슬래브 × 히트 수 */
  plannedSlabQty: number;
  /** max(0, 계획 슬래브 − 부족 매수) — 수주에 쓰지 않고 남을 슬래브 */
  expectedSurplusSlabQty: number;
  /** 계획에 저장된 히트 수. 기준정보가 바뀌면 heatCount와 다를 수 있다 (확정하면 다시 저장) */
  savedHeatCount: number;
}

/** 생산 LOT의 판정: 제품은 자기 검사 + 상위 히트 검사를 함께 본다 (REQ-INV-003) */
export type LotJudgement = 'PENDING' | 'PASS' | 'FAIL';

/** 계획에서 만든 LOT (히트·슬래브·코일) */
export interface PlanLot {
  lotId: number;
  lotNo: string;
  lotType: LotType;
  lotStatus: LotStatus;
  itemId: number | null;
  itemCode: string | null;
  /** 히트 톤(히트), 슬래브·코일은 null */
  initialTon: string | null;
  /** 생산완료일 'YYYY-MM-DD' (슬래브·코일) */
  producedDate: string | null;
  /** 만든 공정. 계획 LOT은 모두 실적이 있다 */
  processType: ProcessType | null;
  productionResultId: number | null;
  /** 자기 검사 판정. 검사 행이 없으면 null(판정 대기) */
  inspectionResult: InspectionResult | null;
  /** 상위 히트 (슬래브는 부모, 코일은 부모 슬래브의 부모). 히트 자신이면 null */
  heatLotId: number | null;
  heatLotNo: string | null;
  heatInspectionResult: InspectionResult | null;
  /** 히트는 자기 판정, 제품은 자기 + 상위 히트 판정 */
  judgement: LotJudgement;
  /** 원료·용선 잔량 */
  remainingTon: string | null;
  dispositionStatus: DispositionStatus | null;
  /** 확정(CONFIRMED) 배정의 목적. 없으면 null */
  allocationPurpose: AllocationPurpose | null;
  yardName: string | null;
  /** 코일: 투입한 슬래브 번호 */
  parentSlabNo: string | null;
}

/** 계획 진행 (분모를 함께 준다, 업무 프로세스 4.5) */
export interface PlanProgress {
  heatCount: number;
  /** 만든 히트 수 (제강 실적) */
  madeHeatQty: number;
  /** 연주까지 한 히트 수 */
  castHeatQty: number;
  slabQty: number;
  /** 코일 계획만: 만든 코일 수 */
  coilQty: number;
  /** 계획 규격 제품 중 합격(자기 + 히트) 매수 */
  passedQty: number;
  /** 계획 규격 제품 중 판정 대기 매수 (재고 상태) */
  pendingQty: number;
  failedQty: number;
  /** 완료 시각이 없는 작업 실적 (작업 중) */
  openWorkCount: number;
  /** 코일 계획: 불합격을 뺀 코일 */
  usableCoilQty: number;
  /** 코일 계획: 확정(CONFIRMED) 열연 배정 */
  hotRollingAllocatedQty: number;
  /** 코일 계획: 이 계획이 만든, 아직 열연할 수 있는 슬래브 (재고 상태·불합격 아님·미배정) */
  ownRollableSlabQty: number;
  allHeatsCast: boolean;
  /** 진행 계획 잔여 목표 (4.5) */
  remainingTargetQty: number;
}

/** 편성한 히트 한 줄 (편성 순번) */
export interface PlanHeat {
  seq: number;
  /** 아직 만들지 않은 히트면 null */
  heatLotId: number | null;
  heatNo: string | null;
  converterCode: string | null;
  /** 제강 완료일 'YYYY-MM-DD' */
  producedDate: string | null;
  heatTon: string | null;
  /** 히트 성분 판정. 히트가 없으면 null, 검사 전이면 PENDING */
  inspectionResult: InspectionResult | null;
  castDone: boolean;
  slabQty: number;
}

/**
 * 재생산 판단 (업무 프로세스 4.5, 14.1-6). 수주 품목 기준.
 * 진행 계획 잔여 목표는 완료 계획이라도 판정 대기 제품이 남아 있으면 그만큼 남긴다 (검사 중인 제품을 재생산으로 다시 만들지 않게).
 */
export interface ReproductionCheck {
  salesOrderItemId: number;
  salesOrderId: number;
  salesOrderNo: string;
  /** 수주 안 품목 순번 (품목 id 순, ERD에 줄 번호 칸이 없어 계산) */
  lineNo: number;
  salesOrderItemStatus: SalesOrderItemStatus;
  /** 미출하 = 주문 − 출고 */
  unshippedQty: number;
  /** 연결 계획 (취소 제외) */
  openPlans: { id: number; productionPlanNo: string; productionPlanStatus: ProductionPlanStatus; isReproduction: boolean; shortageQty: number; remainingTargetQty: number }[];
  orderedQty: number;
  shippedQty: number;
  activeReservedQty: number;
  /** 현재 미확보 = max(0, 미출하 − ACTIVE 예약) */
  unsecuredQty: number;
  /** 진행 계획 잔여 목표 합계 */
  openPlanRemainingQty: number;
  /** 추가 계획 필요 = max(0, 미확보 − 진행 계획 잔여 목표) */
  additionalPlanQty: number;
  /** 같은 규격의 예약 가용 (여재 포함) */
  reservationAvailableQty: number;
  /** 재생산 필요 = max(0, 추가 계획 필요 − 예약 가용) */
  reproductionNeedQty: number;
}

/** 생산계획 상세 (GET /production-plans/:id) */
export interface ProductionPlanDetail extends ProductionPlanSummary {
  salesOrderItem: {
    id: number;
    orderedQty: number;
    salesOrderItemStatus: SalesOrderItemStatus;
  } | null;
  /** 기준정보가 모자라 계산할 수 없으면 null, 이유는 formationError */
  formation: HeatFormation | null;
  formationError: string | null;
  progress: PlanProgress;
  lots: PlanLot[];
  reproduction: ReproductionCheck | null;
  /** PLANNED일 때만 취소·히트 편성 확정 */
  canCancel: boolean;
  canConfirm: boolean;
  /** 이 계획의 작업 실적 (제강·연주·열연. 제선은 계획에 묶이지 않는다) */
  results: ProductionResultView[];
  heats: PlanHeat[];
  /** 계획을 만든 사원 (작업 로그) */
  createdEmployeeName: string | null;
  /** 취소 시각 (작업 로그) */
  cancelledAt: string | null;
  salesOrderOwnerName: string | null;
  salesOrderLineNo: number | null;
  updatedAt: string;
}

// ── 작업 실적 (API-207·208, REQ-PRD-003, BP-PRD-02) ─────────────

/** 실적에 투입된 LOT (원료→용선 기간 기반, 그 밖 실제 투입) */
export interface ResultInputLot {
  lotId: number;
  lotNo: string;
  lotType: LotType;
  itemCode: string | null;
  /** 차감 톤. 히트→슬래브·슬래브→코일은 null */
  inputTon: string | null;
}

/** 실적이 만든 LOT */
export interface ResultOutputLot {
  lotId: number;
  lotNo: string;
  lotType: LotType;
  itemCode: string | null;
  /** 용선·히트 톤. 슬래브·코일은 null (톤은 매수 × 이론중량) */
  initialTon: string | null;
}

/** 작업 실적 한 건 (GET /production-results) */
export interface ProductionResultView {
  id: number;
  /** 제선은 null (ERD: 용선은 계획에 묶이지 않는 공용 풀) */
  productionPlanId: number | null;
  productionPlanNo: string | null;
  processType: ProcessType;
  blastFurnaceCode: string | null;
  converterCode: string | null;
  startedAt: string;
  /** null이면 작업 중 (작업 상태값 없음, 업무 프로세스 10장) */
  completedAt: string | null;
  /** 실적 시뮬레이션의 연주 샘플 손실률 (0~0.0500) */
  simulatedLossRate: string | null;
  inputs: ResultInputLot[];
  outputs: ResultOutputLot[];
  /** 투입 톤 합계 (원료·용선·합금철) */
  inputTon: string | null;
  /** 산출 매수 (슬래브·코일) */
  outputQty: number | null;
  /** 산출 톤: 용선·히트는 LOT 톤, 슬래브·코일은 매수 × 이론중량 */
  outputTon: string | null;
  /** 작업 시작을 따로 기록한 연주의 히트 (완료 때 같은 히트여야 한다) */
  startedHeatLotId: number | null;
  /** 실적을 등록(또는 시작)한 사원 */
  operatorName: string | null;
  /** 실적 시뮬레이션으로 만든 실적 */
  isSimulated: boolean;
  /** 시뮬레이션 값 (작업 로그 after_data). 연주만 계획 매수·손실 */
  simulation: { randomSeed: number | null; plannedQty: number | null; lossQty: number | null; sampleLossRate: string | null } | null;
}

/** 원료·합금철 잔량과 원단위 (실적 입력 화면) */
export interface RawMaterialStock {
  itemId: number;
  itemCode: string;
  itemName: string;
  rawMaterialType: RawMaterialType;
  /** 철광석·석탄·석회석은 용선 1t당 t, 합금철은 용강 1t당 kg */
  consumptionRate: string;
  isKgPerTon: boolean;
  remainingTon: string;
}

/** 연주 전 히트 */
export interface UncastHeat {
  lotId: number;
  lotNo: string;
  heatTon: string;
  /** floor(히트 톤 × 연주 수율 ÷ 슬래브 1매 이론중량) */
  maxSlabQty: number;
  inspectionResult: InspectionResult | null;
}

/** 작업 중 실적 */
export interface OpenWork {
  productionResultId: number;
  processType: ProcessType;
  startedAt: string;
  blastFurnaceCode: string | null;
  converterCode: string | null;
  heatLotId: number | null;
}

/** 실적 입력 기준값 (GET /production-plans/:id/work-context) */
export interface WorkContext {
  productionPlanId: number;
  productionPlanNo: string;
  productionPlanStatus: ProductionPlanStatus;
  itemType: ItemType;
  steelGradeCode: string | null;
  heatCount: number;
  castingYieldRate: string;
  steelmakingYieldRate: string;
  heatCapacityTon: string;
  /** 히트 1개에 필요한 용선 = 히트 용량 ÷ 제강 수율 */
  hotMetalTonPerHeat: string;
  slabItemId: number;
  slabItemCode: string;
  slabTheoreticalWeightTon: string;
  /** 쓸 수 있는 용선 LOT (생산 순) */
  hotMetalLots: { lotId: number; lotNo: string; remainingTon: string; /** 제선 완료일 'YYYY-MM-DD' */ producedDate: string | null }[];
  hotMetalAvailableTon: string;
  ironmakingMaterials: RawMaterialStock[];
  ferroalloys: RawMaterialStock[];
  /** 아직 만들 히트 수 = 히트 수 − 만든 히트 */
  heatsToMakeQty: number;
  uncastHeats: UncastHeat[];
  openWork: OpenWork[];
  lastBlastFurnaceCode: string | null;
  lastConverterCode: string | null;
}

// ── 열연 투입 (REQ-PRD-004, REQ-INV-006, BP-INV-01) ─────────────

/** 열연 배정 후보 슬래브 (FIFO: 생산완료일 → LOT 번호) */
export interface HotRollingCandidate {
  lotId: number;
  lotNo: string;
  producedDate: string | null;
  heatNo: string | null;
  yardId: number | null;
  /** 1부터 */
  fifoRank: number;
  /** 앞에서 배정할 수 있는 매수만큼 추천 */
  isRecommended: boolean;
  /** 이 계획이 만든 슬래브인지 (아니면 다른 계획의 여재) */
  isOwnPlan: boolean;
  sourcePlanNo: string | null;
  yardName: string | null;
}

/** 이 계획의 열연 배정 한 줄 */
export interface HotRollingAllocation {
  allocationId: number;
  allocationStatus: AllocationStatus;
  lotId: number;
  lotNo: string;
  producedDate: string | null;
  heatNo: string | null;
  sourcePlanNo: string | null;
  /** 배정 확정 시각 */
  confirmedAt: string;
  /** 확정 배정이고 슬래브가 재고 상태·합격이라 지금 열연할 수 있는지 */
  isRollable: boolean;
}

/** 만든 코일 */
export interface HotRollingCoil extends PlanLot {
  hasConfirmedAllocation: boolean;
}

/** 열연 투입 화면 (GET /production-plans/:id/hot-rolling) */
export interface HotRollingDetail {
  plan: ProductionPlanSummary;
  coilItem: { id: number; itemCode: string; itemName: string; theoreticalWeightTon: string };
  slabItem: { id: number; itemCode: string; itemName: string; theoreticalWeightTon: string };
  slabItemId: number;
  slabItemCode: string;
  /** 부족 매수 = 만들 코일 수 */
  shortageQty: number;
  /** 만든 코일 중 불합격이 아닌 것 */
  usableCoilQty: number;
  failedCoilQty: number;
  /** 지금 확정(CONFIRMED) 열연 배정 수 */
  confirmedAllocationQty: number;
  /** 더 배정할 슬래브 = max(0, 부족 − 쓸 수 있는 코일 − 확정 배정) */
  neededQty: number;
  /** 대응 슬래브 규격 재고: 가용 = 현재고 − 판매 예약 − 열연 배정 (여재 포함) */
  slabPool: { onHandQty: number; reservedQty: number; rollingAllocatedQty: number; availableQty: number };
  /** 지금 배정할 수 있는 매수 = min(더 필요한 슬래브, 가용) */
  recommendableQty: number;
  /** 수주에 연결된 계획·진행중인 코일 계획만 열연한다 */
  isRollable: boolean;
  notRollableReason: string | null;
  candidates: HotRollingCandidate[];
  allocations: AllocationView[];
  /** 이 계획의 열연 배정 (상태 무관, 열연 가능 여부 포함) */
  rollingAllocations: HotRollingAllocation[];
  /** 이 계획의 열연 실적 */
  results: ProductionResultView[];
  /** 이 계획의 열연 실적이 만든 코일 */
  coils: HotRollingCoil[];
}

// ── 실적 시뮬레이션 (REQ-PRD-007, BP-SEED-01) ─────────────

/** 시뮬레이션이 만든 공정 실적 한 건 */
export interface SimulationStep {
  processType: ProcessType;
  productionResultId: number;
  startedAt: string;
  completedAt: string;
  outputLotNos: string[];
  /** 연주만: 히트에서 나올 수 있는 최대 매수 */
  plannedQty: number | null;
  /** 연주만: 샘플 손실률 0~0.0500 */
  sampleLossRate: string | null;
  /** 연주만: floor(계획 매수 × 샘플 손실률) */
  lossQty: number | null;
  outputQty: number | null;
  /** 연주만: 손실 매수 ÷ 계획 매수 */
  actualLossRate: string | null;
}

/** 실적 시뮬레이션 결과 (POST /production-plans/:id/simulate-results) */
export interface SimulationResult {
  productionPlanId: number;
  productionPlanNo: string;
  /** 같은 시드로 다시 실행하면 같은 손실이 나온다 */
  randomSeed: number;
  steps: SimulationStep[];
  /** 코일 계획에서 열연을 건너뛴 이유 (예: 검사 합격한 슬래브가 없음). 건너뛰지 않았으면 null */
  skippedRolling: string | null;
  productionPlanStatus: ProductionPlanStatus;
}

// ── 재생산 (REQ-PRD-006, 14.1-6) ─────────────

/** 재생산 계획 생성 결과 (POST /production-plans) */
export interface ReproductionResult {
  /** 만들기 전 판단값 */
  check: ReproductionCheck;
  /** 여재(예약 가용)에서 먼저 예약한 매수 */
  reservedFromSurplusQty: number;
  /** 여재로 다 채웠으면 null */
  plan: ProductionPlanSummary | null;
}
