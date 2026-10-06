// MRP 소요량 조회 응답 (API-206 GET /mrp/requirements, docs/backend/mrp.md). 저장하지 않고 계산한다. 톤은 소수 3자리 문자열.
import type { ProductionPlanStatus, RawMaterialType } from './codes';

/** 계획 1건의 원료 1종 소요 */
export interface MrpPlanMaterialView {
  itemId: number;
  itemCode: string;
  requiredTon: string;
  netRequirementTon: string;
}

/** 아직 만들지 않은 히트가 남은 생산계획 1건 */
export interface MrpPlanView {
  productionPlanId: number;
  productionPlanNo: string;
  productionPlanStatus: ProductionPlanStatus;
  salesOrderNo: string | null;
  itemCode: string;
  itemName: string;
  steelGradeCode: string | null;
  /** 필요일: 연결 수주 품목 납기, 수주 연결이 없으면 계획 등록일 */
  requiredDate: string;
  /** 필요일이 조회 시작일 전 (밀린 소요) */
  isBeforePeriod: boolean;
  remainingHeatCount: number;
  heatTon: string;
  requiredHotMetalTon: string;
  materials: MrpPlanMaterialView[];
}

/** 원료 1종 합계. 순소요 = max(0, 소요량 − 쓴 원료 LOT 잔량 − 쓴 입고예정) */
export interface MrpMaterialView {
  itemId: number;
  itemCode: string;
  itemName: string;
  rawMaterialType: RawMaterialType | null;
  /** 보이는 계획들의 소요량 합 */
  requiredTon: string;
  /** 지금 원료 LOT 잔량 합계 */
  remainingTon: string;
  /** 확정 발주의 미입고량 합계 */
  scheduledReceiptTon: string;
  /** 보이는 계획들이 실제로 쓴 원료 LOT 잔량·입고예정 (필요일이 더 이른 계획이 먼저 쓴다) */
  usedRemainingTon: string;
  usedScheduledReceiptTon: string;
  netRequirementTon: string;
  /** 처음 부족이 생기는 필요일 */
  firstShortageDate: string | null;
}

/** 구매요청으로 이어질 줄: 순소요 > 0인 계획·원료 */
export interface MrpRequisitionLineView {
  productionPlanId: number;
  productionPlanNo: string;
  itemId: number;
  itemCode: string;
  itemName: string;
  netRequirementTon: string;
  requiredDate: string;
  /** 같은 계획·원료의 구매요청이 이미 있으면 그 번호 (중복 생성 막기) */
  existingPurchaseRequisitionNo: string | null;
}

/** 필요일이 조회 종료일 이하인 계획을 보인다. 차감은 기간과 관계없이 열린 계획 전부로 한다 */
export interface MrpRequirementsView {
  from: string;
  to: string;
  heatCapacityTon: string;
  plans: MrpPlanView[];
  materials: MrpMaterialView[];
  requisitionLines: MrpRequisitionLineView[];
}
