// 작업 로그 사유 문구 (04 업무 프로세스 9.3 "사유 코드는 … 사람이 읽을 사유와 함께 기록한다"),
// 번호 없는 대상의 화면 이름, 수주 취소의 실제 결과(after_data)와 구매 진행 영향(BP-PRD-01, 표시만).
import { describe, expect, it } from 'vitest';
import { withEulReul, withEuroRo } from '@/lib/josa';
import type { BusinessEventRow, JsonValue } from '@/mock/schema';
import {
  cancelPurchaseImpactOf,
  cancelSalesOrder,
  confirmDraft,
  confirmShipmentAllocations,
  createDraftFromMessage,
  createPurchaseRequisition,
  createReproductionPlan,
  createSalesOrder,
  eventTargetTextOf,
  salesOrderDetail,
  salesOrderTimeline,
  shipmentRecommendation,
  updateDraft,
} from '@/mock/services';
import { createKit, type Kit } from '@/mock/services/tests/kit';

const SS275_SLAB = 'SL-SS275-250x1200x10000';

const isRecord = (value: JsonValue | null): value is { [key: string]: JsonValue } => typeof value === 'object' && value !== null && !Array.isArray(value);
const afterOf = (event: BusinessEventRow | undefined) => (event && isRecord(event.afterData) ? event.afterData : {});
const eventsOf = (k: Kit, type: BusinessEventRow['businessEventType'], since = 0) => k.tables.businessEvent.filter((e) => e.businessEventType === type && e.id > since);
const lastEventId = (k: Kit) => k.tables.businessEvent.at(-1)?.id ?? 0;

/** 14.1 1단계: 가람중공업 SS275 슬래브 10매 → 재고 우선 예약 6 + 부족 4 생산계획 */
function create141(k: Kit) {
  return createSalesOrder(k.at('2026-10-02T09:00:00+09:00'), k.actor('sales'), {
    customerId: k.customerId('CUS-01'),
    items: [{ itemId: k.itemId(SS275_SLAB), orderedQty: 10, dueDate: '2026-10-20' }],
  });
}

describe('사유 코드에는 사람이 읽을 사유가 함께 남는다 (9.3)', () => {
  it('시드: 사유 코드가 있는 작업 로그는 모두 사유 문구가 있고, 코일 예약·계획은 개, 슬래브는 매로 쓴다', () => {
    const k = createKit();
    const coded = k.tables.businessEvent.filter((e) => e.reasonCode !== null);
    expect(coded.length).toBeGreaterThan(0);
    expect(coded.filter((e) => !e.reasonText?.trim()).map((e) => e.eventNo)).toEqual([]);

    const coilItemIds = new Set(k.tables.item.filter((i) => i.itemType === 'COIL').map((i) => i.id));
    const coilReservationEvents = k.tables.businessEvent.filter((e) => e.targetType === 'reservation' && coilItemIds.has(Number(afterOf(e).itemId)));
    expect(coilReservationEvents.length).toBeGreaterThan(0);
    for (const event of coilReservationEvents) {
      expect(event.reasonText).toMatch(/\d+개/);
      expect(event.reasonText).not.toMatch(/\d+매/);
    }
    const coilPlan = k.tables.productionPlan.find((p) => p.productionPlanNo === 'PP-2609-0003');
    expect(k.tables.businessEvent.find((e) => e.businessEventType === 'PRODUCTION_PLAN_CREATED' && e.targetId === coilPlan?.id)?.reasonText).toBe(
      '품목 1 부족 6개로 생산계획 생성 (히트 1개)',
    );
    expect(k.tables.businessEvent.filter((e) => e.businessEventType === 'SURPLUS_CONVERTED').map((e) => e.reasonText)).toContain('수주 충족 뒤 남은 합격 슬래브 6매를 여재로 전환');
  });

  it('수주 등록: 재고 우선 예약 6매 · 부족 4매로 생산계획 생성. 예약 대상은 번호가 없어 수주 번호·품목·매수로 보인다', () => {
    const k = createKit();
    const { salesOrder, productionPlans } = create141(k);
    const reservation = eventsOf(k, 'RESERVATION_CREATED').at(-1);
    expect(reservation).toMatchObject({ reasonCode: 'STOCK_FIRST', reasonText: '재고 우선 예약 6매 (수주 10매 중)', targetNo: null });
    expect(eventTargetTextOf(k.tables, reservation as BusinessEventRow)).toBe(`${salesOrder.salesOrderNo} 품목 1 · 6매`);
    expect(eventsOf(k, 'PRODUCTION_PLAN_CREATED').at(-1)).toMatchObject({ reasonCode: 'ORDER_SHORTAGE', reasonText: '품목 1 부족 4매로 생산계획 생성 (히트 1개)' });
    // 수주 이력: 대상 이름은 번호가 있으면 번호 그대로
    const timeline = salesOrderTimeline(k.tables, salesOrder.id);
    expect(timeline.map((e) => e.targetText)).toEqual([salesOrder.salesOrderNo, `${salesOrder.salesOrderNo} 품목 1 · 6매`, productionPlans[0].productionPlanNo]);
  });

  it('번호가 없는 대상: 초안은 "초안 #id", 그 밖은 "#id"', () => {
    const k = createKit();
    const base = { targetNo: null, salesOrderId: null, afterData: null };
    expect(eventTargetTextOf(k.tables, { ...base, targetType: 'action_draft', targetId: 3 })).toBe('초안 #3');
    expect(eventTargetTextOf(k.tables, { ...base, targetType: 'allocation', targetId: 12 })).toBe('#12');
    expect(eventTargetTextOf(k.tables, { ...base, targetType: 'reservation', targetId: 9 })).toBe('#9');
  });

  it('FIFO 추천: 추천 LOT 수와 고른 결과를 남긴다', () => {
    const k = createKit();
    const request = k.tables.shipmentRequest.find((r) => r.shipmentRequestNo === 'DR-2609-0002');
    if (!request) throw new Error('출하요청 없음');
    const [line] = shipmentRecommendation(k.tables, request.id);
    const lotIds = line.recommendedLots.map((l) => l.lotId);
    expect(lotIds).toHaveLength(6);
    confirmShipmentAllocations(k.at('2026-10-01T09:00:00+09:00'), k.actor('sales'), { shipmentRequestId: request.id, lines: [{ shipmentRequestItemId: line.shipmentRequestItemId, lotIds: lotIds.slice(0, 2) }] });
    expect(eventsOf(k, 'ALLOCATION_RECOMMENDED').at(-1)?.reasonText).toBe('FIFO 추천 6 LOT (생산완료일 → LOT 번호 순) · 추천 중 2 LOT 확정');
    confirmShipmentAllocations(k.at('2026-10-01T09:01:00+09:00'), k.actor('sales'), { shipmentRequestId: request.id, lines: [{ shipmentRequestItemId: line.shipmentRequestItemId, lotIds: lotIds.slice(2) }] });
    expect(eventsOf(k, 'ALLOCATION_RECOMMENDED').at(-1)?.reasonText).toBe('FIFO 추천 4 LOT (생산완료일 → LOT 번호 순) · 추천대로 확정');
    k.expectClean();
  });

  it('품질 불합격: 예약 조정은 불합격 LOT과 줄인 매수(코일 개), 배정 해제는 까닭과 용도를 남긴다', () => {
    const k = createKit();
    const coil = k.tables.lot.find((l) => l.lotType === 'COIL');
    if (!coil) throw new Error('코일 없음');
    const since = lastEventId(k);
    k.inspect('2026-10-01T09:10:00+09:00', coil.id, { YIELD_STRENGTH: '354.9' });
    expect(eventsOf(k, 'RESERVATION_RELEASED', since).map((e) => [e.reasonCode, e.reasonText])).toEqual([
      ['QUALITY_FAILURE', `품질 불합격(${coil.lotNo})으로 예약 가용이 줄어 예약 1개 해제`],
    ]);

    // 히트 불합격: 배정된 하위 슬래브는 '상위 히트 불합격으로 출하 배정 해제'
    const request = k.tables.shipmentRequest.find((r) => r.shipmentRequestNo === 'DR-2609-0002');
    if (!request) throw new Error('출하요청 없음');
    const [line] = shipmentRecommendation(k.tables, request.id);
    confirmShipmentAllocations(k.at('2026-10-01T09:20:00+09:00'), k.actor('sales'), {
      shipmentRequestId: request.id,
      lines: [{ shipmentRequestItemId: line.shipmentRequestItemId, lotIds: line.recommendedLots.map((l) => l.lotId) }],
    });
    const plan = k.tables.productionPlan.find((p) => p.productionPlanNo === 'PP-2609-0002');
    const heat2 = k.lotsOfPlan(plan?.id ?? 0, 'HEAT')[1];
    const sinceHeat = lastEventId(k);
    k.inspect('2026-10-01T10:00:00+09:00', heat2.id, { P: '0.050' });
    const releasedAllocations = eventsOf(k, 'ALLOCATION_RELEASED', sinceHeat);
    expect(releasedAllocations.length).toBeGreaterThan(0);
    for (const event of releasedAllocations) {
      expect(event.reasonCode).toBe('QUALITY_FAILURE');
      expect(event.reasonText).toMatch(/^(상위 히트 불합격으로 출하 배정 해제|품질 불합격\(LOT \d+개\)으로 예약 가용이 줄어 출하 배정 해제)$/);
    }
    expect(eventsOf(k, 'RESERVATION_RELEASED', sinceHeat).every((e) => /^품질 불합격\(LOT \d+개\)으로 예약 가용이 줄어 예약 \d+매 해제$/.test(e.reasonText ?? ''))).toBe(true);
    k.expectClean();
  });

  it('재생산: 여재·진행 계획으로 채우지 못한 매수와 히트 수', () => {
    const k = createKit();
    const so = k.tables.salesOrder.find((s) => s.salesOrderNo === 'SO-2609-005');
    const soItem = k.tables.salesOrderItem.find((i) => i.salesOrderId === so?.id && i.lineNo === 1);
    if (!soItem) throw new Error('SO-2609-005 없음');
    createReproductionPlan(k.at('2026-10-01T09:00:00+09:00'), k.actor('productionHead'), { salesOrderItemId: soItem.id });
    expect(eventsOf(k, 'REPRODUCTION_PLAN_CREATED').at(-1)).toMatchObject({ reasonCode: 'ORDER_SHORTAGE', actorType: 'USER' });
    expect(eventsOf(k, 'REPRODUCTION_PLAN_CREATED').at(-1)?.reasonText).toMatch(/^품목 1 여재·진행 계획으로 채우지 못한 8매 재생산 계획 생성 \(히트 \d+개\)$/);
  });

  it('Message → ERP: 초안 확정 사유에 초안 번호·원료·수량·희망 입고일, 방 시스템 메시지는 조사를 맞춘다', () => {
    const k = createKit();
    const message = k.tables.message.find((m) => m.content === '실리코망가니즈 20톤 10월 20일까지 필요합니다');
    if (!message) throw new Error('시드 메시지 없음');
    const requester = k.actor('purchase');
    const { draft } = createDraftFromMessage(k.at('2026-10-02T09:00:00+09:00'), requester, { messageId: message.id });
    updateDraft(k.at('2026-10-02T09:01:00+09:00'), requester, { actionDraftId: draft.id, payload: { itemId: k.itemId('SMN01'), requiredTon: '20', desiredReceiptDate: '2026-10-20' } });
    confirmDraft(k.at('2026-10-02T09:02:00+09:00'), requester, { actionDraftId: draft.id });
    const draftLabel = `초안 #${draft.id}`;
    expect(eventsOf(k, 'DRAFT_CONFIRMED').at(-1)).toMatchObject({
      reasonCode: 'DRAFT_CONFIRMED',
      reasonText: `요청자가 ${withEulReul(draftLabel)} 확인·확정 (실리코망가니즈 20t, 희망 입고일 2026-10-20)`,
    });
    const pr = k.tables.purchaseRequisition.find((p) => p.actionDraftId === draft.id);
    const systemMessage = k.tables.message.filter((m) => m.chatRoomId === message.chatRoomId && m.senderId === 0).at(-1);
    // 번호 뒤 조사는 받침에 맞춘다 (lib/josa.test.ts: PR-2610-0002를 · 초안 #3으로)
    expect(systemMessage?.content).toBe(`${withEuroRo(draftLabel)} ${withEulReul(`구매요청 ${pr?.purchaseRequisitionNo ?? ''}`)} 만들었어요. 부서장 승인을 기다려요`);
  });
});

describe('수주 취소: 실제로 일어난 일을 남기고, 구매요청·발주는 보여 주기만 한다', () => {
  it('시작 전 계획: 예약 6매 해제 · 계획 취소 — 취소 이벤트 after_data와 상세의 취소 결과가 같다. 계획에 연결된 구매요청은 영향으로만 보인다', () => {
    const k = createKit();
    const { salesOrder, productionPlans } = create141(k);
    const plan = productionPlans[0];
    const purchaseRequisition = createPurchaseRequisition(k.at('2026-10-02T10:00:00+09:00'), k.actor('purchase'), {
      itemId: k.itemId('SMN01'),
      requestedTon: '1.500',
      desiredReceiptDate: '2026-10-15',
      requestReason: 'MRP 순소요',
      productionPlanId: plan.id,
    });
    expect(cancelPurchaseImpactOf(k.tables, salesOrder.id)).toEqual([
      {
        purchaseRequisitionId: purchaseRequisition.id,
        purchaseRequisitionNo: purchaseRequisition.purchaseRequisitionNo,
        purchaseRequisitionStatus: 'WAITING_APPROVAL',
        itemName: k.tables.item.find((i) => i.itemCode === 'SMN01')?.itemName,
        requiredTon: '1.500',
        productionPlanId: plan.id,
        productionPlanNo: plan.productionPlanNo,
        planEffect: 'CANCEL',
        purchaseOrderId: null,
        purchaseOrderNo: null,
        purchaseOrderStatus: null,
      },
    ]);

    const since = lastEventId(k);
    cancelSalesOrder(k.at('2026-10-02T11:00:00+09:00'), k.actor('sales'), { salesOrderId: salesOrder.id, cancelReason: '고객사 요청' });
    const cancelEvent = eventsOf(k, 'SALES_ORDER_CANCELLED', since)[0];
    expect(cancelEvent).toMatchObject({ reasonCode: 'ORDER_CANCELLED', reasonText: '고객사 요청' });
    expect(afterOf(cancelEvent)).toMatchObject({
      items: [{ lineNo: 1, salesOrderItemStatus: 'CANCELLED', releasedReservedQty: 6 }],
      cancelledPlanNos: [plan.productionPlanNo],
      unlinkedPlanNos: [],
    });
    expect(eventsOf(k, 'RESERVATION_RELEASED', since).map((e) => e.reasonText)).toEqual([`수주 ${salesOrder.salesOrderNo} 취소로 예약 6매 해제`]);
    expect(eventsOf(k, 'PRODUCTION_PLAN_CANCELLED', since).map((e) => e.reasonText)).toEqual([`수주 ${salesOrder.salesOrderNo} 취소로 시작 전 계획 취소 (부족 4매)`]);
    expect(salesOrderDetail(k.tables, salesOrder.id).cancellation).toEqual({
      releasedReserved: [{ lineNo: 1, itemType: 'SLAB', qty: 6 }],
      cancelledPlanNos: [plan.productionPlanNo],
      unlinkedPlanNos: [],
    });
    // 구매요청은 그대로 (자동으로 바꾸지 않는다)
    expect(k.tables.purchaseRequisition.find((p) => p.id === purchaseRequisition.id)).toMatchObject({ purchaseRequisitionStatus: 'WAITING_APPROVAL', updatedAt: purchaseRequisition.updatedAt });
    expect(salesOrderDetail(k.tables, k.tables.salesOrder.find((s) => s.salesOrderNo === 'SO-2609-004')?.id ?? 0).cancellation).toBeNull();
    k.expectClean();
  });

  it('진행중 계획(14.2 혼합 수주 SO-2609-003): 발주까지 간 MRP 구매요청은 연결 해제 영향으로 보이고, 취소 뒤에도 그대로다', () => {
    const k = createKit();
    const so = k.tables.salesOrder.find((s) => s.salesOrderNo === 'SO-2609-003');
    if (!so) throw new Error('SO-2609-003 없음');
    const [impact, ...rest] = cancelPurchaseImpactOf(k.tables, so.id);
    expect(rest).toEqual([]);
    expect(impact).toMatchObject({
      purchaseRequisitionNo: 'PR-2609-0005',
      purchaseRequisitionStatus: 'ORDERED',
      productionPlanNo: 'PP-2609-0004',
      planEffect: 'UNLINK',
      purchaseOrderNo: 'PO-2609-0005',
      purchaseOrderStatus: 'PARTIALLY_RECEIVED',
    });
    const prBefore = k.tables.purchaseRequisition.find((p) => p.purchaseRequisitionNo === 'PR-2609-0005');
    const poBefore = k.tables.purchaseOrder.find((p) => p.purchaseOrderNo === 'PO-2609-0005');

    const since = lastEventId(k);
    cancelSalesOrder(k.at('2026-10-01T09:00:00+09:00'), k.actor('salesHead'), { salesOrderId: so.id, cancelReason: '고객사 프로젝트 취소' });
    expect(afterOf(eventsOf(k, 'SALES_ORDER_CANCELLED', since)[0])).toMatchObject({
      items: [
        { lineNo: 1, releasedReservedQty: 3 },
        { lineNo: 2, releasedReservedQty: 0 },
      ],
      cancelledPlanNos: [],
      unlinkedPlanNos: ['PP-2609-0003', 'PP-2609-0004'],
    });
    const released = eventsOf(k, 'RESERVATION_RELEASED', since);
    expect(released.length).toBeGreaterThan(0);
    expect(released.every((e) => /^수주 SO-2609-003 취소로 예약 \d+개 해제$/.test(e.reasonText ?? ''))).toBe(true);
    const unlinked = eventsOf(k, 'SURPLUS_CONVERTED', since).filter((e) => e.beforeData !== null);
    expect(unlinked.map((e) => e.targetNo)).toEqual(['PP-2609-0003', 'PP-2609-0004']);
    expect(unlinked.every((e) => e.reasonText?.startsWith('수주 SO-2609-003 취소로 진행중 계획의 수주 연결을 풀고 완료 후 여재로 전환'))).toBe(true);
    expect(eventsOf(k, 'ALLOCATION_RELEASED', since).every((e) => e.reasonText === '수주 SO-2609-003 취소로 열연 투입 배정 해제')).toBe(true);
    expect(salesOrderDetail(k.tables, so.id).cancellation).toEqual({
      releasedReserved: [
        { lineNo: 1, itemType: 'COIL', qty: 3 },
        { lineNo: 2, itemType: 'SLAB', qty: 0 },
      ],
      cancelledPlanNos: [],
      unlinkedPlanNos: ['PP-2609-0003', 'PP-2609-0004'],
    });
    // 구매요청·발주는 바뀌지 않는다. 연결이 풀린 계획은 더는 이 수주의 영향 목록에 없다
    expect(k.tables.purchaseRequisition.find((p) => p.id === prBefore?.id)).toEqual(prBefore);
    expect(k.tables.purchaseOrder.find((p) => p.id === poBefore?.id)).toEqual(poBefore);
    expect(cancelPurchaseImpactOf(k.tables, so.id)).toEqual([]);
    k.expectClean();
  });
});
