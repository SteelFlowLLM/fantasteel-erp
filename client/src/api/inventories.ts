// 재고 조회 (REQ-INV-001·003·006·007·008, 업무 프로세스 4.2·4.3, PLAN 7장 재고). 조회 전용이다.
// 계산(재고·합격·예약·가용재고·미배정 합격·여재)은 서버가 하고, 화면에 필요한 기준정보(치수·기본 야드·단위·톤)와
// 배정 여부·검사 결과 표시 기준(`features/inventory/lib/inventoryRules`)을 덧붙인다 (api/server/inventories.ts).
// 재고 화면은 로그인한 모든 사원이 본다(screens.ts EVERYONE).
import { type AllocationPurpose, type DispositionStatus, type LotStatus, type LotType, type ProductItemType, type RawMaterialType } from '@/codes';
import { serverInventoryApi } from '@/api/server/inventories';
import { type LotInspectionResult } from '@/features/inventory/lib/inventoryRules';
import type { ProductEligibility } from '@/lib/eligibility';

export interface LotListRow {
  lotId: number;
  lotNo: string;
  lotType: LotType;
  lotStatus: LotStatus;
  itemId: number | null;
  itemCode: string | null;
  itemName: string | null;
  steelGradeCode: string | null;
  /** 생산완료일·원료 입고일 */
  producedDate: string;
  /** 품질: 제품은 적격 판정(히트 포함), 히트는 성분 판정, 원료·용선은 null */
  quality: ProductEligibility | 'PASS' | 'FAIL' | 'PENDING' | null;
  /** CONFIRMED 배정 목적 (없으면 null) */
  allocationPurpose: AllocationPurpose | null;
  yardName: string | null;
  initialTon: string | null;
  remainingTon: string | null;
  heatNo: string | null;
  productionPlanNo: string | null;
  surplusAt: string | null;
  dispositionStatus: DispositionStatus | null;
}

export interface ProductInventoryRow {
  itemId: number;
  itemCode: string;
  itemName: string;
  itemType: ProductItemType;
  steelGradeCode: string | null;
  /** 1매 이론중량 (TRM-022, item.theoretical_weight_ton) */
  theoreticalWeightTon: string;
  /** 재고 매수 = 미소진 LOT (inventory.on_hand_qty) */
  onHandQty: number;
  /** 합격(적격) 매수 */
  passedQty: number;
  pendingQty: number;
  /** 불합격 + 히트 불합격 (미소진) */
  failedQty: number;
  /** ACTIVE 예약 (inventory.reserved_qty) */
  reservedQty: number;
  hotRollingAllocatedQty: number;
  shipmentAllocatedQty: number;
  /** 가용 = 합격 − ACTIVE 예약 − 열연 배정 (4.2), 0 이상 */
  availableQty: number;
  onHandTon: string;
  passedTon: string;
  availableTon: string;
}

export interface RawMaterialInventoryRow {
  itemId: number;
  itemCode: string;
  itemName: string;
  rawMaterialType: RawMaterialType | null;
  /** LOT 잔량 합계 */
  remainingTon: string;
  /** 입고예정 = 확정 발주의 미입고량 합계 */
  scheduledReceiptTon: string;
  lots: { lotId: number; lotNo: string; receiptDate: string; initialTon: string; remainingTon: string; lotStatus: LotStatus; supplierName: string | null; goodsReceiptNo: string | null; yardName: string | null }[];
}

export interface SurplusSpecRow {
  itemId: number;
  itemCode: string;
  itemName: string;
  steelGradeCode: string | null;
  /** 미배정 합격 슬래브 매수 (적격 + CONFIRMED 배정 없음). 수주 예약 몫·코일 계획의 열연 대기 슬래브도 들어 있다 */
  unallocatedPassedQty: number;
  /** 이 규격에 걸린 ACTIVE 예약 */
  reservedQty: number;
  /** 가용재고(예약 가용, 4.2) = 합격 − ACTIVE 예약 − 열연 배정, 0 이상 */
  availableQty: number;
  /** 여재 매수 (TRM-048): 여재 전환된 미배정 합격 슬래브 중 수주 예약에 쓰이지 않은 몫 = min(여재 전환 LOT 수, 가용재고) */
  surplusQty: number;
  /** 여재 슬래브 (선입선출 순, surplusQty개) */
  lots: { lotId: number; lotNo: string; producedDate: string; surplusAt: string | null; heatNo: string | null; productionPlanNo: string | null }[];
}

/** LOT 목록 한 줄. 서버의 `quality`는 적격(예약·배정 가능) 여부 그대로 두고, 검사 결과·배정 여부·여재를 따로 준다. */
export interface LotListView extends Omit<LotListRow, 'allocationPurpose'> {
  /** 생산계획 화면 링크용 */
  productionPlanId: number | null;
  /** 검사 결과 (투입 소진·출고된 LOT도 그대로). 원료·용선은 null */
  inspectionResult: LotInspectionResult | null;
  /** 배정 여부: 해제되지 않은 마지막 배정의 목적 (없으면 null) */
  allocationPurpose: AllocationPurpose | null;
  /** 그 배정의 상태: 배정 확정 · 소진(출고 확정·열연 투입) */
  allocationStatus: 'CONFIRMED' | 'CONSUMED' | null;
  /** 여재 (여재 탭과 같은 기준) */
  isSurplus: boolean;
}

export interface LotListFilter {
  lotType?: LotType;
  lotStatus?: LotStatus;
  itemId?: number;
}

export const inventoryKeys = {
  all: ['inventories'] as const,
  products: () => [...inventoryKeys.all, 'products'] as const,
  lots: (filter: LotListFilter = {}) => [...inventoryKeys.all, 'lots', filter] as const,
  rawMaterials: () => [...inventoryKeys.all, 'raw-materials'] as const,
  surplus: () => [...inventoryKeys.all, 'surplus'] as const,
};

/** 제품 재고 한 줄 (규격별) */
export interface ProductInventoryView extends ProductInventoryRow {
  thicknessMm: string | null;
  widthMm: string | null;
  lengthMm: string | null;
  /** 규격 기본 야드 (LOT 생성 때 자동 지정되는 곳) */
  defaultYardName: string | null;
  /** 매 · 개 */
  qtyUnit: string;
  /** 예약 매수 × 1매 이론중량 */
  reservedTon: string;
}

/** 원료 재고 한 줄 (원료별) */
export interface RawMaterialInventoryView extends RawMaterialInventoryRow {
  defaultYardName: string | null;
  /** 잔량이 남은(재고) 원료 LOT 수 */
  availableLotCount: number;
}

/** 여재 슬래브 한 줄 */
export type SurplusLotView = SurplusSpecRow['lots'][number] & { yardName: string | null; productionPlanId: number | null };

/** 여재 규격 한 줄 (미배정 합격 슬래브가 있는 슬래브 규격) */
export interface SurplusSpecView {
  itemId: number;
  itemCode: string;
  itemName: string;
  steelGradeCode: string | null;
  /** 1매 이론중량 (TRM-022) */
  theoreticalWeightTon: string;
  /** 미배정 합격 슬래브 (적격 + CONFIRMED 배정 없음). 수주 예약 몫·코일 계획의 열연 대기 슬래브도 들어 있다 */
  unallocatedPassedQty: number;
  unallocatedPassedTon: string;
  /** 이 규격에 걸린 ACTIVE 예약 */
  reservedQty: number;
  /** 가용재고 (TRM-055, 4.2 = 합격 − 예약 − 열연 배정) */
  availableQty: number;
  availableTon: string;
  /** 여재 매수 (TRM-048): 여재 전환된 미배정 합격 슬래브 중 수주 예약에 쓰이지 않은 몫. 가용재고 이하 */
  surplusQty: number;
  surplusTon: string;
  /** 여재 슬래브 (선입선출 순, surplusQty개) */
  lots: SurplusLotView[];
}

export const inventoryApi = {
  listProducts: () => serverInventoryApi.listProducts(),
  listLots: (filter: LotListFilter = {}) => serverInventoryApi.listLots(filter),
  listRawMaterials: () => serverInventoryApi.listRawMaterials(),
  listSurplus: () => serverInventoryApi.listSurplus(),
};
