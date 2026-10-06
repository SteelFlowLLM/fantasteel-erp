import {
  ALLOCATION_STATUS,
  LOT_TYPE,
  type AllocationStatus,
  type MillSheetDetail,
  type MillSheetSnapshot,
  type MillSheetSummary,
  type ShipmentRequestDetail,
  type ShipmentRequestStatus,
  type ShipmentRequestSummary,
} from '@fantasteel/shared';
import type { SnapshotHeatInput, SnapshotInspectionInput, SnapshotLotInput } from './mill-sheet-snapshot';
import type {
  MillSheetDetailRow,
  MillSheetSummaryRow,
  ShipmentRequestDetailRow,
  ShipmentRequestSummaryRow,
  SnapshotHeatRow,
  SnapshotInspectionRow,
  SnapshotLotRow,
} from './shipment.repository';

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
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toShipmentRequestDetail(row: ShipmentRequestDetailRow): ShipmentRequestDetail {
  return {
    ...toShipmentRequestSummary(row),
    issuedEmployeeId: row.issuedEmployeeId,
    issuedEmployeeName: row.issuedEmployee?.employeeName ?? null,
    items: row.shipmentRequestItems.map((i) => {
      // 출고 확정 뒤에는 배정이 CONSUMED로 바뀌므로 소진된 배정도 배정된 매수로 센다
      const confirmed = i.allocations.filter((a) => a.allocationStatus === ALLOCATION_STATUS.CONFIRMED || a.allocationStatus === ALLOCATION_STATUS.CONSUMED).length;
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
  return { ...toMillSheetSummary(row), snapshot: row.snapshot as unknown as MillSheetSnapshot };
}

const toInspectionInput = (row: SnapshotInspectionRow | null): SnapshotInspectionInput | null =>
  row
    ? {
        inspectionResult: row.inspectionResult,
        inspectedAt: row.inspectedAt,
        processType: row.inspectionStandard.processType,
        inspectionStandardCode: row.inspectionStandard.inspectionStandardCode,
        versionNo: row.inspectionStandard.versionNo,
        values: row.qualityInspectionValues.map((v) => ({
          inspectionItemCode: v.inspectionStandardItem.inspectionItemCode,
          inspectionItemName: v.inspectionStandardItem.inspectionItemName,
          unit: v.inspectionStandardItem.unit,
          minValue: v.inspectionStandardItem.minValue?.toFixed(4) ?? null,
          maxValue: v.inspectionStandardItem.maxValue?.toFixed(4) ?? null,
          measuredValue: v.measuredValue.toFixed(4),
        })),
      }
    : null;

const toHeatInput = (row: SnapshotHeatRow): SnapshotHeatInput => ({
  id: row.id,
  lotNo: row.lotNo,
  // 히트 LOT에는 생산완료일 컬럼이 없어 제강 실적 완료 시각을 쓴다
  producedDate: row.productionResult?.completedAt ?? null,
  converterCode: row.productionResult?.converterCode ?? null,
  steelGradeCode: row.steelGrade?.steelGradeCode ?? null,
  inspection: toInspectionInput(row.inspection),
});

/** 슬래브·코일 LOT과 부모 계보(코일 → 슬래브 → 히트, 슬래브 → 히트)를 스냅샷 입력으로 */
export function toSnapshotLotInput(row: SnapshotLotRow): SnapshotLotInput {
  const parents = row.parents;
  const slab = row.lotType === LOT_TYPE.COIL ? parents.find((p) => p.lotType === LOT_TYPE.SLAB) : undefined;
  const heat = (slab ? slab.parents : parents).find((p) => p.lotType === LOT_TYPE.HEAT);
  return {
    id: row.id,
    lotNo: row.lotNo,
    lotType: row.lotType,
    producedDate: row.producedDate,
    slabNo: slab?.lotNo ?? null,
    heat: heat ? toHeatInput(heat) : null,
    inspection: toInspectionInput(row.inspection),
  };
}
