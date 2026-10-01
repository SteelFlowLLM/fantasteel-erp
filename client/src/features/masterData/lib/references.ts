// 기준정보를 쓰는 곳 세기. 삭제는 참조가 없을 때만 한다 (컨벤션 7-2, PLAN 5장 '사용 안 함' 토글 대신 삭제만).
// 제품 규격의 '사용됨' = 수주·재고·LOT(+생산계획·예약)에 쓰였는지 (REQ-MST-003, 업무 프로세스 4.1). 쓰인 규격은 치수·이론중량을 못 바꾼다(MST-002).
import type { MockTables } from '@/mock/schema';

export interface ReferenceCount {
  label: string;
  count: number;
}

const count = (rows: readonly unknown[]) => rows.length;

/** 0건이 아닌 것만 '수주 3건 · LOT 2건'으로. 없으면 null. */
export function formatReferenceText(references: readonly ReferenceCount[]): string | null {
  const used = references.filter((r) => r.count > 0);
  return used.length === 0 ? null : used.map((r) => `${r.label} ${r.count}건`).join(' · ');
}

/** 제품 규격이 수주·재고·LOT·생산계획·예약에 쓰였는지를 세어 준다 */
export function countSpecUsage(tables: Readonly<MockTables>, itemId: number): ReferenceCount[] {
  return [
    { label: '수주', count: count(tables.salesOrderItem.filter((r) => r.itemId === itemId)) },
    { label: '재고', count: count(tables.inventory.filter((r) => r.itemId === itemId && (r.onHandQty > 0 || r.reservedQty > 0))) },
    { label: 'LOT', count: count(tables.lot.filter((r) => r.itemId === itemId)) },
    { label: '생산계획', count: count(tables.productionPlan.filter((r) => r.itemId === itemId)) },
    { label: '예약', count: count(tables.reservation.filter((r) => r.itemId === itemId)) },
  ];
}

export const isSpecUsed = (tables: Readonly<MockTables>, itemId: number): boolean => formatReferenceText(countSpecUsage(tables, itemId)) !== null;

/** 제품 규격을 지울 수 없게 하는 참조 (쓰임 + 규격 매핑) */
export function countProductSpecReferences(tables: Readonly<MockTables>, itemId: number): ReferenceCount[] {
  return [
    { label: '규격 매핑', count: count(tables.specMapping.filter((m) => m.slabItemId === itemId || m.coilItemId === itemId)) },
    ...countSpecUsage(tables, itemId),
  ];
}

export function countRawMaterialReferences(tables: Readonly<MockTables>, itemId: number): ReferenceCount[] {
  return [
    { label: '배합 원단위', count: count(tables.specificConsumption.filter((r) => r.itemId === itemId)) },
    { label: '구매요청', count: count(tables.purchaseRequisitionItem.filter((r) => r.itemId === itemId)) },
    { label: '발주', count: count(tables.purchaseOrderItem.filter((r) => r.itemId === itemId)) },
    { label: 'LOT', count: count(tables.lot.filter((r) => r.itemId === itemId)) },
    { label: '재고', count: count(tables.inventory.filter((r) => r.itemId === itemId && (r.onHandQty > 0 || r.reservedQty > 0))) },
  ];
}

export function countSteelGradeReferences(tables: Readonly<MockTables>, steelGradeId: number): ReferenceCount[] {
  return [
    { label: '제품 규격', count: count(tables.item.filter((r) => r.steelGradeId === steelGradeId)) },
    { label: '배합 원단위', count: count(tables.specificConsumption.filter((r) => r.steelGradeId === steelGradeId)) },
    { label: '검사 기준', count: count(tables.inspectionStandard.filter((r) => r.steelGradeId === steelGradeId)) },
    { label: 'LOT', count: count(tables.lot.filter((r) => r.steelGradeId === steelGradeId)) },
  ];
}

export function countCustomerReferences(tables: Readonly<MockTables>, customerId: number): ReferenceCount[] {
  return [
    { label: '수주', count: count(tables.salesOrder.filter((r) => r.customerId === customerId)) },
    { label: '출하요청', count: count(tables.shipmentRequest.filter((r) => r.customerId === customerId)) },
  ];
}

export function countSupplierReferences(tables: Readonly<MockTables>, supplierId: number): ReferenceCount[] {
  return [
    { label: '원료 기본 공급업체', count: count(tables.item.filter((r) => r.defaultSupplierId === supplierId)) },
    { label: '발주', count: count(tables.purchaseOrder.filter((r) => r.supplierId === supplierId)) },
  ];
}

export function countYardReferences(tables: Readonly<MockTables>, yardId: number): ReferenceCount[] {
  return [
    { label: '품목 기본 야드', count: count(tables.item.filter((r) => r.defaultYardId === yardId)) },
    { label: 'LOT', count: count(tables.lot.filter((r) => r.yardId === yardId)) },
    { label: '입고', count: count(tables.goodsReceipt.filter((r) => r.yardId === yardId)) },
  ];
}
