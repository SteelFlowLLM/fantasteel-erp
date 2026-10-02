import {
  ALLOCATION_STATUS,
  type AllocationStatus,
  type MillSheetDetail,
  type MillSheetSummary,
  type ShipmentRequestDetail,
  type ShipmentRequestStatus,
  type ShipmentRequestSummary,
} from '@fantasteel/shared';
import type { MillSheetDetailRow, MillSheetSummaryRow, ShipmentRequestDetailRow, ShipmentRequestSummaryRow } from './shipment.repository';

// date 컬럼은 UTC 자정으로 읽히므로 앞 10자리가 그대로 날짜다
const toDateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function toShipmentRequestSummary(row: ShipmentRequestSummaryRow): ShipmentRequestSummary {
  return {
    id: row.id,
    shipmentRequestNo: row.shipmentRequestNo,
    customerId: row.customerId,
    customerName: row.customer.customerName,
    shipDate: toDateOnly(row.shipDate),
    shipmentRequestStatus: row.shipmentRequestStatus as ShipmentRequestStatus,
    totalRequestQty: row.shipmentRequestItems.reduce((sum, i) => sum + i.requestQty, 0),
    issuedAt: row.issuedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toShipmentRequestDetail(row: ShipmentRequestDetailRow): ShipmentRequestDetail {
  return {
    ...toShipmentRequestSummary(row),
    issuedEmployeeId: row.issuedEmployeeId,
    issuedEmployeeName: row.issuedEmployee?.employeeName ?? null,
    items: row.shipmentRequestItems.map((i) => {
      const confirmed = i.allocations.filter((a) => a.allocationStatus === ALLOCATION_STATUS.CONFIRMED).length;
      return {
        id: i.id,
        salesOrderItemId: i.salesOrderItemId,
        salesOrderId: i.salesOrderItem.salesOrderId,
        salesOrderNo: i.salesOrderItem.salesOrder.salesOrderNo,
        itemId: i.salesOrderItem.itemId,
        itemCode: i.salesOrderItem.item.itemCode,
        itemName: i.salesOrderItem.item.itemName,
        requestQty: i.requestQty,
        unallocatedQty: Math.max(0, i.requestQty - confirmed),
        allocations: i.allocations.map((a) => ({
          allocationId: a.id,
          lotId: a.lotId,
          lotNo: a.lot.lotNo,
          allocationStatus: a.allocationStatus as AllocationStatus,
        })),
      };
    }),
  };
}

export function toMillSheetSummary(row: MillSheetSummaryRow): MillSheetSummary {
  return {
    id: row.id,
    millSheetNo: row.millSheetNo,
    shipmentRequestId: row.shipmentRequestId,
    shipmentRequestNo: row.shipmentRequest.shipmentRequestNo,
    salesOrderId: row.salesOrderId,
    salesOrderNo: row.salesOrder.salesOrderNo,
    issuedAt: row.issuedAt.toISOString(),
    pdfPath: row.pdfPath,
  };
}

export function toMillSheetDetail(row: MillSheetDetailRow): MillSheetDetail {
  return { ...toMillSheetSummary(row), snapshot: row.snapshot };
}
