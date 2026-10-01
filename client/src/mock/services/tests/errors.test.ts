// 9.3 에러 코드와 입력 오류 — 서비스가 던지는 모든 코드
import { describe, expect, it } from 'vitest';
import { updateRow } from '@/mock/store';
import {
  approvePurchaseRequisition,
  cancelSalesOrder,
  cancelShipmentRequest,
  confirmGoodsIssue,
  confirmShipmentAllocations,
  createPurchaseOrders,
  createPurchaseRequisition,
  createSalesOrder,
  createShipmentRequest,
  inspectionFormOf,
  openWorkRoom,
  registerInspection,
  registerIronmaking,
  rejectPurchaseRequisition,
  resubmitPurchaseRequisition,
  salesOrderDetail,
  shipmentRecommendation,
  simulatePlan,
} from '@/mock/services';
import { createKit, expectCode, expectInputError, stockRawMaterials } from '@/mock/services/tests/kit';

const at = '2026-10-01T09:00:00+09:00';

describe('수주 SO-001·002·003·004, COM-001·003, MST-001', () => {
  it('SO-001 등록되지 않은 규격(원료 품목·없는 품목), COM-003 없는 고객사', () => {
    const k = createKit();
    const base = { customerId: k.customerId('CUS-01'), items: [{ itemId: k.itemId('ORE01'), orderedQty: 1, dueDate: '2026-10-20' }] };
    expectCode(() => createSalesOrder(k.at(at), k.actor('sales'), base), 'SO-001');
    expectCode(() => createSalesOrder(k.at(at), k.actor('sales'), { ...base, items: [{ itemId: 99999, orderedQty: 1, dueDate: '2026-10-20' }] }), 'SO-001');
    expectCode(() => createSalesOrder(k.at(at), k.actor('sales'), { ...base, customerId: 999 }), 'COM-003');
  });

  it('SO-002 10.5매·0매·음수·누락·글자는 거부 (글자를 지우지 않는다)', () => {
    const k = createKit();
    const salesOrderCount = k.tables.salesOrder.length;
    for (const qty of ['10.5', 0, -1, '', '3매', ' ', '1e3']) {
      expectCode(() => createSalesOrder(k.at(at), k.actor('sales'), { customerId: k.customerId('CUS-01'), items: [{ itemId: k.itemId('SL-SS275-250x1200x10000'), orderedQty: qty, dueDate: '2026-10-20' }] }), 'SO-002');
    }
    expectInputError(() => createSalesOrder(k.at(at), k.actor('sales'), { customerId: k.customerId('CUS-01'), items: [{ itemId: k.itemId('SL-SS275-250x1200x10000'), orderedQty: 1, dueDate: '2026-13-01' }] }), 'items.0.dueDate');
    expectInputError(() => createSalesOrder(k.at(at), k.actor('sales'), { customerId: k.customerId('CUS-01'), items: [] }), 'items');
    expect(k.tables.salesOrder).toHaveLength(salesOrderCount);
  });

  it('SO-003 출고된 수주 취소 불가, SO-004 진행 중 출하요청 먼저 취소, COM-001 버전 충돌', () => {
    const k = createKit();
    const so1 = k.tables.salesOrder.find((s) => s.salesOrderNo === 'SO-2609-001');
    const so2 = k.tables.salesOrder.find((s) => s.salesOrderNo === 'SO-2609-002');
    expect(salesOrderDetail(k.tables, so1?.id ?? 0).cancelBlock).toBe('SO-003');
    expectCode(() => cancelSalesOrder(k.at(at), k.actor('sales'), { salesOrderId: so1?.id ?? 0, cancelReason: '취소' }), 'SO-003');
    expectCode(() => cancelSalesOrder(k.at(at), k.actor('sales'), { salesOrderId: so2?.id ?? 0, cancelReason: '취소' }), 'SO-004');
    const dr2 = k.tables.shipmentRequest.find((r) => r.shipmentRequestNo === 'DR-2609-0002');
    cancelShipmentRequest(k.at(at), k.actor('sales'), { shipmentRequestId: dr2?.id ?? 0 });
    expectCode(() => cancelSalesOrder(k.at(at), k.actor('sales'), { salesOrderId: so2?.id ?? 0, cancelReason: '취소', expectedUpdatedAt: '2026-01-01T00:00:00.000Z' }), 'COM-001');
    cancelSalesOrder(k.at(at), k.actor('sales'), { salesOrderId: so2?.id ?? 0, cancelReason: '취소' });
    k.expectClean();
  });

  it('MST-001: 라우팅 수율이 없으면 부족분 계획을 만들지 않는다 (수주 저장도 안 됨)', () => {
    const k = createKit();
    const salesOrderCount = k.tables.salesOrder.length;
    const routing = k.tables.routing.find((r) => r.itemType === 'SLAB' && r.processType === 'CONTINUOUS_CASTING');
    updateRow(k.at(at), 'routing', routing?.id ?? 0, { plannedYieldRate: null });
    expectCode(() => createSalesOrder(k.at(at), k.actor('sales'), { customerId: k.customerId('CUS-01'), items: [{ itemId: k.itemId('SL-SM355A-250x1200x10000'), orderedQty: 1, dueDate: '2026-10-20' }] }), 'MST-001');
    expect(k.tables.salesOrder).toHaveLength(salesOrderCount);
  });

  it('MST-001: 검사 기준이 없으면 검사 입력 불가', () => {
    const k = createKit();
    const pending = k.tables.lot.find((l) => l.lotType === 'HEAT' && l.isPassed === null);
    k.tables.qualityInspection.splice(0, k.tables.qualityInspection.length, ...k.tables.qualityInspection.filter((q) => q.lotId !== pending?.id));
    for (const s of k.tables.inspectionStandard) s.isCurrent = false;
    expect(inspectionFormOf(k.tables, pending?.id ?? 0).items).toEqual([]);
    expectCode(() => registerInspection(k.at(at), k.actor('quality'), { lotId: pending?.id ?? 0, values: [] }), 'MST-001');
  });
});

describe('구매 PUR-001·002·003, COM-002, 반려 후 재요청', () => {
  it('PUR-001 요청자 부서에 부서장이 없으면 등록 불가', () => {
    const k = createKit();
    const purchase = k.actor('purchase');
    const department = k.tables.employee.find((e) => e.id === purchase.employeeId)?.departmentId;
    updateRow(k.at(at), 'department', department ?? 0, { headEmployeeId: null });
    expectCode(() => createPurchaseRequisition(k.at(at), purchase, { items: [{ itemId: k.itemId('ORE01'), requiredTon: '10' }] }), 'PUR-001');
  });

  it('PUR-002 승인 대기 요청은 발주 불가, 반려 → 요청자 수정·재요청 → 승인 → 발주', () => {
    const k = createKit();
    const waiting = k.tables.purchaseRequisition.find((p) => p.purchaseRequisitionStatus === 'WAITING_APPROVAL');
    if (!waiting) throw new Error('승인 대기 없음');
    const items = k.tables.purchaseRequisitionItem.filter((i) => i.purchaseRequisitionId === waiting.id);
    expectCode(() => createPurchaseOrders(k.at(at), k.actor('purchase'), { purchaseRequisitionItemIds: items.map((i) => i.id) }), 'PUR-002');
    expectInputError(() => rejectPurchaseRequisition(k.at(at), k.actor('purchaseHead'), { purchaseRequisitionId: waiting.id, rejectReason: '' }), 'rejectReason');
    expectCode(() => rejectPurchaseRequisition(k.at(at), k.actor('productionHead'), { purchaseRequisitionId: waiting.id, rejectReason: '수량 과다' }), 'COM-002');
    rejectPurchaseRequisition(k.at(at), k.actor('purchaseHead'), { purchaseRequisitionId: waiting.id, rejectReason: '수량 과다' });
    expect(k.tables.notification.some((n) => n.notificationType === 'APPROVAL_RESULT' && n.recipientId === waiting.requesterId && n.body?.includes('수량 과다'))).toBe(true);
    expectCode(() => createPurchaseOrders(k.at(at), k.actor('purchase'), { purchaseRequisitionItemIds: items.map((i) => i.id) }), 'PUR-002');
    expectCode(
      () => resubmitPurchaseRequisition(k.at(at), k.actor('purchaseHead'), { purchaseRequisitionId: waiting.id, items: [{ itemId: k.itemId('LIM01'), requiredTon: '50' }] }),
      'COM-002',
    );
    const resubmitted = resubmitPurchaseRequisition(k.at('2026-10-01T10:00:00+09:00'), k.actor('purchase'), {
      purchaseRequisitionId: waiting.id,
      requestReason: '수량 조정',
      items: [{ itemId: k.itemId('LIM01'), requiredTon: '50' }],
    });
    expect(resubmitted).toMatchObject({ purchaseRequisitionStatus: 'WAITING_APPROVAL', rejectReason: null });
    expect(k.tables.purchaseRequisitionItem.filter((i) => i.purchaseRequisitionId === waiting.id).map((i) => i.requiredTon)).toEqual(['50.000']);
    expectInputError(() => resubmitPurchaseRequisition(k.at(at), k.actor('purchase'), { purchaseRequisitionId: waiting.id, items: [{ itemId: k.itemId('LIM01'), requiredTon: '50' }] }));
    approvePurchaseRequisition(k.at('2026-10-01T11:00:00+09:00'), k.actor('purchaseHead'), { purchaseRequisitionId: waiting.id });
    const newItems = k.tables.purchaseRequisitionItem.filter((i) => i.purchaseRequisitionId === waiting.id);
    const [po] = createPurchaseOrders(k.at('2026-10-01T12:00:00+09:00'), k.actor('purchase'), { purchaseRequisitionItemIds: newItems.map((i) => i.id) });
    expect(po.purchaseOrderStatus).toBe('CONFIRMED');
    expectInputError(() => createPurchaseOrders(k.at(at), k.actor('purchase'), { purchaseRequisitionItemIds: newItems.map((i) => i.id) }));
    k.expectClean();
  });

  it('발주는 기본 공급업체마다 1건 (여러 원료를 한 번에 → 공급업체 수만큼)', () => {
    const k = createKit();
    const approved = k.tables.purchaseRequisition.find((p) => p.purchaseRequisitionStatus === 'APPROVED');
    const { items } = createPurchaseRequisition(k.at(at), k.actor('purchase'), { items: [{ itemId: k.itemId('ORE01'), requiredTon: '10' }, { itemId: k.itemId('COL01'), requiredTon: '5' }] });
    approvePurchaseRequisition(k.at(at), k.actor('purchaseHead'), { purchaseRequisitionId: items[0].purchaseRequisitionId });
    const approvedItems = k.tables.purchaseRequisitionItem.filter((i) => i.purchaseRequisitionId === approved?.id);
    const orders = createPurchaseOrders(k.at(at), k.actor('purchase'), { purchaseRequisitionItemIds: [...approvedItems, ...items].map((i) => i.id) });
    // 철광석 2줄(두 요청)은 가온광업 발주 1건, 석탄은 누리에너지 1건
    expect(orders).toHaveLength(2);
    expect(orders.map((o) => k.tables.purchaseOrderItem.filter((l) => l.purchaseOrderId === o.id).length).sort()).toEqual([1, 2]);
  });
});

describe('출하 SHP-002·003, 배정 INV-001~004', () => {
  it('SHP-003 출고 확정된 출하요청 취소 불가, 취소하면 배정만 풀고 예약은 ACTIVE', () => {
    const k = createKit();
    const issued = k.tables.shipmentRequest.find((r) => r.shipmentRequestStatus === 'ISSUED');
    expectCode(() => cancelShipmentRequest(k.at(at), k.actor('sales'), { shipmentRequestId: issued?.id ?? 0 }), 'SHP-003');
    const waiting = k.tables.shipmentRequest.find((r) => r.shipmentRequestNo === 'DR-2609-0002');
    const [line] = shipmentRecommendation(k.tables, waiting?.id ?? 0);
    confirmShipmentAllocations(k.at(at), k.actor('sales'), { shipmentRequestId: waiting?.id ?? 0, lines: [{ shipmentRequestItemId: line.shipmentRequestItemId, lotIds: line.recommendedLots.map((l) => l.lotId) }] });
    const activeBefore = k.tables.reservation.filter((r) => r.reservationStatus === 'ACTIVE').reduce((s, r) => s + r.reservedQty, 0);
    cancelShipmentRequest(k.at(at), k.actor('sales'), { shipmentRequestId: waiting?.id ?? 0 });
    expect(k.tables.allocation.filter((a) => a.shipmentRequestItemId === line.shipmentRequestItemId).every((a) => a.allocationStatus === 'RELEASED')).toBe(true);
    expect(k.tables.reservation.filter((r) => r.reservationStatus === 'ACTIVE').reduce((s, r) => s + r.reservedQty, 0)).toBe(activeBefore);
    k.expectClean();
  });

  it('SHP-002 출하 가능 매수 초과·다른 고객사 품목, INV-001~004', () => {
    const k = createKit();
    const so2 = k.tables.salesOrder.find((s) => s.salesOrderNo === 'SO-2609-002');
    const so2Item = k.tables.salesOrderItem.find((i) => i.salesOrderId === so2?.id);
    // ACTIVE 12 − 진행 중 요청 6 = 6
    expectCode(() => createShipmentRequest(k.at(at), k.actor('sales'), { customerId: k.customerId('CUS-02'), requestedShipDate: '2026-10-10', items: [{ salesOrderItemId: so2Item?.id ?? 0, requestQty: 7 }] }), 'SHP-002');
    expectInputError(() => createShipmentRequest(k.at(at), k.actor('sales'), { customerId: k.customerId('CUS-01'), requestedShipDate: '2026-10-10', items: [{ salesOrderItemId: so2Item?.id ?? 0, requestQty: 1 }] }));
    expectCode(() => createShipmentRequest(k.at(at), k.actor('sales'), { customerId: k.customerId('CUS-02'), requestedShipDate: '2026-10-10', items: [{ salesOrderItemId: so2Item?.id ?? 0, requestQty: '2.5' }] }), 'SO-002');
    const request = k.tables.shipmentRequest.find((r) => r.shipmentRequestNo === 'DR-2609-0002');
    const [line] = shipmentRecommendation(k.tables, request?.id ?? 0);
    const lots = line.candidateLots;
    const confirm = (lotIds: number[]) => confirmShipmentAllocations(k.at(at), k.actor('sales'), { shipmentRequestId: request?.id ?? 0, lines: [{ shipmentRequestItemId: line.shipmentRequestItemId, lotIds }] });
    expectCode(() => confirm(lots.slice(0, 7).map((l) => l.lotId)), 'INV-001');
    const failed = k.tables.lot.find((l) => l.itemId === so2Item?.itemId && l.isPassed === false);
    expectCode(() => confirm([failed?.id ?? 0]), 'INV-002');
    const shipped = k.tables.lot.find((l) => l.lotStatus === 'SHIPPED');
    expectInputError(() => confirm([shipped?.id ?? 0]), 'lotIds'); // 다른 규격
    confirm([lots[0].lotId]);
    expectCode(() => confirm([lots[0].lotId]), 'INV-003');
    // 같은 규격의 출고된 LOT 흉내: 상태만 SHIPPED로 바꾼 LOT
    updateRow(k.at(at), 'lot', lots[1].lotId, { lotStatus: 'SHIPPED' });
    expectCode(() => confirm([lots[1].lotId]), 'INV-004');
  });

  it('출고 확정 재검증: 배정 대기 INV-001, 미합격 LOT INV-002', () => {
    const k = createKit();
    const request = k.tables.shipmentRequest.find((r) => r.shipmentRequestNo === 'DR-2609-0002');
    expectCode(() => confirmGoodsIssue(k.at(at), k.actor('logistics'), { shipmentRequestId: request?.id ?? 0 }), 'INV-001');
    const [line] = shipmentRecommendation(k.tables, request?.id ?? 0);
    confirmShipmentAllocations(k.at(at), k.actor('sales'), { shipmentRequestId: request?.id ?? 0, lines: [{ shipmentRequestItemId: line.shipmentRequestItemId, lotIds: line.recommendedLots.map((l) => l.lotId) }] });
    // 배정 뒤 데이터가 어긋난 상황(판정 취소)을 흉내 낸다
    updateRow(k.at(at), 'lot', line.recommendedLots[0].lotId, { isPassed: null });
    expectCode(() => confirmGoodsIssue(k.at(at), k.actor('logistics'), { shipmentRequestId: request?.id ?? 0 }), 'INV-002');
  });
});

describe('작업 실적·시뮬레이션·업무방', () => {
  it('원료 FIFO 차감은 음수 잔량을 만들지 않는다 (모자라면 입력 오류, 아무것도 바뀌지 않음)', () => {
    const k = createKit();
    const plan = k.tables.productionPlan.find((p) => p.productionPlanNo === 'PP-2609-0004');
    const before = JSON.stringify(k.tables.lot);
    expectInputError(() =>
      registerIronmaking(k.at(at), k.actor('ironmakingHead'), { productionPlanId: plan?.id ?? 0, blastFurnaceCode: 'BF2', startedAt: '2026-10-01T05:00:00+09:00', completedAt: '2026-10-01T08:00:00+09:00', outputTon: '1000' }),
    );
    expect(JSON.stringify(k.tables.lot)).toBe(before);
    expectInputError(() => registerIronmaking(k.at(at), k.actor('ironmakingHead'), { productionPlanId: plan?.id ?? 0, blastFurnaceCode: 'bf', startedAt: 'x', completedAt: '2026-10-01T08:00:00+09:00', outputTon: '-1' }));
  });

  it('실적 시뮬레이션은 같은 난수 시드면 같은 결과를 낸다 (손실 매수 = floor(계획 매수 × 샘플 손실률))', () => {
    const run = (seed: number) => {
      const k = createKit();
      stockRawMaterials(k, '2026-10-01T08:00:00+09:00', { ORE01: '9000', COL01: '4000', LIM01: '1000', SMN01: '200' });
      const so = createSalesOrder(k.at(at), k.actor('sales'), { customerId: k.customerId('CUS-03'), items: [{ itemId: k.itemId('SL-SM355B-250x1500x10000'), orderedQty: 40, dueDate: '2026-11-20' }] });
      const plan = so.productionPlans[0];
      expect(plan.heatCount).toBe(5);
      const result = simulatePlan(k.at('2026-10-02T18:00:00+09:00'), k.actor('steelmaking'), { productionPlanId: plan.id, randomSeed: seed });
      const castings = result.steps.filter((s) => s.processType === 'CONTINUOUS_CASTING');
      for (const c of castings) expect(c.lossQty).toBe(Math.floor((c.plannedQty ?? 0) * Number(c.sampleLossRate)));
      const stored = k.tables.productionResult.filter((r) => r.productionPlanId === plan.id && r.processType === 'CONTINUOUS_CASTING');
      expect(stored.every((r) => r.isSimulated && r.randomSeed === seed && r.sampleLossRate !== null && r.lossQty !== null)).toBe(true);
      k.expectClean();
      return castings.map((c) => [c.sampleLossRate, c.lossQty, c.outputQty]);
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });

  it('업무방: 수주당 1개, 멤버는 조직도에서, 시스템 메시지로 알린다', () => {
    const k = createKit();
    const so = k.tables.salesOrder.find((s) => s.salesOrderNo === 'SO-2609-001');
    const first = openWorkRoom(k.at(at), k.actor('sales'), { salesOrderId: so?.id ?? 0, memberEmployeeIds: [k.actor('logistics').employeeId] });
    expect(first.created).toBe(true);
    expect(first.chatRoom).toMatchObject({ chatRoomType: 'WORK', salesOrderId: so?.id, chatRoomName: 'SO-2609-001 가람중공업' });
    expect(k.tables.chatRoomMember.filter((m) => m.chatRoomId === first.chatRoom.id)).toHaveLength(2);
    expect(k.tables.message.find((m) => m.chatRoomId === first.chatRoom.id)?.senderId).toBe(0);
    const again = openWorkRoom(k.at(at), k.actor('salesHead'), { salesOrderId: so?.id ?? 0, memberEmployeeIds: [] });
    expect(again).toMatchObject({ created: false, chatRoom: { id: first.chatRoom.id } });
    expect(k.tables.chatRoomMember.filter((m) => m.chatRoomId === first.chatRoom.id)).toHaveLength(3);
    expectCode(() => openWorkRoom(k.at(at), k.actor('sales'), { salesOrderId: so?.id ?? 0, memberEmployeeIds: [9999] }), 'COM-003');
  });
});
