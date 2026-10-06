import { Injectable } from '@nestjs/common';
import { ALLOCATION_STATUS, LOT_STATUS, SALES_ORDER_ITEM_STATUS, SHIPMENT_REQUEST_STATUS, type ShipmentRequestStatus } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';
import { getShippableQtyBySalesOrderItem, lockSalesOrderItemsForShipment, lockShipmentRequest } from '../../generated/prisma/sql';
import type { Tx } from '../../prisma/prisma.service';

const summarySelect = {
  id: true,
  shipmentRequestNo: true,
  customerId: true,
  shipDate: true,
  shipmentRequestStatus: true,
  issuedAt: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { customerName: true } },
  shipmentRequestItems: { select: { requestQty: true } },
} satisfies Prisma.ShipmentRequestSelect;

const detailSelect = {
  ...summarySelect,
  issuedEmployeeId: true,
  issuedEmployee: { select: { employeeName: true } },
  shipmentRequestItems: {
    orderBy: { id: 'asc' },
    select: {
      id: true,
      salesOrderItemId: true,
      requestQty: true,
      salesOrderItem: {
        select: {
          salesOrderId: true,
          itemId: true,
          salesOrder: { select: { salesOrderNo: true } },
          item: { select: { itemCode: true, itemName: true } },
        },
      },
      allocations: {
        where: { allocationStatus: { not: ALLOCATION_STATUS.RELEASED } },
        orderBy: { id: 'asc' },
        select: { id: true, lotId: true, allocationStatus: true, lot: { select: { lotNo: true } } },
      },
    },
  },
} satisfies Prisma.ShipmentRequestSelect;

const millSheetSummarySelect = {
  id: true,
  millSheetNo: true,
  shipmentRequestId: true,
  salesOrderId: true,
  issuedAt: true,
  pdfPath: true,
  shipmentRequest: { select: { shipmentRequestNo: true } },
  salesOrder: { select: { salesOrderNo: true } },
} satisfies Prisma.MillSheetSelect;

const millSheetDetailSelect = { ...millSheetSummarySelect, snapshot: true } satisfies Prisma.MillSheetSelect;

/** 출고 확정에 필요한 것: 요청 품목마다 수주 품목·고객사와 CONFIRMED 배정 */
const issueSelect = {
  id: true,
  shipmentRequestNo: true,
  shipmentRequestStatus: true,
  shipDate: true,
  customer: { select: { id: true, customerCode: true, customerName: true } },
  shipmentRequestItems: {
    orderBy: { id: 'asc' },
    select: {
      id: true,
      requestQty: true,
      salesOrderItem: {
        select: {
          id: true,
          salesOrderId: true,
          itemId: true,
          orderedQty: true,
          salesOrderItemStatus: true,
          salesOrder: { select: { id: true, salesOrderNo: true } },
          item: {
            select: {
              id: true,
              itemCode: true,
              itemName: true,
              itemType: true,
              thicknessMm: true,
              widthMm: true,
              lengthMm: true,
              theoreticalWeightTon: true,
              steelGrade: { select: { steelGradeCode: true, standardNo: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ShipmentRequestSelect;

const inspectionSelect = {
  lotId: true,
  inspectionResult: true,
  inspectedAt: true,
  inspectionStandard: { select: { inspectionStandardCode: true, versionNo: true, processType: true } },
  qualityInspectionValues: {
    orderBy: { inspectionStandardItemId: 'asc' },
    select: {
      measuredValue: true,
      inspectionStandardItem: { select: { inspectionItemCode: true, inspectionItemName: true, unit: true, minValue: true, maxValue: true } },
    },
  },
} satisfies Prisma.QualityInspectionSelect;

const heatSelect = {
  id: true,
  lotNo: true,
  lotType: true,
  producedDate: true,
  steelGrade: { select: { steelGradeCode: true } },
  productionResult: { select: { converterCode: true, completedAt: true } },
} satisfies Prisma.LotSelect;

/** 부모 LOT은 중첩 select 대신 따로 읽는다 (중첩 to-one을 여러 행에 걸쳐 읽으면 Prisma 쿼리 인터프리터가 실패한다) */
const lotSnapshotSelect = {
  id: true,
  lotNo: true,
  lotType: true,
  producedDate: true,
} satisfies Prisma.LotSelect;

type IssueBaseRow = Prisma.ShipmentRequestGetPayload<{ select: typeof issueSelect }>;
export type ShipmentRequestIssueRow = Omit<IssueBaseRow, 'shipmentRequestItems'> & {
  shipmentRequestItems: (IssueBaseRow['shipmentRequestItems'][number] & { allocations: { id: number; lotId: number }[] })[];
};
export type SnapshotInspectionRow = Prisma.QualityInspectionGetPayload<{ select: typeof inspectionSelect }>;
export type SnapshotHeatRow = Prisma.LotGetPayload<{ select: typeof heatSelect }> & { inspection: SnapshotInspectionRow | null };
/** 슬래브·코일 LOT과 부모 LOT. 부모의 부모까지 담는다(코일 → 슬래브 → 히트) */
export type SnapshotLotRow = Prisma.LotGetPayload<{ select: typeof lotSnapshotSelect }> & {
  inspection: SnapshotInspectionRow | null;
  parents: (SnapshotHeatRow & { parents: SnapshotHeatRow[] })[] };

export type ShipmentRequestSummaryRow = Prisma.ShipmentRequestGetPayload<{ select: typeof summarySelect }>;
export type ShipmentRequestDetailRow = Prisma.ShipmentRequestGetPayload<{ select: typeof detailSelect }>;
export type MillSheetSummaryRow = Prisma.MillSheetGetPayload<{ select: typeof millSheetSummarySelect }>;
export type MillSheetDetailRow = Prisma.MillSheetGetPayload<{ select: typeof millSheetDetailSelect }>;

@Injectable()
export class ShipmentRepository {
  lockSalesOrderItems(tx: Tx, salesOrderItemIds: number[]) {
    return tx.$queryRawTyped(lockSalesOrderItemsForShipment(salesOrderItemIds));
  }

  findShippableQty(tx: Tx, salesOrderItemIds: number[], activeReservationStatus: string, pendingStatuses: ShipmentRequestStatus[]) {
    return tx.$queryRawTyped(getShippableQtyBySalesOrderItem(salesOrderItemIds, activeReservationStatus, pendingStatuses));
  }

  create(
    tx: Tx,
    data: { shipmentRequestNo: string; customerId: number; shipDate: Date | null; items: { salesOrderItemId: number; requestQty: number }[] },
  ) {
    return tx.shipmentRequest.create({
      data: {
        shipmentRequestNo: data.shipmentRequestNo,
        customerId: data.customerId,
        shipDate: data.shipDate,
        shipmentRequestItems: { create: data.items },
      },
      select: { id: true },
    });
  }

  findMany(tx: Tx, where: Prisma.ShipmentRequestWhereInput, skip: number, take: number) {
    return tx.shipmentRequest.findMany({ where, orderBy: { id: 'desc' }, skip, take, select: summarySelect });
  }

  count(tx: Tx, where: Prisma.ShipmentRequestWhereInput) {
    return tx.shipmentRequest.count({ where });
  }

  findDetail(tx: Tx, id: number) {
    return tx.shipmentRequest.findUnique({ where: { id }, select: detailSelect });
  }

  /** 상태 갱신용: 품목별 요청 매수와 CONFIRMED 배정 수 */
  findAllocationProgress(tx: Tx, id: number) {
    return tx.shipmentRequest.findUnique({
      where: { id },
      select: {
        shipmentRequestStatus: true,
        shipmentRequestItems: {
          select: {
            requestQty: true,
            _count: { select: { allocations: { where: { allocationStatus: ALLOCATION_STATUS.CONFIRMED } } } },
          },
        },
      },
    });
  }

  /** 출하할 수 있는 상태(진행중·부분출하)의 수주 품목. 납기 순 */
  findOpenSalesOrderItems(tx: Tx, customerId?: number) {
    return tx.salesOrderItem.findMany({
      where: {
        salesOrderItemStatus: { in: [SALES_ORDER_ITEM_STATUS.OPEN, SALES_ORDER_ITEM_STATUS.PARTIALLY_SHIPPED] },
        ...(customerId ? { salesOrder: { customerId } } : {}),
      },
      select: {
        id: true,
        salesOrderId: true,
        itemId: true,
        orderedQty: true,
        dueDate: true,
        salesOrder: { select: { salesOrderNo: true, customerId: true, customer: { select: { customerName: true } } } },
        item: { select: { itemCode: true, itemName: true, itemType: true } },
      },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    });
  }

  /** 출하요청을 잠근다. 취소·배정 확정·해제가 같은 요청의 상태를 동시에 바꾸지 않게 한다 */
  async lockShipmentRequest(tx: Tx, id: number) {
    return (await tx.$queryRawTyped(lockShipmentRequest(id)))[0] ?? null;
  }

  updateStatus(tx: Tx, id: number, shipmentRequestStatus: ShipmentRequestStatus) {
    return tx.shipmentRequest.update({ where: { id }, data: { shipmentRequestStatus }, select: { id: true } });
  }

  /** 배정은 중첩 select 대신 따로 읽는다 (중첩 to-one 아래 to-many를 한 번에 읽으면 Prisma 쿼리 인터프리터가 실패한다) */
  async findIssueContext(tx: Tx, id: number): Promise<ShipmentRequestIssueRow | null> {
    const request = await tx.shipmentRequest.findUnique({ where: { id }, select: issueSelect });
    if (!request) return null;
    const allocations = await tx.allocation.findMany({
      where: { shipmentRequestItemId: { in: request.shipmentRequestItems.map((i) => i.id) }, allocationStatus: ALLOCATION_STATUS.CONFIRMED },
      orderBy: { id: 'asc' },
      select: { id: true, lotId: true, shipmentRequestItemId: true },
    });
    return {
      ...request,
      shipmentRequestItems: request.shipmentRequestItems.map((i) => ({ ...i, allocations: allocations.filter((a) => a.shipmentRequestItemId === i.id) })),
    };
  }

  /** 출고하는 LOT을 SHIPPED로. AVAILABLE이 아닌 LOT이 섞여 있으면 바뀐 수가 모자라 false (잠금 안이라 보통 일어나지 않는다) */
  async markLotsShipped(tx: Tx, lotIds: number[]): Promise<boolean> {
    // id IN (…)인 updateMany는 Prisma 쿼리 인터프리터가 "Expected zero or one element"로 실패해서 LOT마다 고친다
    let changed = 0;
    for (const id of [...lotIds].sort((a, b) => a - b)) {
      changed += (await tx.lot.updateMany({ where: { id, lotStatus: LOT_STATUS.AVAILABLE }, data: { lotStatus: LOT_STATUS.SHIPPED } })).count;
    }
    return changed === lotIds.length;
  }

  markIssued(tx: Tx, id: number, issuedAt: Date, issuedEmployeeId: number) {
    return tx.shipmentRequest.update({ where: { id }, data: { shipmentRequestStatus: SHIPMENT_REQUEST_STATUS.ISSUED, issuedAt, issuedEmployeeId }, select: { id: true } });
  }

  /** 출고 LOT과 계보(코일 → 슬래브 → 히트, 슬래브 → 히트)를 단계별로 읽는다 */
  async findLotsForSnapshot(tx: Tx, lotIds: number[]): Promise<SnapshotLotRow[]> {
    const lots = await tx.lot.findMany({ where: { id: { in: lotIds } }, orderBy: { id: 'asc' }, select: lotSnapshotSelect });
    const parentIdsOf = async (childIds: number[]) => {
      const relations = await tx.lotRelation.findMany({ where: { childLotId: { in: childIds } }, orderBy: { id: 'asc' }, select: { childLotId: true, parentLotId: true } });
      return relations;
    };
    const firstLevel = await parentIdsOf(lots.map((l) => l.id));
    const secondLevel = await parentIdsOf([...new Set(firstLevel.map((r) => r.parentLotId))]);
    const parentLots = await tx.lot.findMany({
      where: { id: { in: [...new Set([...firstLevel, ...secondLevel].map((r) => r.parentLotId))] } },
      select: heatSelect,
    });
    // 검사도 중첩 select 대신 따로 읽는다 (1:1 역관계를 여러 LOT에 걸쳐 중첩해 읽으면 같은 오류가 난다)
    const inspections = await tx.qualityInspection.findMany({ where: { lotId: { in: [...lots.map((l) => l.id), ...parentLots.map((p) => p.id)] } }, select: inspectionSelect });
    const inspectionOf = (lotId: number) => inspections.find((i) => i.lotId === lotId) ?? null;
    const parentById = new Map(parentLots.map((p) => [p.id, { ...p, inspection: inspectionOf(p.id) }]));
    const parentsOf = (relations: typeof firstLevel, childId: number) =>
      relations.filter((r) => r.childLotId === childId).flatMap((r) => parentById.get(r.parentLotId) ?? []);
    return lots.map((lot) => ({
      ...lot,
      inspection: inspectionOf(lot.id),
      parents: parentsOf(firstLevel, lot.id).map((p) => ({ ...p, parents: parentsOf(secondLevel, p.id) })),
    }));
  }

  createMillSheet(tx: Tx, data: { millSheetNo: string; shipmentRequestId: number; salesOrderId: number; snapshot: Prisma.InputJsonValue; issuedAt: Date }) {
    return tx.millSheet.create({ data, select: { id: true } });
  }

  findMillSheets(tx: Tx, where: Prisma.MillSheetWhereInput, skip: number, take: number) {
    return tx.millSheet.findMany({ where, orderBy: { id: 'desc' }, skip, take, select: millSheetSummarySelect });
  }

  countMillSheets(tx: Tx, where: Prisma.MillSheetWhereInput) {
    return tx.millSheet.count({ where });
  }

  /** PDF 경로는 한 번만 정한다: 동시에 만든 다른 요청이 먼저 저장했으면 바뀐 행이 없어 false */
  async setPdfPath(tx: Tx, id: number, pdfPath: string): Promise<boolean> {
    const result = await tx.millSheet.updateMany({ where: { id, pdfPath: null }, data: { pdfPath } });
    return result.count > 0;
  }

  findMillSheet(tx: Tx, id: number) {
    return tx.millSheet.findUnique({ where: { id }, select: millSheetDetailSelect });
  }
}
