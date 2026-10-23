import { describe, expect, it } from 'vitest';
import type { DeliveryRiskData, DeliveryRiskRow, SurplusAgeData } from '@/api/dashboard';
import type { GoodsIssueQueueRow } from '@/api/goodsIssues';
import type { InspectionQueueRow } from '@/api/inspections';
import type { RequisitionView } from '@/api/purchasing';
import type { ShipmentListRow } from '@/api/shipmentRequests';
import {
  BRIEFING_CARD_LIMIT,
  EMPTY_BRIEFING_SOURCES,
  briefingCountLabel,
  briefingDateText,
  briefingGreeting,
  briefingRuleCount,
  briefingSourceCount,
  briefingSourceKeys,
  buildBriefingCards,
  deliveryRiskCard,
  goodsIssueCard,
  inspectionPendingCard,
  issuedYesterdayCard,
  plainLength,
  splitEmphasis,
  surplusAgeCard,
  taskCard,
  upcomingShipmentsCard,
  visibleEmphasis,
  type BriefingSources,
} from '@/features/briefing/lib/briefingRules';

const TODAY = '2026-10-23';

function riskRow(over: Partial<DeliveryRiskRow>): DeliveryRiskRow {
  return {
    salesOrderId: 1,
    salesOrderNo: 'SO-2610-001',
    customerName: '나래조선',
    salesOrderItemId: 11,
    lineNo: 1,
    itemCode: 'C-SM355B-9-1400',
    itemType: 'COIL',
    orderedQty: 10,
    shippedQty: 4,
    unshippedQty: 6,
    unshippedTon: '172.950',
    dueDate: '2026-10-25',
    daysToDue: 2,
    isOverdue: false,
    ...over,
  };
}

const delivery = (items: DeliveryRiskRow[]): DeliveryRiskData => ({ today: TODAY, deliveryRiskDays: 3, openItemCount: 12, items });

function queueRow(over: Partial<InspectionQueueRow>): InspectionQueueRow {
  return {
    lotId: 1,
    lotNo: 'HT-BOF1-261023-001',
    lotType: 'HEAT',
    lotStatus: 'ACTIVE',
    processType: 'STEELMAKING',
    itemId: null,
    itemCode: null,
    itemName: null,
    steelGradeCode: 'SM355B',
    thicknessMm: null,
    producedDate: TODAY,
    heatLotId: null,
    heatNo: null,
    heatResult: null,
    productionPlanNo: null,
    qualityInspectionId: null,
    inspectionResult: 'PENDING',
    inspectionStandardCode: null,
    inspectionStandardVersion: null,
    inspectedAt: null,
    inspectorName: null,
    locked: false,
    ...over,
  } as InspectionQueueRow;
}

function shipment(over: Partial<ShipmentListRow>): ShipmentListRow {
  return {
    id: 1,
    shipmentRequestNo: 'DR-2610-0001',
    customerId: 1,
    customerName: '가람중공업',
    requestedShipDate: TODAY,
    shipmentRequestStatus: 'REQUESTED',
    requesterName: null,
    createdAt: '2026-10-20T00:00:00Z',
    updatedAt: '2026-10-20T00:00:00Z',
    issuedAt: null,
    issuedEmployeeName: null,
    cancelledAt: null,
    salesOrderNos: [],
    totalRequestQty: 4,
    totalAllocatedQty: 0,
    waitingAllocationQty: 4,
    totalWeightTon: '115.300',
    itemCodes: [],
    itemTypes: [],
    salesOrderIds: [],
    salesOrders: [],
    ...over,
  } as ShipmentListRow;
}

function issueRow(over: Partial<GoodsIssueQueueRow>): GoodsIssueQueueRow {
  return {
    shipmentRequestId: 7,
    shipmentRequestNo: 'DR-2610-0007',
    shipmentRequestStatus: 'ALLOCATED',
    customerName: '보람강관',
    requestedShipDate: '2026-10-24',
    totalRequestQty: 3,
    totalAllocatedQty: 3,
    totalWeightTon: '86.475',
    issuedAt: null,
    issuedEmployeeName: null,
    ready: true,
    problems: [],
    ...over,
  };
}

const sources = (over: Partial<BriefingSources>): BriefingSources => ({ today: TODAY, ...EMPTY_BRIEFING_SOURCES, ...over });

describe('납기 위험 카드', () => {
  it('가장 급한 수주를 앞에 두고, 하루 안이거나 지났으면 위험', () => {
    const card = deliveryRiskCard(delivery([riskRow({}), riskRow({ salesOrderId: 2, salesOrderNo: 'SO-2610-004', customerName: '보람강관', daysToDue: 1 })]));
    expect(card.severity).toBe('danger');
    expect(card.value).toBe('2건');
    expect(card.summary).toContain('**SO-2610-004**(보람강관)');
    expect(card.detail.primary.href).toBe('/sales-orders/2');
    expect(card.detail.rows[0].highlight).toBe(true);
  });

  it('여유가 2일 이상이면 확인 필요, 같은 수주의 품목은 한 건으로 센다', () => {
    const card = deliveryRiskCard(delivery([riskRow({}), riskRow({ salesOrderItemId: 12, lineNo: 2, daysToDue: 3 })]));
    expect(card.severity).toBe('wait');
    expect(card.value).toBe('1건');
  });

  it('위험이 없으면 좋은 소식', () => {
    const card = deliveryRiskCard(delivery([]));
    expect(card.severity).toBe('ok');
    expect(card.summary).toContain('**12개**');
  });
});

describe('판정 대기 카드', () => {
  it('하루 넘게 기다린 LOT이 있으면 위험, 오래된 순', () => {
    const card = inspectionPendingCard(
      [queueRow({ lotId: 2, lotNo: 'B', producedDate: TODAY }), queueRow({ lotId: 3, lotNo: 'A', producedDate: '2026-10-21', lotType: 'SLAB' }), queueRow({ lotId: 4, inspectionResult: 'PASS' })],
      TODAY,
      'quality',
    );
    expect(card.severity).toBe('danger');
    expect(card.value).toBe('2개');
    expect(card.summary).toContain('**A**');
    expect(card.detail.primary.href).toBe('/quality/inspections?lot=3');
  });

  it('오늘 생산분만 있으면 확인 필요, 없으면 좋은 소식', () => {
    expect(inspectionPendingCard([queueRow({})], TODAY, 'production').severity).toBe('wait');
    expect(inspectionPendingCard([], TODAY, 'production').severity).toBe('ok');
  });
});

describe('출하·출고 카드', () => {
  it('7일 안 출하 예정은 날짜별로 묶고 몰린 날을 알린다', () => {
    const rows = [
      shipment({ id: 1, requestedShipDate: '2026-10-26' }),
      shipment({ id: 2, requestedShipDate: '2026-10-26', shipmentRequestStatus: 'ALLOCATED', totalWeightTon: '100.000' }),
      shipment({ id: 3, requestedShipDate: '2026-10-24' }),
      shipment({ id: 4, requestedShipDate: '2026-11-05' }),
      shipment({ id: 5, requestedShipDate: '2026-10-25', shipmentRequestStatus: 'CANCELLED' }),
    ];
    const card = upcomingShipmentsCard(rows, TODAY);
    expect(card?.value).toBe('330.600톤');
    expect(card?.summary).toContain('3건');
    expect(card?.say).toContain('**2건**');
    expect(upcomingShipmentsCard([shipment({ requestedShipDate: '2026-11-30' })], TODAY)).toBeNull();
  });

  it('어제 출고 확정은 서울 날짜로 본다', () => {
    const rows = [
      shipment({ id: 1, shipmentRequestStatus: 'ISSUED', issuedAt: '2026-10-22T15:30:00Z' }),
      shipment({ id: 2, shipmentRequestStatus: 'ISSUED', issuedAt: '2026-10-22T01:00:00Z' }),
    ];
    // 10-22 15:30Z는 서울로 10-23 00:30이라 오늘 출고다
    expect(issuedYesterdayCard(rows, TODAY)?.value).toBe('1건');
  });

  it('출고 확정 대기: 출하 예정일이 지났으면 위험', () => {
    expect(goodsIssueCard([issueRow({}), issueRow({ shipmentRequestId: 8, requestedShipDate: TODAY, ready: false, problems: [{ code: 'COM-001', message: 'x', lotNo: null }] })], TODAY).severity).toBe('danger');
    const card = goodsIssueCard([issueRow({})], TODAY);
    expect(card.severity).toBe('wait');
    expect(card.detail.primary.href).toBe('/goods-issues?request=7');
    expect(goodsIssueCard([issueRow({ shipmentRequestStatus: 'ISSUED' })], TODAY).severity).toBe('ok');
  });
});

describe('그 밖의 카드', () => {
  it('여재가 30일을 넘으면 확인 필요, 없으면 카드 없음', () => {
    const data: SurplusAgeData = {
      today: TODAY,
      totalQty: 5,
      totalTon: '50.000',
      maxAgeDays: 41,
      items: [
        { itemId: 1, itemCode: 'S-SS275-250-1200', steelGradeCode: 'SS275', surplusQty: 3, surplusTon: '30.000', oldestSinceDate: '2026-09-12', maxAgeDays: 41 },
        { itemId: 2, itemCode: 'S-SM355A-250-1500', steelGradeCode: 'SM355A', surplusQty: 2, surplusTon: '20.000', oldestSinceDate: '2026-10-20', maxAgeDays: 3 },
      ],
    };
    expect(surplusAgeCard(data)?.severity).toBe('wait');
    expect(surplusAgeCard({ ...data, totalQty: 0, items: [] })).toBeNull();
  });

  it('업무: 마감 지난 것이 있으면 위험, 오늘 마감만 있으면 확인 필요, 둘 다 없으면 없음', () => {
    expect(taskCard({ openCount: 5, overdueCount: 2, dueTodayCount: 1 })?.severity).toBe('danger');
    expect(taskCard({ openCount: 5, overdueCount: 0, dueTodayCount: 1 })?.title).toBe('오늘 마감 업무');
    expect(taskCard({ openCount: 5, overdueCount: 0, dueTodayCount: 0 })).toBeNull();
  });
});

describe('역할별 브리핑', () => {
  it('위험 → 확인 필요 → 참고 순서이고 좋은 소식으로 끝낸다 (최대 4장)', () => {
    const cards = buildBriefingCards(
      'SALES',
      sources({
        deliveryRisk: delivery([riskRow({ daysToDue: 0 })]),
        shipmentRequests: [
          shipment({ id: 1, requestedShipDate: '2026-10-27' }),
          shipment({ id: 2, shipmentRequestStatus: 'ALLOCATED', requestedShipDate: '2026-10-28' }),
          shipment({ id: 3, shipmentRequestStatus: 'ISSUED', issuedAt: '2026-10-22T03:00:00Z' }),
        ],
        taskSummary: { openCount: 3, overdueCount: 0, dueTodayCount: 1 },
      }),
      false,
    );
    expect(cards).toHaveLength(BRIEFING_CARD_LIMIT);
    expect(cards.map((c) => c.severity)).toEqual(['danger', 'wait', 'wait', 'ok']);
    expect(cards.at(-1)?.key).toBe('issued-yesterday');
    expect(briefingCountLabel(cards)).toBe('위험 1 · 확인 필요 2 · 좋은 소식 1');
  });

  it('부서장이면 결재 대기를 넣는다', () => {
    const inbox = [{ id: 9, purchaseRequisitionNo: 'PR-2610-0003', itemName: '철광석', requestedTon: '500.000', requesterName: '최하은', desiredReceiptDate: '2026-10-30', createdAt: '2026-10-22T00:00:00Z' } as RequisitionView];
    const cards = buildBriefingCards('PURCHASE', sources({ approvalInbox: inbox }), true);
    expect(cards[0].key).toBe('approval-inbox');
    expect(cards[0].detail.primary.href).toBe('/approvals?pr=9');
    expect(briefingSourceKeys('PURCHASE', true)[0]).toBe('approvalInbox');
    expect(briefingSourceKeys('PURCHASE', false)).not.toContain('approvalInbox');
  });

  it('생산에는 "납기 위험 없음" 좋은 소식을 넣지 않는다', () => {
    const cards = buildBriefingCards('PRODUCTION', sources({ deliveryRisk: delivery([]), inspectionQueue: [] }), false);
    expect(cards.map((c) => c.key)).toEqual(['inspection-pending']);
  });

  it('읽은 자료가 하나도 없으면 조용한 하루 카드 한 장', () => {
    const cards = buildBriefingCards('ADMIN', sources({}), false);
    expect(cards).toHaveLength(1);
    expect(cards[0].key).toBe('quiet');
    expect(briefingSourceCount(sources({}), 'agentRisk')).toBe('-');
  });

  it('읽지 못한 자료가 있으면 조용한 하루 대신 못 읽었어요 카드를 쓴다', () => {
    const cards = buildBriefingCards('ADMIN', sources({}), false, ['agentRisk', 'taskSummary']);
    expect(cards.map((c) => c.key)).toEqual(['sources-failed']);
    expect(cards[0].severity).toBe('wait');
    expect(cards[0].say).toContain('Agent 후보, 내 업무');
    expect(cards[0].detail.rows).toHaveLength(2);
  });

  it('못 읽었어요 카드는 위험 카드가 가득해도 한 자리를 지킨다', () => {
    const many = sources({ deliveryRisk: delivery([riskRow({ salesOrderItemId: 1 }), riskRow({ salesOrderItemId: 2, salesOrderId: 2, salesOrderNo: 'SO-2610-002' })]), inspectionQueue: [] });
    const cards = buildBriefingCards('PRODUCTION', many, false, ['surplusAge']);
    expect(cards.length).toBeLessThanOrEqual(BRIEFING_CARD_LIMIT);
    expect(cards.map((c) => c.key)).toContain('sources-failed');
  });
});

describe('강조 표시', () => {
  it('**글자**를 강조 조각으로 나눈다', () => {
    expect(splitEmphasis('납기 위험 수주가 **3건** 있어요')).toEqual([
      { text: '납기 위험 수주가 ', em: false },
      { text: '3건', em: true },
      { text: ' 있어요', em: false },
    ]);
  });
});

describe('타자 표시', () => {
  it('앞 글자부터 강조를 지키며 보인다', () => {
    expect(visibleEmphasis('가 **3건** 나', 3)).toEqual([
      { text: '가 ', em: false },
      { text: '3', em: true },
    ]);
    expect(plainLength('가 **3건** 나')).toBe(6);
    expect(briefingRuleCount('SALES', false)).toBe(6);
    expect(briefingRuleCount('SALES', true)).toBe(7);
  });
});

describe('인사·날짜', () => {
  it('서울 시각으로 인사와 날짜를 쓴다', () => {
    expect(briefingGreeting(8)).toBe('좋은 아침이에요!');
    expect(briefingGreeting(13)).toBe('좋은 오후예요!');
    expect(briefingGreeting(19)).toContain('수고');
    expect(briefingDateText(new Date('2026-10-23T00:05:00Z'))).toBe('2026년 10월 23일 (금) 09:05');
  });
});
