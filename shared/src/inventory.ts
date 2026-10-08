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
