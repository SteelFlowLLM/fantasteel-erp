// 재고 조회 API (docs/api/inventory.md 1·2번). 조회 전용 — 배정 API는 allocations.ts.
// 제품은 매수(정수), 톤은 매수 × 1매 이론중량 계산값 문자열. 원료는 톤 문자열.
import { api } from './client';

export interface ListInventoriesQuery {
  itemType?: 'SLAB' | 'COIL' | 'RAW_MATERIAL';
  /** 강종 코드 'SS275' (제품에만 적용) */
  steelGrade?: string;
  productSpecId?: number;
}

export interface ProductInventoryView {
  productSpecId: number;
  specCode: string;
  itemType: 'SLAB' | 'COIL';
  qtyUnit: string;
  steelGradeId: number;
  steelGradeCode: string;
  thicknessMm: string;
  widthMm: string;
  lengthMm: string;
  theoreticalWeightTon: string;
  yardName: string | null;
  /** 합격·미소진 매수 (재고 풀. 여재 포함, 열연 투입용 귀속 슬래브 제외) */
  onHandQty: number;
  /** ACTIVE 예약 매수 합계 */
  reservedQty: number;
  /** 가용재고 = onHandQty − reservedQty */
  availableQty: number;
  pendingInspectionQty: number;
  failedQty: number;
  /** 열연 투입용으로 코일 수주에 귀속된 합격 슬래브 수 (재고 풀 밖) */
  earmarkedQty: number;
  onHandTon: string;
  reservedTon: string;
  availableTon: string;
}

export interface RawMaterialInventoryView {
  rawMaterialId: number;
  materialCode: string;
  itemCode: string;
  itemName: string;
  rawMaterialType: string;
  yardName: string | null;
  /** 원료 LOT 잔량 합계 */
  onHandTon: string;
  /** 입고예정 = 확정 발주의 (발주량 − 입고 누계) 합계 */
  scheduledReceiptTon: string;
}

export interface InventoryListView {
  products: ProductInventoryView[];
  rawMaterials: RawMaterialInventoryView[];
}

export interface ListSurplusQuery { steelGrade?: string; productSpecId?: number }

export interface SurplusLotView {
  lotId: number;
  lotNo: string;
  productSpecId: number;
  specCode: string;
  steelGradeCode: string;
  heatNo: string | null;
  producedAt: string;
  /** 생산완료 뒤 지난 일수 (버림) */
  ageDays: number;
  theoreticalWeightTon: string;
  yardName: string | null;
  productionPlanId: number | null;
}
export interface SurplusSpecView {
  productSpecId: number;
  specCode: string;
  steelGradeCode: string;
  surplusQty: number;
  surplusTon: string;
  /** 같은 규격 재고 풀의 ACTIVE 예약 매수 */
  reservedQty: number;
  availableQty: number;
}
export interface SurplusView {
  /** 생산완료일 → LOT 번호 순 (FIFO 순) */
  lots: SurplusLotView[];
  specs: SurplusSpecView[];
}

export const inventoryApi = {
  list: (q: ListInventoriesQuery = {}) => api.get<InventoryListView>('/inventories', { ...q }),
  surplus: (q: ListSurplusQuery = {}) => api.get<SurplusView>('/inventories/surplus', { ...q }),
};
