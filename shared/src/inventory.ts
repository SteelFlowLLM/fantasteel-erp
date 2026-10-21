// inventory 모듈 재고 조회 응답 (REQ-INV-001·008, GET /inventories). 톤은 소수 3자리 문자열, 매수는 정수.
import type { ProductStockRow } from './dashboard';

/** 제품(슬래브·코일) 규격별 재고 한 줄 */
export interface ProductInventoryRow extends ProductStockRow {
  /** 미배정 합격 LOT: 적격(자기 검사 PASS + 상위 히트 PASS) + 재고 상태 + CONFIRMED 배정 없음. 수주 예약 몫도 들어 있다 */
  unallocatedPassedQty: number;
}

/** 원료 재고 한 줄. 원료는 매수가 아니라 원료 LOT 잔량(톤) 합계다 (TRM-054) */
export interface RawMaterialInventoryRow {
  itemId: number;
  itemCode: string;
  itemName: string;
  /** 잔량이 남은 원료 LOT의 remaining_ton 합계 */
  remainingTon: string;
  /** 잔량이 남은 원료 LOT 수 */
  lotCount: number;
}

/** 여재 슬래브 한 장 */
export interface SurplusLotRow {
  lotId: number;
  lotNo: string;
  /** 생산완료일 YYYY-MM-DD */
  producedDate: string | null;
  heatNo: string | null;
  yardName: string | null;
  productionPlanId: number | null;
  productionPlanNo: string | null;
}

/**
 * 슬래브 규격별 여재 (REQ-INV-008, TRM-048). 기준은 docs/backend/inventory.md 8-1 임시 결정:
 * 여재 매수 = 미배정 합격 슬래브(진행 중인 코일 수주용 제외) − ACTIVE 예약 매수, 0 미만은 0.
 * 예약은 매수 단위라 FIFO상 가장 늦게 쓰일 LOT을 여재 슬래브로 본다.
 */
export interface SurplusSlabRow {
  itemId: number;
  itemCode: string;
  itemName: string;
  steelGradeCode: string | null;
  /** 1매 이론중량(t, 소수 3자리) */
  theoreticalWeightTon: string;
  /** 미배정 합격 슬래브: 적격 + 재고 상태 + CONFIRMED 배정 없음 (수주 예약 몫·코일 수주용 슬래브 포함) */
  unallocatedPassedQty: number;
  reservedQty: number;
  availableQty: number;
  surplusQty: number;
  /** 여재 슬래브 (선입선출 순, surplusQty장) */
  lots: SurplusLotRow[];
}

export interface InventoryOverview {
  products: ProductInventoryRow[];
  rawMaterials: RawMaterialInventoryRow[];
  /** 여재가 있는 슬래브 규격 (API-195 "여재 포함") */
  surplus: SurplusSlabRow[];
}

/**
 * 정합성 보정 한 규격의 상태 (REQ-INV-010, TRM-062). 공통 코드가 아니라 이 응답에서만 쓰는 값이다.
 * MATCHED 일치 · MISMATCHED 불일치(점검만 했을 때) · CORRECTED 보정함 · UNFIXABLE 보정 불가(예약을 지우지 않고는 맞출 수 없음)
 */
export const RECONCILIATION_STATUS = { MATCHED: 'MATCHED', MISMATCHED: 'MISMATCHED', CORRECTED: 'CORRECTED', UNFIXABLE: 'UNFIXABLE' } as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUS)[keyof typeof RECONCILIATION_STATUS];
export const RECONCILIATION_STATUS_LABEL: Record<ReconciliationStatus, string> = { MATCHED: '일치', MISMATCHED: '불일치', CORRECTED: '보정함', UNFIXABLE: '보정 불가' };

/** 예약 매수가 어긋난 규격 한 줄 */
export interface ReservationReconciliationRow {
  itemId: number;
  itemCode: string;
  itemName: string;
  itemType: string;
  steelGradeCode: string | null;
  /** 재고 행의 예약 매수(inventory.reserved_qty, 보정 전). 재고 행이 없으면 null */
  inventoryReservedQty: number | null;
  /** ACTIVE 예약 매수 합계 */
  activeReservedQty: number;
  /** 재고 행 예약 매수 − ACTIVE 합계 (재고 행이 없으면 0 − ACTIVE 합계) */
  differenceQty: number;
  onHandQty: number;
  rollingAllocatedQty: number;
  status: ReconciliationStatus;
  /** 보정하지 못한 이유 (UNFIXABLE만) */
  reason: string | null;
}

/** 정합성 보정 점검·실행 결과 (GET·POST inventories/reconciliation) */
export interface ReservationReconciliationView {
  /** 점검한 시각 (ISO) */
  checkedAt: string;
  /** 보정까지 했는지. 점검만이면 false */
  applied: boolean;
  /** 점검한 제품 규격 수 (재고 행 또는 ACTIVE 예약이 있는 규격) */
  checkedItemCount: number;
  mismatchCount: number;
  correctedCount: number;
  unfixableCount: number;
  /** 일치하지 않은 규격만 (규격 코드 순) */
  rows: ReservationReconciliationRow[];
}

/** 배정 변경·해제 사유의 최대 글자 수. 서버 DTO(ReleaseAllocationDto)와 화면 입력칸이 같은 값을 쓴다 (이슈 #476, 전에는 화면 500자·서버 200자라 201~500자는 400이었다) */
export const ALLOCATION_REASON_MAX = 200;
