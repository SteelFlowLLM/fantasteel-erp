import { ITEM_QTY_UNIT, type AllocationStatus, type PdfStatus, type SalesOrderItemStatus, type ShipmentRequestItemStatus, type ShipmentRequestStatus } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { qtyTon, toDateOnly, tonText } from '../sales-order/sales-order.view';
import type { GoodsIssueRow, ShipmentRequestRow } from './shipment.repository';

// 응답은 JSON 그대로(톤 = 소수 3자리 문자열, 일시 = ISO 문자열) 만든다 — 출고 확정 재시도 응답과 모양을 맞추기 위해서다.

export interface EmployeeRef { id: number; employeeNo: string; employeeName: string }
export interface CustomerRef { id: number; customerCode: string; customerName: string }
export interface MillSheetRef { id: number; millSheetNo: string; salesOrderId: number; pdfStatus: PdfStatus }

export interface ShipmentAllocationView {
  id: number;
  lotId: number;
  lotNo: string;
  lotType: string;
  heatNo: string | null;
  producedAt: string;
  status: AllocationStatus;
  confirmedAt: string;
}

export interface ShipmentRequestItemView {
  id: number;
  lineNo: number;
  salesOrderItemId: number;
  salesOrderId: number;
  salesOrderNo: string;
  salesOrderLineNo: number;
  productSpecId: number;
  specCode: string;
  itemType: 'SLAB' | 'COIL';
  qtyUnit: string;
  steelGradeCode: string;
  theoreticalWeightTon: string;
  requestQty: number;
  requestTon: string;
  /** 배정(확정·소진)된 LOT 수. requestQty와 같으면 배정 완료 */
  allocatedQty: number;
  shipmentRequestItemStatus: ShipmentRequestItemStatus;
  allocations: ShipmentAllocationView[];
}

export interface ShipmentRequestView {
  id: number;
  shipmentRequestNo: string;
  customer: CustomerRef;
  /** YYYY-MM-DD */
  requestedShipDate: string;
  shipmentRequestStatus: ShipmentRequestStatus;
  requester: EmployeeRef | null;
  memo: string | null;
  cancelledAt: string | null;
  createdAt: string;
  requestQty: number;
  requestTon: string;
  allocatedQty: number;
  items: ShipmentRequestItemView[];
  goodsIssue: { id: number; goodsIssueNo: string; confirmedAt: string | null; confirmedEmployee: EmployeeRef | null } | null;
  millSheets: MillSheetRef[];
}

export interface GoodsIssueItemView {
  shipmentRequestItemId: number;
  salesOrderItemId: number;
  salesOrderId: number;
  salesOrderNo: string;
  salesOrderLineNo: number;
  productSpecId: number;
  specCode: string;
  itemType: 'SLAB' | 'COIL';
  qtyUnit: string;
  steelGradeCode: string;
  /** 이번 출고 매수 */
  issuedQty: number;
  issuedTon: string;
  /** 출고 뒤 수주 품목의 누적 출고 매수·상태 */
  orderedQty: number;
  shippedQty: number;
  salesOrderItemStatus: SalesOrderItemStatus;
  lots: { lotId: number; lotNo: string; heatNo: string | null }[];
}

export interface GoodsIssueView {
  id: number;
  goodsIssueNo: string;
  goodsIssueStatus: string;
  confirmedAt: string | null;
  confirmedEmployee: EmployeeRef | null;
  shipmentRequestId: number;
  shipmentRequestNo: string;
  customer: CustomerRef;
  issuedQty: number;
  issuedTon: string;
  items: GoodsIssueItemView[];
  millSheets: MillSheetRef[];
}

/** 날짜(YYYY-MM-DD, Asia/Seoul)의 하루 범위 [시작, 다음 날 시작). */
export function kstDayRange(from?: string, to?: string): { from?: Date; to?: Date } {
  const start = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00+09:00`);
  return { from: from ? start(from) : undefined, to: to ? new Date(start(to).getTime() + 86_400_000) : undefined };
}

export const dateOnly = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00.000Z`);

export function toShipmentRequestView(row: ShipmentRequestRow, employees: Map<number, EmployeeRef>): ShipmentRequestView {
  const items = row.items.map((i): ShipmentRequestItemView => {
    const spec = i.salesOrderItem.productSpec;
    const itemType = spec.item.itemType as 'SLAB' | 'COIL';
    return {
      id: i.id,
      lineNo: i.lineNo,
      salesOrderItemId: i.salesOrderItemId,
      salesOrderId: i.salesOrderItem.salesOrderId,
      salesOrderNo: i.salesOrderItem.salesOrder.salesOrderNo,
      salesOrderLineNo: i.salesOrderItem.lineNo,
      productSpecId: spec.id,
      specCode: spec.specCode,
      itemType,
      qtyUnit: ITEM_QTY_UNIT[itemType],
      steelGradeCode: spec.steelGrade.steelGradeCode,
      theoreticalWeightTon: tonText(spec.theoreticalWeightTon),
      requestQty: i.requestQty,
      requestTon: tonText(qtyTon(i.requestQty, spec.theoreticalWeightTon)),
      allocatedQty: i.allocations.length,
      shipmentRequestItemStatus: i.shipmentRequestItemStatus as ShipmentRequestItemStatus,
      allocations: i.allocations.map((a) => ({
        id: a.id,
        lotId: a.lotId,
        lotNo: a.lot.lotNo,
        lotType: a.lot.lotType,
        heatNo: a.lot.heatLot?.lotNo ?? null,
        producedAt: a.lot.producedAt.toISOString(),
        status: a.status as AllocationStatus,
        confirmedAt: a.confirmedAt.toISOString(),
      })),
    };
  });
  const issue = row.goodsIssues[0] ?? null;
  const requestTon = row.items.reduce((s, i) => s.add(qtyTon(i.requestQty, i.salesOrderItem.productSpec.theoreticalWeightTon)), new Prisma.Decimal(0));
  return {
    id: row.id,
    shipmentRequestNo: row.shipmentRequestNo,
    customer: row.customer,
    requestedShipDate: toDateOnly(row.requestedShipDate),
    shipmentRequestStatus: row.shipmentRequestStatus as ShipmentRequestStatus,
    requester: employees.get(row.requesterId) ?? null,
    memo: row.memo,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    requestQty: items.reduce((s, i) => s + i.requestQty, 0),
    requestTon: tonText(requestTon),
    allocatedQty: items.reduce((s, i) => s + i.allocatedQty, 0),
    items,
    goodsIssue: issue
      ? { id: issue.id, goodsIssueNo: issue.goodsIssueNo, confirmedAt: issue.confirmedAt?.toISOString() ?? null, confirmedEmployee: issue.confirmedEmployeeId ? (employees.get(issue.confirmedEmployeeId) ?? null) : null }
      : null,
    millSheets: row.goodsIssues.flatMap((g) => g.millSheets.map((m) => ({ ...m, pdfStatus: m.pdfStatus as PdfStatus }))),
  };
}

export function toGoodsIssueView(row: GoodsIssueRow, employees: Map<number, EmployeeRef>): GoodsIssueView {
  const byItem = new Map<number, GoodsIssueItemView>();
  let issuedTon = new Prisma.Decimal(0);
  for (const gi of row.items) {
    const soItem = gi.shipmentRequestItem.salesOrderItem;
    const spec = soItem.productSpec;
    const itemType = spec.item.itemType as 'SLAB' | 'COIL';
    let view = byItem.get(gi.shipmentRequestItemId);
    if (!view) {
      view = {
        shipmentRequestItemId: gi.shipmentRequestItemId,
        salesOrderItemId: soItem.id,
        salesOrderId: soItem.salesOrderId,
        salesOrderNo: soItem.salesOrder.salesOrderNo,
        salesOrderLineNo: soItem.lineNo,
        productSpecId: spec.id,
        specCode: spec.specCode,
        itemType,
        qtyUnit: ITEM_QTY_UNIT[itemType],
        steelGradeCode: spec.steelGrade.steelGradeCode,
        issuedQty: 0,
        issuedTon: '0.000',
        orderedQty: soItem.orderedQty,
        shippedQty: soItem.shippedQty,
        salesOrderItemStatus: soItem.salesOrderItemStatus as SalesOrderItemStatus,
        lots: [],
      };
      byItem.set(gi.shipmentRequestItemId, view);
    }
    view.issuedQty += 1;
    view.issuedTon = tonText(qtyTon(view.issuedQty, spec.theoreticalWeightTon));
    view.lots.push({ lotId: gi.lot.id, lotNo: gi.lot.lotNo, heatNo: gi.lot.heatLot?.lotNo ?? null });
    issuedTon = issuedTon.add(spec.theoreticalWeightTon);
  }
  const items = [...byItem.values()];
  return {
    id: row.id,
    goodsIssueNo: row.goodsIssueNo,
    goodsIssueStatus: row.goodsIssueStatus,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    confirmedEmployee: row.confirmedEmployeeId ? (employees.get(row.confirmedEmployeeId) ?? null) : null,
    shipmentRequestId: row.shipmentRequest.id,
    shipmentRequestNo: row.shipmentRequest.shipmentRequestNo,
    customer: row.shipmentRequest.customer,
    issuedQty: items.reduce((s, i) => s + i.issuedQty, 0),
    issuedTon: tonText(issuedTon),
    items,
    millSheets: row.millSheets.map((m) => ({ ...m, pdfStatus: m.pdfStatus as PdfStatus })),
  };
}

