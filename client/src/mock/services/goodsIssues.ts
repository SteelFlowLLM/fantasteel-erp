// 출고 확정 (REQ-SHP-002·003, REQ-INV-005, REQ-SO-005, BP-SHP-01, 13.3 confirmGoodsIssue).
// - 별도 출고 테이블·번호 없음: shipment_request.issued_at / issued_employee_id, 상태 ISSUED.
// - 다시 확인: 배정 대기 남음 → INV-001, 소진·출고된 LOT → INV-004, 미검사·불합격(제품·상위 히트) → INV-002, 예약·수주 잔량 초과 → SHP-002.
// - 처리: 배정 CONSUMED, LOT SHIPPED, 예약 ACTIVE → CONVERTED(부분이면 행 분할), shipped_qty·품목 상태, 재고, 밀시트(출하요청 × 수주).
// - 작업 로그: GOODS_ISSUE_CONFIRMED(수주마다, LOT 전부 business_event_lot) → RESERVATION_CONVERTED → MILL_SHEET_ISSUED.
import { itemStatusOf } from '@/lib/salesOrderStatus';
import { recordBusinessEvent } from '@/mock/businessEvents';
import type { ErrorCode } from '@/codes';
import type { LotRow, MillSheetRow, MockTables, SalesOrderItemRow, ShipmentRequestRow } from '@/mock/schema';
import { updateRow, type MockTx } from '@/mock/store';
import { ApiError, assertNotChanged, inputError, mustGet, refreshInventory, type PersonActor } from '@/mock/services/context';
import { activeReservedQtyOfItem, lotEligibility } from '@/mock/services/inventoryPool';
import { createMillSheet } from '@/mock/services/millSheets';
import { convertReservations } from '@/mock/services/reservations';

type Tables = Readonly<MockTables>;

export interface GoodsIssueProblem {
  code: ErrorCode;
  message: string;
  lotNo: string | null;
}

/** 출고 확정 전에 화면이 보여 줄 재검증 결과 (저장 안 함) */
export function goodsIssueCheck(tables: Tables, shipmentRequestId: number): { ready: boolean; problems: GoodsIssueProblem[] } {
  const request = mustGet(tables, 'shipmentRequest', shipmentRequestId, '출하요청');
  const problems: GoodsIssueProblem[] = [];
  if (request.shipmentRequestStatus === 'ISSUED') problems.push({ code: 'COM-001', message: '이미 출고 확정됐어요', lotNo: null });
  if (request.shipmentRequestStatus === 'CANCELLED') problems.push({ code: 'COM-003', message: '취소된 출하요청이에요', lotNo: null });
  for (const line of tables.shipmentRequestItem.filter((l) => l.shipmentRequestId === request.id)) {
    const soItem = mustGet(tables, 'salesOrderItem', line.salesOrderItemId, '수주 품목');
    const allocations = tables.allocation.filter((a) => a.shipmentRequestItemId === line.id && a.allocationStatus === 'CONFIRMED');
    if (allocations.length < line.requestQty) problems.push({ code: 'INV-001', message: `배정 대기 ${line.requestQty - allocations.length}매`, lotNo: null });
    if (line.requestQty > soItem.orderedQty - soItem.shippedQty || line.requestQty > activeReservedQtyOfItem(tables, soItem.id)) {
      problems.push({ code: 'SHP-002', message: '예약·수주 잔량보다 많아요', lotNo: null });
    }
    for (const allocation of allocations) {
      const lot = mustGet(tables, 'lot', allocation.lotId, 'LOT');
      if (lot.lotStatus !== 'AVAILABLE') problems.push({ code: 'INV-004', message: '이미 투입·출고된 LOT', lotNo: lot.lotNo });
      else if (lotEligibility(tables, lot) !== 'ELIGIBLE') problems.push({ code: 'INV-002', message: '미검사·불합격 LOT은 출고할 수 없어요', lotNo: lot.lotNo });
    }
  }
  return { ready: problems.length === 0, problems };
}

export interface ConfirmGoodsIssueResult {
  shipmentRequest: ShipmentRequestRow;
  issuedLotNos: string[];
  millSheets: MillSheetRow[];
}

export function confirmGoodsIssue(tx: MockTx, actor: PersonActor, input: { shipmentRequestId: number; expectedUpdatedAt?: string | null }): ConfirmGoodsIssueResult {
  const request = mustGet(tx.tables, 'shipmentRequest', input.shipmentRequestId, '출하요청');
  assertNotChanged(request.updatedAt, input.expectedUpdatedAt, '출하요청');
  if (request.shipmentRequestStatus === 'ISSUED') throw new ApiError('COM-001', '이미 출고 확정된 출하요청이에요');
  if (request.shipmentRequestStatus === 'CANCELLED') inputError('shipmentRequestId', '취소된 출하요청이에요');
  const check = goodsIssueCheck(tx.tables, request.id);
  const first = check.problems[0];
  if (first) throw new ApiError(first.code, first.lotNo ? `${first.lotNo} · ${first.message}` : first.message);

  const lines = tx.tables.shipmentRequestItem.filter((l) => l.shipmentRequestId === request.id).sort((a, b) => a.lineNo - b.lineNo);
  const work = lines.map((line) => {
    const soItem = mustGet(tx.tables, 'salesOrderItem', line.salesOrderItemId, '수주 품목');
    const allocations = tx.tables.allocation.filter((a) => a.shipmentRequestItemId === line.id && a.allocationStatus === 'CONFIRMED');
    const lots = allocations.map((a) => mustGet(tx.tables, 'lot', a.lotId, 'LOT'));
    return { line, soItem, allocations, lots };
  });

  const issued = updateRow(tx, 'shipmentRequest', request.id, { shipmentRequestStatus: 'ISSUED', issuedAt: tx.nowIso, issuedEmployeeId: actor.employeeId }) ?? request;
  for (const { allocations, lots } of work) {
    for (const a of allocations) updateRow(tx, 'allocation', a.id, { allocationStatus: 'CONSUMED', consumedAt: tx.nowIso });
    for (const lot of lots) updateRow(tx, 'lot', lot.id, { lotStatus: 'SHIPPED', shippedAt: tx.nowIso });
  }

  const salesOrderIds = [...new Set(work.map((w) => w.soItem.salesOrderId))];
  for (const salesOrderId of salesOrderIds) {
    const salesOrderWork = work.filter((w) => w.soItem.salesOrderId === salesOrderId);
    const so = mustGet(tx.tables, 'salesOrder', salesOrderId, '수주');
    recordBusinessEvent(tx, {
      businessEventType: 'GOODS_ISSUE_CONFIRMED',
      actor,
      targetType: 'shipment_request',
      targetId: request.id,
      targetNo: request.shipmentRequestNo,
      salesOrderId,
      beforeData: { shipmentRequestStatus: request.shipmentRequestStatus },
      afterData: {
        shipmentRequestNo: request.shipmentRequestNo,
        salesOrderNo: so.salesOrderNo,
        shipmentRequestStatus: 'ISSUED',
        issuedAt: tx.nowIso,
        lines: salesOrderWork.map((w) => ({ salesOrderItemId: w.soItem.id, lineNo: w.soItem.lineNo, qty: w.lots.length, lotNos: w.lots.map((l) => l.lotNo) })),
      },
      lotIds: salesOrderWork.flatMap((w) => w.lots.map((l) => l.id)),
    });
  }

  for (const { soItem, lots } of work) {
    convertReservations(tx, actor, soItem.id, lots.length, lots.map((l) => l.id));
    const current = mustGet(tx.tables, 'salesOrderItem', soItem.id, '수주 품목');
    const shippedQty = current.shippedQty + lots.length;
    updateRow(tx, 'salesOrderItem', soItem.id, { shippedQty, salesOrderItemStatus: itemStatusOf({ orderedQty: current.orderedQty, shippedQty, cancelled: false }) });
    refreshInventory(tx, soItem.itemId);
  }

  const millSheets = salesOrderIds.map((salesOrderId) => {
    const salesOrderWork = work.filter((w) => w.soItem.salesOrderId === salesOrderId);
    const lines: { soItem: SalesOrderItemRow; lots: LotRow[] }[] = salesOrderWork.map((w) => ({ soItem: mustGet(tx.tables, 'salesOrderItem', w.soItem.id, '수주 품목'), lots: w.lots }));
    return createMillSheet(tx, { shipmentRequest: issued, salesOrderId, lines });
  });
  return { shipmentRequest: issued, issuedLotNos: work.flatMap((w) => w.lots.map((l) => l.lotNo)), millSheets };
}

/** 출고 확정 화면 목록: 배정 확정(출고 가능)·배정 대기 요청과 최근 출고 */
export function goodsIssueQueue(tables: Tables): { shipmentRequestId: number; shipmentRequestNo: string; shipmentRequestStatus: ShipmentRequestRow['shipmentRequestStatus']; ready: boolean; problems: GoodsIssueProblem[] }[] {
  return tables.shipmentRequest
    .filter((r) => r.shipmentRequestStatus !== 'CANCELLED')
    .sort((a, b) => {
      const rank = (s: string) => (s === 'ALLOCATED' ? 0 : s === 'REQUESTED' ? 1 : 2);
      return rank(a.shipmentRequestStatus) - rank(b.shipmentRequestStatus) || a.requestedShipDate.localeCompare(b.requestedShipDate) || b.id - a.id;
    })
    .map((r) => {
      const check = r.shipmentRequestStatus === 'ISSUED' ? { ready: false, problems: [] } : goodsIssueCheck(tables, r.id);
      return { shipmentRequestId: r.id, shipmentRequestNo: r.shipmentRequestNo, shipmentRequestStatus: r.shipmentRequestStatus, ...check };
    });
}
