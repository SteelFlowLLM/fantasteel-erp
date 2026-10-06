// 업무 프로세스 14.1 P1 슬래브 수주 전체 흐름 (1~10단계) — 새 시드 위에서 서비스를 차례로 부른다.
import { describe, expect, it } from 'vitest';
import { calcWeightTon } from '@/lib/weight';
import {
  approvePurchaseRequisition,
  computeMrp,
  confirmDraft,
  confirmGoodsIssue,
  confirmShipmentAllocations,
  createDraftFromMessage,
  createPurchaseOrders,
  createPurchaseRequisition,
  createReproductionPlan,
  createSalesOrder,
  createShipmentRequest,
  executeDraft,
  fulfillmentOf,
  itemShortageOf,
  listSalesOrders,
  markMillSheetPdfGenerated,
  millSheetDetail,
  productionPlanView,
  receiveGoods,
  registerInspection,
  salesOrderTimeline,
  simulatePlan,
  updateDraft,
  inspectionFormOf,
} from '@/mock/services';
import { createKit, expectCode, expectInputError } from '@/mock/services/tests/kit';

const k = createKit();
const t = k.tables;
const SS275_SLAB_A = 'SL-SS275-250x1200x10000';

describe('14.1 P1 슬래브 수주 전체 흐름', () => {
  let soItemId = 0;
  let salesOrderId = 0;
  let planId = 0;
  let newSmnLotId = 0;
  const shipmentRequestIds: number[] = [];

  it('시작: SS275 250×1,200×10,000 합격 가용 6매, 1매 23.550t, 10매 235.500t', () => {
    const item = t.item.find((i) => i.itemCode === SS275_SLAB_A);
    expect(item?.theoreticalWeightTon).toBe('23.550');
    expect(calcWeightTon(10, '23.550')).toBe('235.500');
    const inventory = t.inventory.find((i) => i.itemId === item?.id);
    expect(inventory).toMatchObject({ onHandQty: 6, reservedQty: 0 });
  });

  it('1. 10매 수주 → 6매 ACTIVE 예약(STOCK_FIRST·SYSTEM) + 부족 4매 생산계획', () => {
    const result = createSalesOrder(k.at('2026-10-01T09:00:00+09:00'), k.actor('sales'), {
      customerId: k.customerId('CUS-01'),
      items: [{ itemId: k.itemId(SS275_SLAB_A), orderedQty: 10, dueDate: '2026-10-20' }],
    });
    salesOrderId = result.salesOrder.id;
    soItemId = result.items[0].id;
    expect(result.salesOrder.salesOrderNo).toBe('SO-2610-001');
    expect(Object.keys(result.items[0])).not.toContain('orderedTon');
    expect(result.reservations.map((r) => [r.reservedQty, r.reservationStatus])).toEqual([[6, 'ACTIVE']]);
    expect(result.productionPlans).toHaveLength(1);
    planId = result.productionPlans[0].id;
    expect(result.productionPlans[0]).toMatchObject({ productionPlanNo: 'PP-2610-0001', shortageQty: 4, heatCount: 1, cumulativeYieldRate: '0.9800', requiredSteelTon: '96.122', productionPlanStatus: 'PLANNED' });
    const events = salesOrderTimeline(t, salesOrderId);
    expect(events.find((e) => e.businessEventType === 'RESERVATION_CREATED')).toMatchObject({ actorType: 'SYSTEM', reasonCode: 'STOCK_FIRST' });
    expect(events.find((e) => e.businessEventType === 'PRODUCTION_PLAN_CREATED')).toMatchObject({ reasonCode: 'ORDER_SHORTAGE' });
    const fulfillment = fulfillmentOf(t, result.items[0]);
    expect(fulfillment).toMatchObject({ orderedTon: '235.500', activeReservedQty: 6, plannedQty: 4 });
    expect(fulfillment.shortage).toMatchObject({ unshippedQty: 10, unsecuredQty: 4, additionalPlanQty: 0, reproductionNeedQty: 0 });
    k.expectClean();
  });

  it('2. 히트 편성: 히트 전체 톤 250t와 수주 목표 94.200t를 나눠 보이고 예상 여재 6매', () => {
    const view = productionPlanView(t, planId);
    expect(view.formation).toMatchObject({ targetWeightTon: '94.200', heatTon: '250.000', heatCapacityTon: '250.000', slabQtyPerHeat: 10, plannedSlabQty: 10, expectedSurplusSlabQty: 6 });
    expect(view.heats).toHaveLength(1);
    expect(view.canCancel).toBe(true);
  });

  it('3. MRP: 합금철만 부족 → 구매요청 → 부서장 승인 → 공급업체별 발주 → 부분 입고 → 원료 LOT', () => {
    const mrp = computeMrp(t, { from: '2026-10-01', to: '2026-10-31' });
    expect(mrp.plans.map((p) => [p.productionPlanNo, p.remainingHeatCount, p.heatTon, p.requiredHotMetalTon])).toEqual([['PP-2610-0001', 1, '250.000', '277.778']]);
    const byCode = Object.fromEntries(mrp.materials.map((m) => [m.itemCode, m]));
    expect([byCode.ORE01.grossTon, byCode.ORE01.netTon]).toEqual(['444.445', '0.000']);
    expect([byCode.COL01.grossTon, byCode.COL01.netTon]).toEqual(['166.667', '0.000']);
    expect([byCode.LIM01.grossTon, byCode.LIM01.netTon]).toEqual(['41.667', '0.000']);
    expect([byCode.SMN01.grossTon, byCode.SMN01.onHandTon, byCode.SMN01.netTon]).toEqual(['2.500', '1.000', '1.500']);
    expect(byCode.SMN01.scheduledReceiptTon).toBe('3.500'); // 10-28 도착 예정이라 10-20 필요일에는 못 씀
    expect(mrp.requisitionLines).toEqual([expect.objectContaining({ productionPlanId: planId, itemCode: 'SMN01', netTon: '1.500', needDate: '2026-10-20', existingPurchaseRequisitionNo: null })]);

    const line = mrp.requisitionLines[0];
    const purchase = k.actor('purchase');
    const pr = createPurchaseRequisition(k.at('2026-10-01T10:00:00+09:00'), purchase, {
      itemId: line.itemId,
      requestedTon: line.netTon,
      desiredReceiptDate: '2026-10-10',
      requestReason: 'MRP 합금철 부족',
      productionPlanId: line.productionPlanId,
    });
    expect(pr).toMatchObject({ purchaseRequisitionNo: 'PR-2610-0001', purchaseRequisitionStatus: 'WAITING_APPROVAL' });
    const head = k.actor('purchaseHead');
    expect(t.notification.filter((n) => n.notificationType === 'APPROVAL_REQUESTED' && n.recipientId === head.employeeId).length).toBeGreaterThan(0);
    // 같은 계획·원료는 두 번 만들지 않는다
    expectInputError(() => createPurchaseRequisition(k.at('2026-10-01T10:05:00+09:00'), purchase, { itemId: line.itemId, requestedTon: '1.000', desiredReceiptDate: '2026-10-10', productionPlanId: planId }));
    expect(computeMrp(t, { from: '2026-10-01', to: '2026-10-31' }).requisitionLines[0].existingPurchaseRequisitionNo).toBe('PR-2610-0001');
    // 승인 전 발주 불가
    expectCode(() => createPurchaseOrders(k.at('2026-10-01T10:10:00+09:00'), purchase, { purchaseRequisitionIds: [pr.id] }), 'PUR-002');
    // 요청자 소속 부서의 부서장만 승인
    expectCode(() => approvePurchaseRequisition(k.at('2026-10-01T10:20:00+09:00'), k.actor('salesHead'), { purchaseRequisitionId: pr.id }), 'COM-002');
    approvePurchaseRequisition(k.at('2026-10-01T10:30:00+09:00'), head, { purchaseRequisitionId: pr.id });
    expect(t.notification.some((n) => n.notificationType === 'APPROVAL_RESULT' && n.recipientId === purchase.employeeId && n.title.includes('PR-2610-0001'))).toBe(true);
    const [po] = createPurchaseOrders(k.at('2026-10-01T11:00:00+09:00'), purchase, { purchaseRequisitionIds: [pr.id] });
    expect(po).toMatchObject({ purchaseOrderNo: 'PO-2610-0001', purchaseOrderStatus: 'CONFIRMED', dueDate: '2026-10-10' });
    expect(t.supplier.find((s) => s.id === po.supplierId)?.supplierCode).toBe('SUP-04');
    expect(t.purchaseRequisition.find((p) => p.id === pr.id)?.purchaseRequisitionStatus).toBe('ORDERED');
    // 입고예정이 필요일 전에 오면 순소요가 0이 된다
    expect(computeMrp(t, { from: '2026-10-01', to: '2026-10-31' }).materials.find((m) => m.itemCode === 'SMN01')?.netTon).toBe('0.000');

    const poLine = t.purchaseOrderItem.find((l) => l.purchaseOrderId === po.id);
    if (!poLine) throw new Error('발주 품목 없음');
    expectCode(() => receiveGoods(k.at('2026-10-02T09:00:00+09:00'), purchase, { purchaseOrderItemId: poLine.id, receivedTon: '1.501', receiptDate: '2026-10-02' }), 'PUR-003');
    const first = receiveGoods(k.at('2026-10-02T09:00:00+09:00'), purchase, { purchaseOrderItemId: poLine.id, receivedTon: '1.000', receiptDate: '2026-10-02' });
    newSmnLotId = first.lot.id;
    expect(first.lot).toMatchObject({ lotNo: 'RM-SMN01-261002-001', lotType: 'RAW_MATERIAL', remainingTon: '1.000', producedDate: '2026-10-02' });
    expect(first.purchaseOrder.purchaseOrderStatus).toBe('PARTIALLY_RECEIVED');
    expect(t.purchaseOrderItem.find((l) => l.id === poLine.id)).toMatchObject({ receivedTon: '1.000', scheduledReceiptTon: '0.500' });
    const second = receiveGoods(k.at('2026-10-03T08:00:00+09:00'), purchase, { purchaseOrderItemId: poLine.id, receivedTon: '0.500', receiptDate: '2026-10-03' });
    expect(second.purchaseOrder.purchaseOrderStatus).toBe('RECEIVED');
    expect(t.yard.find((y) => y.id === first.goodsReceipt.yardId)?.yardType).toBe('RAW_MATERIAL');
    k.expectClean();
  });

  it('4. 실적 시뮬레이션: 제선·제강·연주 실적과 LOT 관계(기간 기반·실제 투입)', () => {
    const result = simulatePlan(k.at('2026-10-03T18:00:00+09:00'), k.actor('steelmaking'), { productionPlanId: planId, randomSeed: 42 });
    expect(result.randomSeed).toBe(42);
    expect(result.steps.map((s) => s.processType)).toEqual(['IRONMAKING', 'STEELMAKING', 'CONTINUOUS_CASTING']);
    const casting = result.steps[2];
    expect(casting.plannedQty).toBe(10);
    expect(casting.lossQty).toBe(Math.floor(10 * Number(casting.sampleLossRate)));
    expect(casting.outputQty).toBe(10 - (casting.lossQty ?? 0));
    const heat = k.lot('HT-BOF1-261003-001');
    const hotMetal = t.lot.find((l) => l.lotType === 'HOT_METAL' && l.productionPlanId === planId);
    expect(hotMetal?.lotNo).toBe('HM-BF2-261003-01');
    const rawToHm = t.lotRelation.filter((r) => r.childLotId === hotMetal?.id);
    expect(rawToHm.every((r) => r.lotRelationEvidence === 'PERIOD_BASED' && r.periodStartedAt !== null && r.periodEndedAt !== null && r.inputTon !== null)).toBe(true);
    expect(new Set(rawToHm.map((r) => t.lot.find((l) => l.id === r.parentLotId)?.itemId))).toEqual(new Set([k.itemId('ORE01'), k.itemId('COL01'), k.itemId('LIM01')]));
    const intoHeat = t.lotRelation.filter((r) => r.childLotId === heat.id);
    expect(intoHeat.every((r) => r.lotRelationEvidence === 'ACTUAL_INPUT')).toBe(true);
    const alloyInputs = intoHeat.filter((r) => t.lot.find((l) => l.id === r.parentLotId)?.itemId === k.itemId('SMN01'));
    expect(alloyInputs.map((r) => r.inputTon)).toEqual(['1.000', '1.000', '0.500']); // 입고일 FIFO: 09-16 → 10-02 → 10-03
    expect(t.lotRelation.filter((r) => r.parentLotId === heat.id)).toHaveLength(casting.outputQty ?? 0);
    expect(k.lotsOfPlan(planId, 'SLAB')[0].lotNo).toBe('HT-BOF1-261003-001-01');
    expect(t.productionResult.filter((r) => r.productionPlanId === planId).every((r) => r.isSimulated && r.randomSeed === 42 && r.completedAt !== null)).toBe(true);
    expect(t.productionPlan.find((p) => p.id === planId)?.productionPlanStatus).toBe('COMPLETED');
    k.expectClean();
  });

  it('5. 검사 자동 판정 → 합격 생산분은 원래 수주에 자동 예약, 남는 합격 슬래브는 여재', () => {
    const slabs = k.lotsOfPlan(planId, 'SLAB');
    k.inspect('2026-10-04T09:00:00+09:00', slabs[0].id, { SURFACE_DEFECT_DEPTH: '2.10' });
    expect(t.lot.find((l) => l.id === slabs[0].id)?.isPassed).toBe(false);
    for (const slab of slabs.slice(1)) k.inspect('2026-10-04T09:10:00+09:00', slab.id);
    // 히트가 아직 판정 대기라 예약 없음
    expect(itemShortageOf(t, t.salesOrderItem.find((i) => i.id === soItemId) ?? t.salesOrderItem[0]).activeReservedQty).toBe(6);
    const result = k.inspect('2026-10-04T10:00:00+09:00', k.lot('HT-BOF1-261003-001').id, { C: '0.21', SI: '0.25', MN: '1.10', P: '0.025', S: '0.010' });
    expect(result.autoReservedQty).toBe(4);
    expect(result.surplusLotNos).toHaveLength(slabs.length - 1 - 4);
    const auto = salesOrderTimeline(t, salesOrderId).filter((e) => e.businessEventType === 'RESERVATION_CREATED');
    expect(auto.map((e) => e.actorType)).toEqual(['SYSTEM', 'SYSTEM']);
    const soItem = t.salesOrderItem.find((i) => i.id === soItemId);
    if (!soItem) throw new Error('수주 품목 없음');
    expect(itemShortageOf(t, soItem)).toMatchObject({ activeReservedQty: 10, unsecuredQty: 0, reproductionNeedQty: 0 });
    // 같은 히트 합격 슬래브가 하나 더 떨어져도 여재가 채운다 (예약 그대로)
    k.inspect('2026-10-04T11:00:00+09:00', slabs[slabs.length - 1].id, { SURFACE_DEFECT_DEPTH: '2.50' });
    expect(itemShortageOf(t, soItem).activeReservedQty).toBe(10);
    k.expectClean();
  });

  it('6. 여재·진행 계획으로 충분하면 재생산 계획을 만들지 않는다', () => {
    expectInputError(() => createReproductionPlan(k.at('2026-10-04T12:00:00+09:00'), k.actor('productionHead'), { salesOrderItemId: soItemId }));
    expect(t.productionPlan.filter((p) => p.isReproduction)).toHaveLength(0);
  });

  it('7. 출하요청 LOT 10개를 FIFO(생산완료일 → LOT 번호)로 추천·확정', () => {
    const sales = k.actor('sales');
    const first = createShipmentRequest(k.at('2026-10-05T09:00:00+09:00'), sales, { customerId: k.customerId('CUS-01'), requestedShipDate: '2026-10-06', items: [{ salesOrderItemId: soItemId, requestQty: 4 }] });
    expect(first.recommendation[0].recommendedLots.map((l) => l.lotNo)).toEqual(['HT-BOF1-260905-001-05', 'HT-BOF1-260905-001-06', 'HT-BOF1-260905-001-07', 'HT-BOF1-260905-001-08']);
    confirmShipmentAllocations(k.at('2026-10-05T09:05:00+09:00'), sales, {
      shipmentRequestId: first.shipmentRequest.id,
      lines: [{ shipmentRequestItemId: first.items[0].id, lotIds: first.recommendation[0].recommendedLots.map((l) => l.lotId) }],
    });
    expectCode(() => createShipmentRequest(k.at('2026-10-05T09:10:00+09:00'), sales, { customerId: k.customerId('CUS-01'), requestedShipDate: '2026-10-08', items: [{ salesOrderItemId: soItemId, requestQty: 7 }] }), 'SHP-002');
    const second = createShipmentRequest(k.at('2026-10-05T09:20:00+09:00'), sales, { customerId: k.customerId('CUS-01'), requestedShipDate: '2026-10-08', items: [{ salesOrderItemId: soItemId, requestQty: 6 }] });
    expect(second.recommendation[0].recommendedLots.map((l) => l.lotNo)).toEqual([
      'HT-BOF1-260905-001-09',
      'HT-BOF1-260905-001-10',
      'HT-BOF1-261003-001-02',
      'HT-BOF1-261003-001-03',
      'HT-BOF1-261003-001-04',
      'HT-BOF1-261003-001-05',
    ]);
    confirmShipmentAllocations(k.at('2026-10-05T09:25:00+09:00'), sales, {
      shipmentRequestId: second.shipmentRequest.id,
      lines: [{ shipmentRequestItemId: second.items[0].id, lotIds: second.recommendation[0].recommendedLots.map((l) => l.lotId) }],
    });
    shipmentRequestIds.push(first.shipmentRequest.id, second.shipmentRequest.id);
    expect(t.shipmentRequest.filter((r) => shipmentRequestIds.includes(r.id)).map((r) => r.shipmentRequestStatus)).toEqual(['ALLOCATED', 'ALLOCATED']);
    const recommended = salesOrderTimeline(t, salesOrderId).filter((e) => e.businessEventType === 'ALLOCATION_RECOMMENDED');
    expect(recommended.map((e) => e.reasonCode)).toEqual(['FIFO_RECOMMENDATION', 'FIFO_RECOMMENDATION']);
    expect(salesOrderTimeline(t, salesOrderId).filter((e) => e.businessEventType === 'ALLOCATION_CONFIRMED')).toHaveLength(10);
    k.expectClean();
  });

  it('8. 4매 부분 출고 → CONVERTED 4·ACTIVE 6·부분출하, 나머지 6매 → 전량 전환·출하완료', () => {
    const logistics = k.actor('logistics');
    confirmGoodsIssue(k.at('2026-10-06T10:00:00+09:00'), logistics, { shipmentRequestId: shipmentRequestIds[0] });
    const rows = () => t.reservation.filter((r) => r.salesOrderItemId === soItemId);
    const sum = (status: string) => rows().filter((r) => r.reservationStatus === status).reduce((s, r) => s + r.reservedQty, 0);
    expect([sum('CONVERTED'), sum('ACTIVE')]).toEqual([4, 6]);
    expect(t.salesOrderItem.find((i) => i.id === soItemId)).toMatchObject({ shippedQty: 4, salesOrderItemStatus: 'PARTIALLY_SHIPPED' });
    expect(listSalesOrders(t, { today: '2026-10-06' }).find((s) => s.id === salesOrderId)?.status).toBe('PARTIALLY_SHIPPED');
    expectCode(() => confirmGoodsIssue(k.at('2026-10-06T10:05:00+09:00'), logistics, { shipmentRequestId: shipmentRequestIds[0] }), 'COM-001');
    confirmGoodsIssue(k.at('2026-10-08T10:00:00+09:00'), logistics, { shipmentRequestId: shipmentRequestIds[1] });
    expect([sum('CONVERTED'), sum('ACTIVE')]).toEqual([10, 0]);
    expect(t.salesOrderItem.find((i) => i.id === soItemId)).toMatchObject({ shippedQty: 10, salesOrderItemStatus: 'SHIPPED' });
    expect(listSalesOrders(t, { today: '2026-10-08' }).find((s) => s.id === salesOrderId)?.status).toBe('SHIPPED');
    const shippedLots = t.allocation.filter((a) => a.salesOrderItemId === soItemId).map((a) => t.lot.find((l) => l.id === a.lotId));
    expect(shippedLots.every((l) => l?.lotStatus === 'SHIPPED')).toBe(true);
    expect(t.allocation.filter((a) => a.salesOrderItemId === soItemId).every((a) => a.allocationStatus === 'CONSUMED')).toBe(true);
    k.expectClean();
  });

  it('9. 출고별 밀시트 스냅샷: 기존 재고와 새 생산분의 서로 다른 히트 성분값', () => {
    const sheets = t.millSheet.filter((m) => shipmentRequestIds.includes(m.shipmentRequestId)).sort((a, b) => a.id - b.id);
    expect(sheets.map((m) => m.millSheetNo)).toEqual(['MS-2610-0001-1', 'MS-2610-0002-1']);
    const [a, b] = sheets.map((m) => millSheetDetail(t, m.id).snapshot);
    expect(a.heats.map((h) => h.heatNo)).toEqual(['HT-BOF1-260905-001']);
    expect(b.heats.map((h) => h.heatNo)).toEqual(['HT-BOF1-260905-001', 'HT-BOF1-261003-001']);
    const carbonOf = (heatNo: string) => b.heats.find((h) => h.heatNo === heatNo)?.inspection?.values.find((v) => v.inspectionItemCode === 'C')?.measuredValue;
    expect(carbonOf('HT-BOF1-260905-001')).toBe('0.18');
    expect(carbonOf('HT-BOF1-261003-001')).toBe('0.21');
    expect(b.items[0].lots).toHaveLength(6);
    expect(b.items[0].lots.every((l) => l.productInspection?.inspectionResult === 'PASS')).toBe(true);
    expect(b).toMatchObject({ customer: { customerCode: 'CUS-01' }, totalQty: 6, totalWeightTon: '141.300' });
    expect(b.items[0]).toMatchObject({ standardNo: 'KS D 3503:2026', theoreticalWeightTon: '23.550' });
    // PDF = 같은 스냅샷 인쇄, 경로만 남긴다
    expect(markMillSheetPdfGenerated(k.at('2026-10-08T11:00:00+09:00'), k.actor('logistics'), { millSheetId: sheets[1].id }).pdfPath).toBe('mill-sheets/MS-2610-0002-1.pdf');
    // 밀시트에 들어간 LOT·히트는 측정값을 고칠 수 없다
    const heat = k.lot('HT-BOF1-261003-001');
    expect(inspectionFormOf(t, heat.id).locked).toBe(true);
    expectInputError(() => registerInspection(k.at('2026-10-08T12:00:00+09:00'), k.actor('quality'), { lotId: heat.id, values: [] }), 'lotId');
  });

  it('10. LOT 정·역추적(lot_relation), 수주 타임라인, Message → ERP 초안 → 요청자 확정 → 부서장 승인', () => {
    // 역추적: 출고된 새 슬래브 → 히트 → 용선 → 원료(기간 기반) + 합금철(실제 투입)
    const slab = k.lot('HT-BOF1-261003-001-03');
    const parentsOf = (lotId: number) => t.lotRelation.filter((r) => r.childLotId === lotId).map((r) => ({ relation: r, lot: t.lot.find((l) => l.id === r.parentLotId) }));
    const [heatLink] = parentsOf(slab.id);
    expect(heatLink.lot?.lotType).toBe('HEAT');
    const heatParents = parentsOf(heatLink.lot?.id ?? 0);
    expect(heatParents.map((p) => p.lot?.lotType).sort()).toEqual(['HOT_METAL', 'RAW_MATERIAL', 'RAW_MATERIAL', 'RAW_MATERIAL']);
    const hm = heatParents.find((p) => p.lot?.lotType === 'HOT_METAL');
    expect(parentsOf(hm?.lot?.id ?? 0).every((p) => p.relation.lotRelationEvidence === 'PERIOD_BASED')).toBe(true);
    // 정추적: 새로 입고한 합금철 LOT → 히트 → 슬래브 → 출하요청
    const heatIds = t.lotRelation.filter((r) => r.parentLotId === newSmnLotId).map((r) => r.childLotId);
    const slabIds = t.lotRelation.filter((r) => heatIds.includes(r.parentLotId)).map((r) => r.childLotId);
    const requestIds = new Set(
      t.allocation
        .filter((a) => slabIds.includes(a.lotId) && a.allocationStatus === 'CONSUMED')
        .map((a) => t.shipmentRequestItem.find((i) => i.id === a.shipmentRequestItemId)?.shipmentRequestId),
    );
    expect([...requestIds]).toEqual([shipmentRequestIds[1]]);

    const timeline = salesOrderTimeline(t, salesOrderId);
    const types = new Set(timeline.map((e) => e.businessEventType));
    for (const type of [
      'SALES_ORDER_CREATED',
      'RESERVATION_CREATED',
      'PRODUCTION_PLAN_CREATED',
      'PURCHASE_REQUISITION_CREATED',
      'PURCHASE_REQUISITION_APPROVED',
      'PURCHASE_ORDER_CREATED',
      'GOODS_RECEIPT_CONFIRMED',
      'PRODUCTION_STARTED',
      'PRODUCTION_RESULT_REGISTERED',
      'INSPECTION_REGISTERED',
      'SURPLUS_CONVERTED',
      'SHIPMENT_REQUEST_CREATED',
      'ALLOCATION_RECOMMENDED',
      'ALLOCATION_CONFIRMED',
      'GOODS_ISSUE_CONFIRMED',
      'RESERVATION_CONVERTED',
      'MILL_SHEET_ISSUED',
    ] as const) {
      expect(types.has(type), type).toBe(true);
    }
    expect(timeline.map((e) => e.occurredAt)).toEqual([...timeline.map((e) => e.occurredAt)].sort());

    // Message → ERP: 업무방의 구매 담당 메시지
    const message = t.message.find((m) => m.content === '실리코망가니즈 20톤 10월 20일까지 필요합니다');
    if (!message) throw new Error('시드 메시지 없음');
    const requester = k.actor('purchase');
    expectCode(() => createDraftFromMessage(k.at('2026-10-09T09:00:00+09:00'), k.actor('logistics'), { messageId: message.id }), 'COM-002');
    const { draft, created } = createDraftFromMessage(k.at('2026-10-09T09:00:00+09:00'), k.actor('salesHead'), { messageId: message.id });
    expect(created).toBe(true);
    expect(draft).toMatchObject({ requesterId: requester.employeeId, draftStatus: 'WAITING_APPROVAL', actionType: 'PURCHASE_REQUISITION_CREATE', messageId: message.id });
    expect(createDraftFromMessage(k.at('2026-10-09T09:01:00+09:00'), requester, { messageId: message.id }).created).toBe(false);
    expectCode(() => confirmDraft(k.at('2026-10-09T09:02:00+09:00'), requester, { actionDraftId: draft.id }), 'ACT-001');
    updateDraft(k.at('2026-10-09T09:03:00+09:00'), requester, { actionDraftId: draft.id, payload: { itemId: k.itemId('SMN01'), requiredTon: '20', desiredReceiptDate: '2026-10-20' } });
    expectCode(() => confirmDraft(k.at('2026-10-09T09:04:00+09:00'), k.actor('salesHead'), { actionDraftId: draft.id }), 'COM-002');
    const outcome = confirmDraft(k.at('2026-10-09T09:05:00+09:00'), requester, { actionDraftId: draft.id });
    expect(outcome.executed).toBe(true);
    expect(outcome.draft.draftStatus).toBe('EXECUTED');
    const pr = t.purchaseRequisition.find((p) => p.actionDraftId === draft.id);
    expect(pr).toMatchObject({ purchaseRequisitionStatus: 'WAITING_APPROVAL', requesterId: requester.employeeId, desiredReceiptDate: '2026-10-20' });
    expectInputError(() => executeDraft(k.at('2026-10-09T09:06:00+09:00'), requester, { actionDraftId: draft.id }));
    approvePurchaseRequisition(k.at('2026-10-09T10:00:00+09:00'), k.actor('purchaseHead'), { purchaseRequisitionId: pr?.id ?? 0 });
    const draftEvents = t.businessEvent.filter((e) => e.actionDraftId === draft.id);
    expect(draftEvents.map((e) => e.businessEventType)).toEqual(['DRAFT_CREATED', 'DRAFT_CONFIRMED', 'PURCHASE_REQUISITION_CREATED', 'DRAFT_EXECUTED', 'PURCHASE_REQUISITION_APPROVED']);
    expect(draftEvents.find((e) => e.businessEventType === 'DRAFT_CONFIRMED')?.reasonCode).toBe('DRAFT_CONFIRMED');
    expect(draftEvents.filter((e) => e.businessEventType !== 'PURCHASE_REQUISITION_APPROVED').every((e) => e.messageId === message.id)).toBe(true);
    const workRoomSalesOrder = t.salesOrder.find((s) => s.salesOrderNo === 'SO-2609-003');
    expect(draftEvents[0].salesOrderId).toBe(workRoomSalesOrder?.id);
    expect(t.message.some((m) => m.chatRoomId === message.chatRoomId && m.senderId === 0 && m.content?.includes(pr?.purchaseRequisitionNo ?? '?'))).toBe(true);
    k.expectClean();
  });
});
