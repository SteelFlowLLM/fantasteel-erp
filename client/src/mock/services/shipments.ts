// 출하요청·출하 배정 (REQ-SHP-001, REQ-INV-006·007·009, BP-SHP-01, 업무 프로세스 4.2·10장).
// - 같은 고객사의 수주 품목만 묶는다(shipment_request.customer_id). 요청 매수는 1 이상 정수(SO-002), 출하 가능 잔량 초과는 SHP-002.
//   출하 가능 잔량 = ACTIVE 예약 − 진행 중(REQUESTED·ALLOCATED) 출하요청에 이미 넣은 매수.
// - 저장 직후 FIFO 추천을 돌려준다(저장 안 함). 확정 = SHIPMENT 배정 CONFIRMED(sales_order_item_id, shipment_request_item_id).
// - 상태: REQUESTED 배정 대기 → ALLOCATED 배정 확정(모든 품목이 요청 매수만큼 배정) → ISSUED / CANCELLED.
// - 취소: ISSUED면 SHP-003. CONFIRMED 배정은 RELEASED, 예약은 ACTIVE 그대로.
import type { ProductItemType, ShipmentRequestStatus } from '@/codes';
import { calcWeightTon, sumTon } from '@/lib/weight';
import { recordBusinessEvent } from '@/mock/businessEvents';
import type { AllocationRow, LotRow, MockTables, ShipmentRequestItemRow, ShipmentRequestRow } from '@/mock/schema';
import { issueBusinessNo } from '@/mock/sequence';
import { insertRow, updateRow, type MockTx } from '@/mock/store';
import {
  assertAllocatableLot,
  changeAllocation,
  insertConfirmedAllocation,
  recommendFifoLots,
  recordRecommendation,
  refreshShipmentRequestStatus,
  releaseAllocation,
  releaseAllocationRow,
} from '@/mock/services/allocations';
import {
  ApiError,
  assertNotChanged,
  checkDate,
  employeeNameOf,
  FieldErrors,
  findById,
  inputError,
  mustGet,
  requirePositiveQty,
  unitWeightOf,
  type PersonActor,
} from '@/mock/services/context';
import { activeReservedQtyOfItem, heatOf } from '@/mock/services/inventoryPool';

type Tables = Readonly<MockTables>;

const isOpenRequest = (r: ShipmentRequestRow | undefined) => r?.shipmentRequestStatus === 'REQUESTED' || r?.shipmentRequestStatus === 'ALLOCATED';

/** 진행 중 출하요청에 이미 넣은 매수 (excludeRequestId 제외) */
export function openRequestQtyOf(tables: Tables, salesOrderItemId: number, excludeRequestId?: number): number {
  return tables.shipmentRequestItem
    .filter((line) => line.salesOrderItemId === salesOrderItemId && line.shipmentRequestId !== excludeRequestId)
    .filter((line) => isOpenRequest(tables.shipmentRequest.find((r) => r.id === line.shipmentRequestId)))
    .reduce((sum, line) => sum + line.requestQty, 0);
}

export interface ShippableItem {
  salesOrderItemId: number;
  salesOrderId: number;
  salesOrderNo: string;
  lineNo: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  itemType: ProductItemType;
  unitWeightTon: string;
  orderedQty: number;
  shippedQty: number;
  dueDate: string;
  activeReservedQty: number;
  openRequestQty: number;
  /** 출하 가능 잔량 = ACTIVE 예약 − 진행 중 출하요청 매수 */
  shippableQty: number;
}

/** 이 고객사의 출하할 수 있는 수주 품목 (진행중·부분출하, 잔량 > 0) */
export function shippableItemsOf(tables: Tables, customerId: number): ShippableItem[] {
  const salesOrders = tables.salesOrder.filter((o) => o.customerId === customerId && !o.cancelledAt);
  return salesOrders
    .flatMap((so) =>
      tables.salesOrderItem
        .filter((i) => i.salesOrderId === so.id && (i.salesOrderItemStatus === 'OPEN' || i.salesOrderItemStatus === 'PARTIALLY_SHIPPED'))
        .map((i): ShippableItem => {
          const item = mustGet(tables, 'item', i.itemId, '규격');
          const activeReservedQty = activeReservedQtyOfItem(tables, i.id);
          const openRequestQty = openRequestQtyOf(tables, i.id);
          return {
            salesOrderItemId: i.id,
            salesOrderId: so.id,
            salesOrderNo: so.salesOrderNo,
            lineNo: i.lineNo,
            itemId: item.id,
            itemCode: item.itemCode,
            itemName: item.itemName,
            itemType: item.itemType === 'COIL' ? 'COIL' : 'SLAB',
            unitWeightTon: unitWeightOf(item),
            orderedQty: i.orderedQty,
            shippedQty: i.shippedQty,
            dueDate: i.dueDate,
            activeReservedQty,
            openRequestQty,
            shippableQty: Math.max(0, activeReservedQty - openRequestQty),
          };
        }),
    )
    .filter((i) => i.shippableQty > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.salesOrderItemId - b.salesOrderItemId);
}

export interface ShipmentLotView {
  lotId: number;
  lotNo: string;
  producedDate: string;
  heatLotNo: string | null;
  yardId: number | null;
}

const lotViewOf = (tables: Tables, lot: LotRow): ShipmentLotView => ({
  lotId: lot.id,
  lotNo: lot.lotNo,
  producedDate: lot.producedDate,
  heatLotNo: heatOf(tables, lot)?.lotNo ?? null,
  yardId: lot.yardId,
});

export interface ShipmentRecommendationLine {
  shipmentRequestItemId: number;
  salesOrderItemId: number;
  itemId: number;
  requestQty: number;
  allocatedQty: number;
  /** 배정 대기 = 요청 매수 − CONFIRMED 배정 */
  unallocatedQty: number;
  /** FIFO 추천 (생산완료일 → LOT 번호), 배정 대기 매수만큼 */
  recommendedLots: ShipmentLotView[];
  /** 고를 수 있는 모든 적격·미배정 LOT (FIFO 순) — 다른 LOT 선택·변경용 */
  candidateLots: ShipmentLotView[];
}

/** 출하요청의 FIFO 추천 (저장 안 함, SHP-001) */
export function shipmentRecommendation(tables: Tables, shipmentRequestId: number): ShipmentRecommendationLine[] {
  mustGet(tables, 'shipmentRequest', shipmentRequestId, '출하요청');
  // 같은 규격 품목이 한 요청에 여러 줄이면 줄 순서대로 나눠 추천한다(앞 줄이 고른 LOT은 뒤 줄 추천에서 뺀다).
  // FIFO 순서는 그대로라 [추천대로 모두 확정]이 INV-003에 걸리지 않고, 확정 함수가 남기는 추천(줄마다 앞 줄 배정을 뺀 FIFO)과 같다.
  const taken = new Set<number>();
  return tables.shipmentRequestItem
    .filter((l) => l.shipmentRequestId === shipmentRequestId)
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((line) => {
      const soItem = mustGet(tables, 'salesOrderItem', line.salesOrderItemId, '수주 품목');
      const allocatedQty = tables.allocation.filter((a) => a.shipmentRequestItemId === line.id && a.allocationStatus === 'CONFIRMED').length;
      const unallocatedQty = Math.max(0, line.requestQty - allocatedQty);
      const candidates = recommendFifoLots(tables, soItem.itemId, Number.MAX_SAFE_INTEGER);
      const recommended = candidates.filter((l) => !taken.has(l.id)).slice(0, unallocatedQty);
      for (const lot of recommended) taken.add(lot.id);
      return {
        shipmentRequestItemId: line.id,
        salesOrderItemId: soItem.id,
        itemId: soItem.itemId,
        requestQty: line.requestQty,
        allocatedQty,
        unallocatedQty,
        recommendedLots: recommended.map((l) => lotViewOf(tables, l)),
        candidateLots: candidates.map((l) => lotViewOf(tables, l)),
      };
    });
}

export interface CreateShipmentRequestInput {
  customerId: number;
  requestedShipDate: string;
  items: readonly { salesOrderItemId: number; requestQty: number | string }[];
}

/** 출하요청 등록. 결과에 바로 FIFO 추천을 담는다 (SHP-001). */
export function createShipmentRequest(
  tx: MockTx,
  actor: PersonActor,
  input: CreateShipmentRequestInput,
): { shipmentRequest: ShipmentRequestRow; items: ShipmentRequestItemRow[]; recommendation: ShipmentRecommendationLine[] } {
  const customer = mustGet(tx.tables, 'customer', input.customerId, '고객사');
  const errors = new FieldErrors();
  const requestedShipDate = checkDate(errors, 'requestedShipDate', input.requestedShipDate, '출하 요청일', true);
  errors.throwIfAny();
  if (input.items.length === 0) inputError('items', '출하할 수주 품목을 하나 이상 골라 주세요');
  if (new Set(input.items.map((i) => i.salesOrderItemId)).size !== input.items.length) inputError('items', '같은 수주 품목을 두 번 넣었어요');
  const lines = input.items.map((line, index) => {
    const soItem = mustGet(tx.tables, 'salesOrderItem', line.salesOrderItemId, '수주 품목');
    const so = mustGet(tx.tables, 'salesOrder', soItem.salesOrderId, '수주');
    if (so.customerId !== customer.id) inputError(`items.${index}.salesOrderItemId`, '같은 고객사의 수주 품목만 묶을 수 있어요');
    if (soItem.salesOrderItemStatus === 'CANCELLED' || soItem.salesOrderItemStatus === 'SHIPPED') inputError(`items.${index}.salesOrderItemId`, '출하할 수 없는 수주 품목이에요');
    const requestQty = requirePositiveQty(line.requestQty, `${index + 1}번째 품목`);
    const shippable = Math.max(0, activeReservedQtyOfItem(tx.tables, soItem.id) - openRequestQtyOf(tx.tables, soItem.id));
    if (requestQty > shippable) throw new ApiError('SHP-002', `${so.salesOrderNo} ${soItem.lineNo}번 품목 출하 가능 ${shippable}매`);
    return { soItem, so, requestQty };
  });
  const shipmentRequest = insertRow(tx, 'shipmentRequest', {
    shipmentRequestNo: issueBusinessNo(tx, 'SHIPMENT_REQUEST'),
    customerId: customer.id,
    requestedShipDate: requestedShipDate ?? '',
    shipmentRequestStatus: 'REQUESTED',
    requesterId: actor.employeeId,
    issuedAt: null,
    issuedEmployeeId: null,
    cancelledAt: null,
  });
  const items = lines.map((line, index) =>
    insertRow(tx, 'shipmentRequestItem', { shipmentRequestId: shipmentRequest.id, lineNo: index + 1, salesOrderItemId: line.soItem.id, requestQty: line.requestQty }),
  );
  // 수주 타임라인에 보이도록 수주마다 한 건씩 남긴다
  for (const soId of [...new Set(lines.map((l) => l.so.id))]) {
    const salesOrderLines = items.filter((_, i) => lines[i].so.id === soId);
    recordBusinessEvent(tx, {
      businessEventType: 'SHIPMENT_REQUEST_CREATED',
      actor,
      targetType: 'shipment_request',
      targetId: shipmentRequest.id,
      targetNo: shipmentRequest.shipmentRequestNo,
      salesOrderId: soId,
      afterData: {
        shipmentRequestNo: shipmentRequest.shipmentRequestNo,
        customerName: customer.customerName,
        requestedShipDate: shipmentRequest.requestedShipDate,
        lines: salesOrderLines.map((l) => ({ lineNo: l.lineNo, salesOrderItemId: l.salesOrderItemId, requestQty: l.requestQty })),
      },
    });
  }
  return { shipmentRequest, items, recommendation: shipmentRecommendation(tx.tables, shipmentRequest.id) };
}

function openRequestForAllocation(tables: Tables, shipmentRequestId: number): ShipmentRequestRow {
  const request = mustGet(tables, 'shipmentRequest', shipmentRequestId, '출하요청');
  if (request.shipmentRequestStatus === 'ISSUED') inputError('shipmentRequestId', '출고 확정된 출하요청이에요');
  if (request.shipmentRequestStatus === 'CANCELLED') inputError('shipmentRequestId', '취소된 출하요청이에요');
  return request;
}

/**
 * 출하 배정 확정 (13.2 confirmAllocation). 품목마다 고른 LOT을 CONFIRMED로 만든다.
 * 배정 대기 매수·ACTIVE 예약을 넘으면 INV-001, 규격·품질·소진·중복은 assertAllocatableLot(INV-002·003·004).
 * 확정 직전의 FIFO 추천을 ALLOCATION_RECOMMENDED로 남긴다.
 */
export function confirmShipmentAllocations(
  tx: MockTx,
  actor: PersonActor,
  input: { shipmentRequestId: number; lines: readonly { shipmentRequestItemId: number; lotIds: readonly number[] }[] },
): AllocationRow[] {
  const request = openRequestForAllocation(tx.tables, input.shipmentRequestId);
  const created: AllocationRow[] = [];
  for (const lineInput of input.lines) {
    const line = mustGet(tx.tables, 'shipmentRequestItem', lineInput.shipmentRequestItemId, '출하요청 품목');
    if (line.shipmentRequestId !== request.id) inputError('lines', '이 출하요청의 품목이 아니에요');
    const lotIds = [...new Set(lineInput.lotIds)];
    if (lotIds.length === 0) continue;
    const soItem = mustGet(tx.tables, 'salesOrderItem', line.salesOrderItemId, '수주 품목');
    const lots = lotIds.map((id) => assertAllocatableLot(tx.tables, id, soItem.itemId));
    const allocated = tx.tables.allocation.filter((a) => a.shipmentRequestItemId === line.id && a.allocationStatus === 'CONFIRMED').length;
    if (allocated + lotIds.length > line.requestQty) throw new ApiError('INV-001', `배정 대기 ${line.requestQty - allocated}매`);
    const itemAllocated = tx.tables.allocation.filter((a) => a.salesOrderItemId === soItem.id && a.allocationPurpose === 'SHIPMENT' && a.allocationStatus === 'CONFIRMED').length;
    if (itemAllocated + lotIds.length > activeReservedQtyOfItem(tx.tables, soItem.id)) throw new ApiError('INV-001', '예약 매수보다 많이 배정할 수 없어요');
    recordRecommendation(tx, actor, {
      allocationPurpose: 'SHIPMENT',
      itemId: soItem.itemId,
      recommendedLotIds: recommendFifoLots(tx.tables, soItem.itemId, line.requestQty - allocated).map((l) => l.id),
      chosenLotIds: lotIds,
      targetType: 'shipment_request_item',
      targetId: line.id,
      targetNo: request.shipmentRequestNo,
      salesOrderId: soItem.salesOrderId,
    });
    for (const lot of lots) {
      created.push(insertConfirmedAllocation(tx, actor, lot, { allocationPurpose: 'SHIPMENT', salesOrderItemId: soItem.id, shipmentRequestItemId: line.id, productionPlanId: null }));
    }
  }
  refreshShipmentRequestStatus(tx, request.id);
  return created;
}

/** 출하 배정 변경 (해제 + 새 배정, 사유 필수) */
export function changeShipmentAllocation(tx: MockTx, actor: PersonActor, input: { allocationId: number; newLotId: number; reasonText: string }): AllocationRow {
  const allocation = mustGet(tx.tables, 'allocation', input.allocationId, '배정');
  if (allocation.allocationPurpose !== 'SHIPMENT') inputError('allocationId', '출하 배정이 아니에요');
  const line = mustGet(tx.tables, 'shipmentRequestItem', allocation.shipmentRequestItemId, '출하요청 품목');
  openRequestForAllocation(tx.tables, line.shipmentRequestId);
  return changeAllocation(tx, actor, input);
}

/** 출하 배정 해제 */
export function releaseShipmentAllocation(tx: MockTx, actor: PersonActor, input: { allocationId: number; reasonText?: string | null }): AllocationRow {
  const allocation = mustGet(tx.tables, 'allocation', input.allocationId, '배정');
  if (allocation.allocationPurpose !== 'SHIPMENT') inputError('allocationId', '출하 배정이 아니에요');
  const line = mustGet(tx.tables, 'shipmentRequestItem', allocation.shipmentRequestItemId, '출하요청 품목');
  openRequestForAllocation(tx.tables, line.shipmentRequestId);
  return releaseAllocation(tx, actor, input);
}

/** 출하요청 취소: 출고 확정되었으면 SHP-003. 배정은 해제하고 예약은 그대로 둔다. (작업 로그: 배정 해제만 — 출하요청 취소 이벤트 유형이 없다) */
export function cancelShipmentRequest(tx: MockTx, actor: PersonActor, input: { shipmentRequestId: number; expectedUpdatedAt?: string | null }): ShipmentRequestRow {
  const request = mustGet(tx.tables, 'shipmentRequest', input.shipmentRequestId, '출하요청');
  assertNotChanged(request.updatedAt, input.expectedUpdatedAt, '출하요청');
  if (request.shipmentRequestStatus === 'ISSUED') throw new ApiError('SHP-003');
  if (request.shipmentRequestStatus === 'CANCELLED') inputError('shipmentRequestId', '이미 취소된 출하요청이에요');
  const lineIds = new Set(tx.tables.shipmentRequestItem.filter((l) => l.shipmentRequestId === request.id).map((l) => l.id));
  for (const allocation of tx.tables.allocation.filter((a) => a.allocationStatus === 'CONFIRMED' && a.shipmentRequestItemId !== null && lineIds.has(a.shipmentRequestItemId))) {
    releaseAllocationRow(tx, actor, allocation, { reasonCode: null, reasonText: `출하요청 ${request.shipmentRequestNo} 취소` });
  }
  return updateRow(tx, 'shipmentRequest', request.id, { shipmentRequestStatus: 'CANCELLED', cancelledAt: tx.nowIso }) ?? request;
}

// ── 조회 ──────────────────────────────────────────────

export interface ShipmentRequestSummary {
  id: number;
  shipmentRequestNo: string;
  customerId: number;
  customerName: string;
  requestedShipDate: string;
  shipmentRequestStatus: ShipmentRequestStatus;
  requesterName: string | null;
  createdAt: string;
  updatedAt: string;
  issuedAt: string | null;
  issuedEmployeeName: string | null;
  cancelledAt: string | null;
  salesOrderNos: string[];
  totalRequestQty: number;
  totalAllocatedQty: number;
  /** 배정 대기 매수 합계 (요청 − CONFIRMED·CONSUMED 배정) */
  waitingAllocationQty: number;
  totalWeightTon: string;
}

export interface ShipmentRequestLineView {
  shipmentRequestItemId: number;
  lineNo: number;
  salesOrderId: number;
  salesOrderNo: string;
  salesOrderItemId: number;
  salesOrderLineNo: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  itemType: ProductItemType;
  unitWeightTon: string;
  requestQty: number;
  requestTon: string;
  allocatedQty: number;
  waitingAllocationQty: number;
  allocations: (ShipmentLotView & { allocationId: number; allocationStatus: AllocationRow['allocationStatus']; confirmedAt: string; confirmedEmployeeName: string | null })[];
}

export interface ShipmentRequestDetail extends ShipmentRequestSummary {
  lines: ShipmentRequestLineView[];
  millSheets: { id: number; millSheetNo: string; salesOrderId: number; issuedAt: string; pdfPath: string | null }[];
}

function linesOf(tables: Tables, request: ShipmentRequestRow): ShipmentRequestLineView[] {
  return tables.shipmentRequestItem
    .filter((l) => l.shipmentRequestId === request.id)
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((line) => {
      const soItem = mustGet(tables, 'salesOrderItem', line.salesOrderItemId, '수주 품목');
      const so = mustGet(tables, 'salesOrder', soItem.salesOrderId, '수주');
      const item = mustGet(tables, 'item', soItem.itemId, '규격');
      const allocations = tables.allocation.filter((a) => a.shipmentRequestItemId === line.id && a.allocationStatus !== 'RELEASED').sort((a, b) => a.id - b.id);
      const unitWeightTon = unitWeightOf(item);
      return {
        shipmentRequestItemId: line.id,
        lineNo: line.lineNo,
        salesOrderId: so.id,
        salesOrderNo: so.salesOrderNo,
        salesOrderItemId: soItem.id,
        salesOrderLineNo: soItem.lineNo,
        itemId: item.id,
        itemCode: item.itemCode,
        itemName: item.itemName,
        itemType: item.itemType === 'COIL' ? 'COIL' : 'SLAB',
        unitWeightTon,
        requestQty: line.requestQty,
        requestTon: calcWeightTon(line.requestQty, unitWeightTon),
        allocatedQty: allocations.length,
        waitingAllocationQty: Math.max(0, line.requestQty - allocations.length),
        allocations: allocations.map((a) => ({
          ...lotViewOf(tables, mustGet(tables, 'lot', a.lotId, 'LOT')),
          allocationId: a.id,
          allocationStatus: a.allocationStatus,
          confirmedAt: a.confirmedAt,
          confirmedEmployeeName: employeeNameOf(tables, a.confirmedEmployeeId),
        })),
      };
    });
}

function summaryOf(tables: Tables, request: ShipmentRequestRow, lines: ShipmentRequestLineView[]): ShipmentRequestSummary {
  return {
    id: request.id,
    shipmentRequestNo: request.shipmentRequestNo,
    customerId: request.customerId,
    customerName: findById(tables, 'customer', request.customerId)?.customerName ?? '',
    requestedShipDate: request.requestedShipDate,
    shipmentRequestStatus: request.shipmentRequestStatus,
    requesterName: employeeNameOf(tables, request.requesterId),
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    issuedAt: request.issuedAt,
    issuedEmployeeName: employeeNameOf(tables, request.issuedEmployeeId),
    cancelledAt: request.cancelledAt,
    salesOrderNos: [...new Set(lines.map((l) => l.salesOrderNo))],
    totalRequestQty: lines.reduce((s, l) => s + l.requestQty, 0),
    totalAllocatedQty: lines.reduce((s, l) => s + l.allocatedQty, 0),
    waitingAllocationQty: request.shipmentRequestStatus === 'CANCELLED' ? 0 : lines.reduce((s, l) => s + l.waitingAllocationQty, 0),
    totalWeightTon: sumTon(lines.map((l) => l.requestTon)),
  };
}

export function listShipmentRequests(tables: Tables): ShipmentRequestSummary[] {
  return [...tables.shipmentRequest].sort((a, b) => b.id - a.id).map((r) => summaryOf(tables, r, linesOf(tables, r)));
}

export function shipmentRequestDetail(tables: Tables, shipmentRequestId: number): ShipmentRequestDetail {
  const request = mustGet(tables, 'shipmentRequest', shipmentRequestId, '출하요청');
  const lines = linesOf(tables, request);
  return {
    ...summaryOf(tables, request, lines),
    lines,
    millSheets: tables.millSheet
      .filter((m) => m.shipmentRequestId === request.id)
      .map((m) => ({ id: m.id, millSheetNo: m.millSheetNo, salesOrderId: m.salesOrderId, issuedAt: m.issuedAt, pdfPath: m.pdfPath })),
  };
}
