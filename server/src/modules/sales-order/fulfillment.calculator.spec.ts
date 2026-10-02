import { calcItemFulfillment, daysBetween, isDueRisk, planRemainingTargetQty, salesOrderStatusOf, type ItemFulfillmentInput } from './fulfillment.calculator';

const base: ItemFulfillmentInput = {
  orderedQty: 10,
  salesOrderItemStatus: 'OPEN',
  dueDate: '2026-10-20',
  reservations: [],
  plans: [],
  today: '2026-10-02',
  deliveryRiskDays: 3,
};

describe('수주 충족 현황 (업무 프로세스 4.5, REQ-SO-004)', () => {
  it('합격 가용 6매에 10매 수주: 예약 6, 미확보 4, 부족 계획 4매가 있으면 추가 계획 필요 0 (14.1-1)', () => {
    const r = calcItemFulfillment({
      ...base,
      reservations: [{ reservationStatus: 'ACTIVE', reservedQty: 6 }],
      plans: [{ productionPlanStatus: 'PLANNED', shortageQty: 4, passedQty: 0 }],
    });
    expect(r).toMatchObject({ shippedQty: 0, unshippedQty: 10, activeReservedQty: 6, passedQty: 6, plannedQty: 4, inProductionQty: 0, unsecuredQty: 4, additionalPlanQty: 0 });
    expect(r.progress).toEqual({ qty: 0, denominatorQty: 10, ratio: 0 });
  });

  it('부분 출고 4매: 출하 4, 예약 6, 검사합격 = 예약 + 출하, 진행률 = 출하 ÷ 주문', () => {
    const r = calcItemFulfillment({
      ...base,
      salesOrderItemStatus: 'PARTIALLY_SHIPPED',
      reservations: [
        { reservationStatus: 'ACTIVE', reservedQty: 6 },
        { reservationStatus: 'CONVERTED', reservedQty: 4 },
        { reservationStatus: 'RELEASED', reservedQty: 3 },
      ],
    });
    expect(r).toMatchObject({ shippedQty: 4, unshippedQty: 6, activeReservedQty: 6, passedQty: 10, unsecuredQty: 0, additionalPlanQty: 0 });
    expect(r.progress).toEqual({ qty: 4, denominatorQty: 10, ratio: 0.4 });
  });

  it('진행중 계획의 합격 제품은 잔여 목표에서 빠진다 (자동 예약과 겹치지 않게)', () => {
    const r = calcItemFulfillment({
      ...base,
      reservations: [{ reservationStatus: 'ACTIVE', reservedQty: 7 }],
      plans: [{ productionPlanStatus: 'IN_PROGRESS', shortageQty: 4, passedQty: 1 }],
    });
    expect(r).toMatchObject({ inProductionQty: 3, unsecuredQty: 3, additionalPlanQty: 0 });
  });

  it('여재 해제·불합격으로 계획이 모자라면 추가 계획 필요가 남는다 (재생산 판단)', () => {
    const r = calcItemFulfillment({
      ...base,
      reservations: [{ reservationStatus: 'ACTIVE', reservedQty: 6 }],
      plans: [{ productionPlanStatus: 'COMPLETED', shortageQty: 4, passedQty: 2 }],
    });
    expect(r).toMatchObject({ inProductionQty: 0, plannedQty: 0, unsecuredQty: 4, additionalPlanQty: 4 });
  });

  it('취소 품목은 출하 외 모두 0, 납기 위험 아님', () => {
    const r = calcItemFulfillment({
      ...base,
      salesOrderItemStatus: 'CANCELLED',
      dueDate: '2026-10-02',
      reservations: [{ reservationStatus: 'RELEASED', reservedQty: 6 }],
      plans: [{ productionPlanStatus: 'CANCELLED', shortageQty: 4, passedQty: 0 }],
    });
    expect(r).toMatchObject({ shippedQty: 0, unshippedQty: 0, activeReservedQty: 0, unsecuredQty: 0, additionalPlanQty: 0, isDueRisk: false });
  });
});

describe('진행 계획 잔여 목표', () => {
  it('시작 전·진행중만 남고 완료·취소는 0', () => {
    expect(planRemainingTargetQty({ productionPlanStatus: 'PLANNED', shortageQty: 4, passedQty: 0 })).toBe(4);
    expect(planRemainingTargetQty({ productionPlanStatus: 'IN_PROGRESS', shortageQty: 4, passedQty: 5 })).toBe(0);
    expect(planRemainingTargetQty({ productionPlanStatus: 'COMPLETED', shortageQty: 4, passedQty: 1 })).toBe(0);
    expect(planRemainingTargetQty({ productionPlanStatus: 'CANCELLED', shortageQty: 4, passedQty: 0 })).toBe(0);
  });
});

describe('납기 위험 (TRM-107)', () => {
  const at = (dueDate: string, unshippedQty = 1) => isDueRisk({ dueDate, today: '2026-10-02', deliveryRiskDays: 3, unshippedQty, salesOrderItemStatus: 'OPEN' });
  it('남은 일수 ≤ 기준일이면 위험 (지난 납기 포함)', () => {
    expect(at('2026-10-05')).toBe(true);
    expect(at('2026-10-06')).toBe(false);
    expect(at('2026-09-30')).toBe(true);
  });
  it('미출하가 없으면 위험 아님', () => {
    expect(at('2026-10-03', 0)).toBe(false);
  });
  it('월·연 경계에서도 일수를 바르게 센다', () => {
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
  });
});

describe('수주 헤더 상태 (품목 상태에서 계산)', () => {
  it.each([
    [['OPEN', 'OPEN'], 'OPEN'],
    [['OPEN', 'PARTIALLY_SHIPPED'], 'PARTIALLY_SHIPPED'],
    [['SHIPPED', 'OPEN'], 'PARTIALLY_SHIPPED'],
    [['SHIPPED', 'SHIPPED'], 'SHIPPED'],
    [['SHIPPED', 'CANCELLED'], 'SHIPPED'],
    [['CANCELLED', 'CANCELLED'], 'CANCELLED'],
  ] as const)('%j → %s', (statuses, expected) => {
    expect(salesOrderStatusOf(statuses)).toBe(expected);
  });
});
