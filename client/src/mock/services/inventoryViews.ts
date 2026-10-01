// 재고 조회 (REQ-INV-001·003·007·008, 업무 프로세스 4.2·4.3, PLAN 7장 재고).
// - 제품: 규격별 재고 매수(미소진) · 합격(적격) · 판정 대기 · 불합격 · 예약(ACTIVE) · 열연 배정 · 가용(4.2) · 톤(매수 × 이론중량).
// - LOT 목록: 모든 LOT (유형·규격·생산완료일·품질 결과·배정 여부·야드·상태).
// - 원료: 원료별 LOT 잔량 합계 + 입고예정(확정 발주 미입고량), LOT 목록(입고일·잔량·공급업체).
// - 여재: 수주에 쓰이지 않고 남은 미배정 합격 슬래브 (TRM-048, 가용재고에 포함). surplus_at = 여재 전환 시각.
import type { AllocationPurpose, LotStatus, LotType, ProductItemType, RawMaterialType } from '@/codes';
import { decCmp, decSum } from '@/lib/decimal';
import { sortFifo } from '@/lib/fifo';
import { pickSurplusLots } from '@/lib/surplus';
import { calcWeightTon } from '@/lib/weight';
import type { LotRow, MockTables } from '@/mock/schema';
import { findById, steelGradeCodeOf } from '@/mock/services/context';
import { confirmedAllocationOf, heatOf, lotEligibility, reservationPoolOf } from '@/mock/services/inventoryPool';
import type { ProductEligibility } from '@/lib/eligibility';

type Tables = Readonly<MockTables>;

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

export function productInventory(tables: Tables): ProductInventoryRow[] {
  return tables.item
    .filter((i) => i.itemType !== 'RAW_MATERIAL')
    .sort((a, b) => a.id - b.id)
    .map((item) => {
      const lots = tables.lot.filter((l) => l.itemId === item.id && l.lotStatus === 'AVAILABLE');
      const eligibility = lots.map((l) => lotEligibility(tables, l));
      const pool = reservationPoolOf(tables, item.id);
      const inventory = tables.inventory.find((r) => r.itemId === item.id);
      const theoreticalWeightTon = item.theoreticalWeightTon ?? '0.000';
      const availableQty = Math.max(0, pool.availableQty);
      return {
        itemId: item.id,
        itemCode: item.itemCode,
        itemName: item.itemName,
        itemType: item.itemType === 'COIL' ? 'COIL' : 'SLAB',
        steelGradeCode: steelGradeCodeOf(tables, item.steelGradeId),
        theoreticalWeightTon,
        onHandQty: inventory?.onHandQty ?? lots.length,
        passedQty: pool.eligibleQty,
        pendingQty: eligibility.filter((e) => e === 'PENDING').length,
        failedQty: eligibility.filter((e) => e === 'FAILED' || e === 'HEAT_FAILED').length,
        reservedQty: inventory?.reservedQty ?? pool.activeReservedQty,
        hotRollingAllocatedQty: pool.hotRollingConfirmedQty,
        shipmentAllocatedQty: pool.shipmentConfirmedQty,
        availableQty,
        onHandTon: calcWeightTon(inventory?.onHandQty ?? lots.length, theoreticalWeightTon),
        passedTon: calcWeightTon(pool.eligibleQty, theoreticalWeightTon),
        availableTon: calcWeightTon(availableQty, theoreticalWeightTon),
      };
    });
}

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
  dispositionStatus: LotRow['dispositionStatus'];
}

export function lotList(tables: Tables, filter: { lotType?: LotType; lotStatus?: LotStatus; itemId?: number } = {}): LotListRow[] {
  return tables.lot
    .filter((l) => (!filter.lotType || l.lotType === filter.lotType) && (!filter.lotStatus || l.lotStatus === filter.lotStatus) && (!filter.itemId || l.itemId === filter.itemId))
    .sort((a, b) => b.producedDate.localeCompare(a.producedDate) || a.lotNo.localeCompare(b.lotNo))
    .map((lot) => {
      const item = findById(tables, 'item', lot.itemId);
      const isProduct = lot.lotType === 'SLAB' || lot.lotType === 'COIL';
      const quality = isProduct ? lotEligibility(tables, lot) : lot.lotType === 'HEAT' ? (lot.isPassed === true ? 'PASS' : lot.isPassed === false ? 'FAIL' : 'PENDING') : null;
      return {
        lotId: lot.id,
        lotNo: lot.lotNo,
        lotType: lot.lotType,
        lotStatus: lot.lotStatus,
        itemId: lot.itemId,
        itemCode: item?.itemCode ?? null,
        itemName: item?.itemName ?? null,
        steelGradeCode: steelGradeCodeOf(tables, lot.steelGradeId),
        producedDate: lot.producedDate,
        quality,
        allocationPurpose: confirmedAllocationOf(tables, lot.id)?.allocationPurpose ?? null,
        yardName: findById(tables, 'yard', lot.yardId)?.yardName ?? null,
        initialTon: lot.initialTon,
        remainingTon: lot.remainingTon,
        heatNo: heatOf(tables, lot)?.lotNo ?? null,
        productionPlanNo: findById(tables, 'productionPlan', lot.productionPlanId)?.productionPlanNo ?? null,
        surplusAt: lot.surplusAt,
        dispositionStatus: lot.dispositionStatus,
      };
    });
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

export function rawMaterialInventory(tables: Tables): RawMaterialInventoryRow[] {
  return tables.item
    .filter((i) => i.itemType === 'RAW_MATERIAL')
    .sort((a, b) => a.id - b.id)
    .map((item) => {
      const lots = sortFifo(tables.lot.filter((l) => l.lotType === 'RAW_MATERIAL' && l.itemId === item.id));
      const scheduled = tables.purchaseOrderItem.filter((line) => line.itemId === item.id && decCmp(line.scheduledReceiptTon, 0) > 0 && findById(tables, 'purchaseOrder', line.purchaseOrderId)?.purchaseOrderStatus !== 'RECEIVED');
      return {
        itemId: item.id,
        itemCode: item.itemCode,
        itemName: item.itemName,
        rawMaterialType: item.rawMaterialType,
        remainingTon: decSum(lots.filter((l) => l.lotStatus === 'AVAILABLE').map((l) => l.remainingTon ?? '0')),
        scheduledReceiptTon: decSum(scheduled.map((l) => l.scheduledReceiptTon)),
        lots: lots.map((lot) => {
          const receipt = findById(tables, 'goodsReceipt', lot.goodsReceiptId);
          const poItem = findById(tables, 'purchaseOrderItem', receipt?.purchaseOrderItemId);
          const po = findById(tables, 'purchaseOrder', poItem?.purchaseOrderId);
          return {
            lotId: lot.id,
            lotNo: lot.lotNo,
            receiptDate: lot.producedDate,
            initialTon: lot.initialTon ?? '0.000',
            remainingTon: lot.remainingTon ?? '0.000',
            lotStatus: lot.lotStatus,
            supplierName: findById(tables, 'supplier', po?.supplierId)?.supplierName ?? null,
            goodsReceiptNo: receipt?.goodsReceiptNo ?? null,
            yardName: findById(tables, 'yard', lot.yardId)?.yardName ?? null,
          };
        }),
      };
    });
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

/**
 * 여재 (TRM-048 "수주에 쓰이지 않고 남은 미배정 합격 슬래브", REQ-INV-008, 4.3). 미배정 합격 슬래브가 있는 슬래브 규격마다
 * 예약·가용재고와 여재 매수·여재 슬래브(FIFO 순)를 준다. 여재 고르기는 `lib/surplus` pickSurplusLots 하나로 한다
 * → 재고 화면 여재 탭·LOT 목록 꼬리표·대시보드 여재 위젯이 이 결과를 그대로 써서 숫자가 같다.
 */
export function surplusSlabs(tables: Tables): SurplusSpecRow[] {
  return tables.item
    .filter((i) => i.itemType === 'SLAB')
    .sort((a, b) => a.id - b.id)
    .map((item) => {
      const candidates = sortFifo(tables.lot.filter((l) => l.itemId === item.id && l.lotType === 'SLAB' && lotEligibility(tables, l) === 'ELIGIBLE' && !confirmedAllocationOf(tables, l.id)));
      const pool = reservationPoolOf(tables, item.id);
      const availableQty = Math.max(0, pool.availableQty);
      const lots = pickSurplusLots(
        candidates.map((l) => ({ lotId: l.id, lotNo: l.lotNo, producedDate: l.producedDate, surplusAt: l.surplusAt })),
        availableQty,
      );
      return {
        itemId: item.id,
        itemCode: item.itemCode,
        itemName: item.itemName,
        steelGradeCode: steelGradeCodeOf(tables, item.steelGradeId),
        unallocatedPassedQty: candidates.length,
        reservedQty: pool.activeReservedQty,
        availableQty,
        surplusQty: lots.length,
        lots: lots.map((picked) => {
          const lot = candidates.find((l) => l.id === picked.lotId);
          return {
            ...picked,
            heatNo: lot ? (heatOf(tables, lot)?.lotNo ?? null) : null,
            productionPlanNo: findById(tables, 'productionPlan', lot?.productionPlanId)?.productionPlanNo ?? null,
          };
        }),
      };
    })
    .filter((row) => row.unallocatedPassedQty > 0);
}
