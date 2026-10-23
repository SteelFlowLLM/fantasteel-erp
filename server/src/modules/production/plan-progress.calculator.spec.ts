import { plannedSlabQtyOf, slabQtyFromHeat } from './heat-plan.calculator';
import { planOpenRemainingQty, productJudgement, reproductionCheckOf } from './plan-progress.calculator';

describe('히트당 슬래브 매수 (4.4 이후 연주 산출)', () => {
  it('14.1 예시: 250t × 연주 0.98 ÷ 23.550t = 10.4 → 10매, 부족 4매면 예상 여재 6매', () => {
    const perHeat = slabQtyFromHeat('250', '0.98', '23.550');
    expect(perHeat).toBe(10);
    expect(plannedSlabQtyOf({ slabQtyPerHeat: perHeat, heatCount: 1, shortageQty: 4 })).toEqual({ plannedSlabQty: 10, expectedSurplusSlabQty: 6 });
  });

  it('부족 매수가 계획 슬래브보다 많으면 예상 여재는 0', () => {
    expect(plannedSlabQtyOf({ slabQtyPerHeat: 10, heatCount: 2, shortageQty: 25 })).toEqual({ plannedSlabQty: 20, expectedSurplusSlabQty: 0 });
  });
});

describe('제품 판정 (REQ-INV-003·007)', () => {
  it.each([
    ['PASS', 'PASS', 'PASS'],
    ['PASS', null, 'PENDING'],
    [null, 'PASS', 'PENDING'],
    ['PENDING', 'PASS', 'PENDING'],
    ['FAIL', 'PASS', 'FAIL'],
    ['PASS', 'FAIL', 'FAIL'],
    [null, 'FAIL', 'FAIL'],
  ] as const)('자기 %s · 히트 %s → %s', (own, heat, expected) => {
    expect(productJudgement(own, heat)).toBe(expected);
  });
});

describe('진행 계획 잔여 목표', () => {
  it('시작 전·진행중은 부족 − 합격', () => {
    expect(planOpenRemainingQty({ productionPlanStatus: 'PLANNED', shortageQty: 4, passedQty: 0, pendingQty: 0 })).toBe(4);
    expect(planOpenRemainingQty({ productionPlanStatus: 'IN_PROGRESS', shortageQty: 4, passedQty: 1, pendingQty: 3 })).toBe(3);
  });

  it('완료 계획은 판정 대기만큼만 남긴다 (검사 중인 제품을 재생산으로 다시 만들지 않게)', () => {
    expect(planOpenRemainingQty({ productionPlanStatus: 'COMPLETED', shortageQty: 4, passedQty: 1, pendingQty: 2 })).toBe(2);
    expect(planOpenRemainingQty({ productionPlanStatus: 'COMPLETED', shortageQty: 4, passedQty: 1, pendingQty: 0 })).toBe(0);
  });

  it('취소 계획은 0', () => {
    expect(planOpenRemainingQty({ productionPlanStatus: 'CANCELLED', shortageQty: 4, passedQty: 0, pendingQty: 4 })).toBe(0);
  });
});

describe('재생산 판단 (4.5, 14.1-6)', () => {
  const base = { salesOrderItemId: 1, orderedQty: 10, salesOrderItemStatus: 'OPEN' as const };

  it('예약 6 + 진행 계획 4 → 추가 계획 0', () => {
    const r = reproductionCheckOf({ ...base, reservations: [{ reservationStatus: 'ACTIVE', reservedQty: 6 }], plans: [{ productionPlanStatus: 'IN_PROGRESS', shortageQty: 4, passedQty: 0, pendingQty: 0 }], reservationAvailableQty: 0 });
    expect(r).toMatchObject({ unsecuredQty: 4, openPlanRemainingQty: 4, additionalPlanQty: 0, reproductionNeedQty: 0 });
  });

  it('완료 계획에서 2매 불합격: 추가 계획 2, 여재 1매가 있으면 재생산 1', () => {
    const r = reproductionCheckOf({
      ...base,
      reservations: [{ reservationStatus: 'ACTIVE', reservedQty: 8 }],
      plans: [{ productionPlanStatus: 'COMPLETED', shortageQty: 4, passedQty: 2, pendingQty: 0 }],
      reservationAvailableQty: 1,
    });
    expect(r).toMatchObject({ unsecuredQty: 2, openPlanRemainingQty: 0, additionalPlanQty: 2, reservationAvailableQty: 1, reproductionNeedQty: 1 });
  });

  it('출고분은 미출하에서 빠지고, 취소 품목은 모두 0', () => {
    const shipped = reproductionCheckOf({ ...base, reservations: [{ reservationStatus: 'CONVERTED', reservedQty: 4 }, { reservationStatus: 'ACTIVE', reservedQty: 6 }], plans: [], reservationAvailableQty: 5 });
    expect(shipped).toMatchObject({ shippedQty: 4, unsecuredQty: 0, reproductionNeedQty: 0 });
    const cancelled = reproductionCheckOf({ ...base, salesOrderItemStatus: 'CANCELLED', reservations: [], plans: [{ productionPlanStatus: 'PLANNED', shortageQty: 10, passedQty: 0, pendingQty: 0 }], reservationAvailableQty: 0 });
    expect(cancelled).toMatchObject({ unsecuredQty: 0, additionalPlanQty: 0, reproductionNeedQty: 0 });
  });
});
