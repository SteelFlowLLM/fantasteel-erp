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

export interface InventoryOverview {
  products: ProductInventoryRow[];
  rawMaterials: RawMaterialInventoryRow[];
}
