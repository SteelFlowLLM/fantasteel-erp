import { agedSurplusCandidate, dueRiskAlerts, qualityRateAlerts, type DueItemInput, type WaitingOrder } from './agent-alert-rules';

describe('dueRiskAlerts (REQ-AGT-004)', () => {
  const item = (over: Partial<DueItemInput> = {}): DueItemInput => ({ salesOrderItemId: 1, salesOrderId: 9, salesOrderNo: 'SO-2610-001', lineNo: 1, ownerEmployeeId: 4, dueDate: '2026-10-18', orderedQty: 10, shippedQty: 4, ...over });

  it('남은 일수가 기준일 이하이고 출하가 모자라면 알린다 (경계 3일 포함)', () => {
    const [a] = dueRiskAlerts([item()], '2026-10-15', 3);
    expect(a.meta.evidence).toMatchObject({ daysLeft: 3, orderedQty: 10, shippedQty: 4 });
    expect(a.ownerEmployeeId).toBe(4);
  });

  it('기준일보다 여유가 있거나 다 출하했으면 알리지 않고, 지난 납기는 알린다', () => {
    expect(dueRiskAlerts([item({ dueDate: '2026-10-19' })], '2026-10-15', 3)).toEqual([]);
    expect(dueRiskAlerts([item({ shippedQty: 10 })], '2026-10-15', 3)).toEqual([]);
    expect(dueRiskAlerts([item({ dueDate: '2026-10-10' })], '2026-10-15', 3)).toHaveLength(1);
  });

  it('남은 일수가 달라져도 알림 문장은 같다 (읽지 않은 같은 알림 중복 방지)', () => {
    expect(dueRiskAlerts([item()], '2026-10-15', 3)[0].content).toBe(dueRiskAlerts([item()], '2026-10-16', 3)[0].content);
  });
});

describe('qualityRateAlerts (REQ-AGT-004)', () => {
  it('불합격률이 기준을 넘고 검사 건수가 충분하면 알린다', () => {
    const [a] = qualityRateAlerts([{ steelGradeCode: 'SM355A', passCount: 8, failCount: 2 }], '2026-10-15');
    expect(a.meta.evidence).toMatchObject({ failRatePercent: '20.0', totalCount: 10 });
  });

  it('기준 이하(정확히 5%)이거나 검사 건수가 적으면 알리지 않는다', () => {
    expect(qualityRateAlerts([{ steelGradeCode: 'SS275', passCount: 19, failCount: 1 }], '2026-10-15')).toEqual([]);
    expect(qualityRateAlerts([{ steelGradeCode: 'SS275', passCount: 2, failCount: 2 }], '2026-10-15')).toEqual([]);
  });
});

describe('agedSurplusCandidate (REQ-AGT-004)', () => {
  const surplus = { itemId: 3, itemCode: 'SL-A', lots: [{ lotNo: 'L1', producedDate: '2026-09-01' }, { lotNo: 'L2', producedDate: '2026-10-10' }] };
  const w = (id: number, due: string, qty = 2): WaitingOrder => ({ salesOrderItemId: id, salesOrderNo: `SO-${id}`, lineNo: 1, dueDate: due, unsecuredQty: qty });

  it('기준일 넘긴 여재가 있고 대기 수주가 있으면 납기 빠른 순으로 추천한다', () => {
    const c = agedSurplusCandidate(surplus, [w(2, '2026-12-01'), w(1, '2026-11-01')], '2026-10-15');
    expect(c?.agedLotNos).toEqual(['L1']);
    expect(c?.recommendations.map((r) => r.salesOrderItemId)).toEqual([1, 2]);
  });

  it('오래된 여재가 없거나 대기 수주가 없으면 만들지 않는다', () => {
    expect(agedSurplusCandidate({ ...surplus, lots: [surplus.lots[1]] }, [w(1, '2026-11-01')], '2026-10-15')).toBeNull();
    expect(agedSurplusCandidate(surplus, [w(1, '2026-11-01', 0)], '2026-10-15')).toBeNull();
  });
});
