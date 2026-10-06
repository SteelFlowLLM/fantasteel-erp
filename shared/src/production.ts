// 생산 모듈 응답 타입 (docs/backend/production.md). 톤은 소수 3자리 문자열, 수율은 소수 4자리 문자열, 매수는 정수.
import type { InspectionResult, ItemType, LotStatus, LotType, ProcessType, ProductionPlanStatus, SalesOrderItemStatus } from './codes';

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
}

/**
 * 재생산 판단 (업무 프로세스 4.5, 14.1-6). 수주 품목 기준.
 * 진행 계획 잔여 목표는 완료 계획이라도 판정 대기 제품이 남아 있으면 그만큼 남긴다 (검사 중인 제품을 재생산으로 다시 만들지 않게).
 */
export interface ReproductionCheck {
  salesOrderItemId: number;
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
  updatedAt: string;
}
