import { describe, expect, it } from 'vitest';
import { decCmp, decSub, decSum } from '@/lib/decimal';
import { ferroalloyTonFor, hotMetalTonFor, netRequirements, rawMaterialTonFor, supplyBreakdownOf, type MrpNetLine, type MrpRequirement, type MrpSupply } from '@/lib/mrp';

describe('MRP (업무 프로세스 4.4)', () => {
  it('용선 = 히트 톤 ÷ 제강 수율, 원료 = 용선 × t/t, 합금철 = 히트 톤 × kg/t ÷ 1,000', () => {
    const hm = hotMetalTonFor('250.000', '0.9000');
    expect(hm).toBe('277.778');
    expect(rawMaterialTonFor(hm, '1.600')).toBe('444.445');
    expect(rawMaterialTonFor(hm, '0.150')).toBe('41.667');
    expect(ferroalloyTonFor('250.000', '10.000')).toBe('2.500');
    expect(ferroalloyTonFor('500.000', '20.000')).toBe('10.000');
  });
  it('시점별 순소요: 잔량 → 필요일까지 오는 입고예정, 같은 공급을 두 번 빼지 않는다', () => {
    const { lines, usage } = netRequirements(
      [
        { planId: 1, materialId: 9, needDate: '2026-10-10', grossTon: '5.000' },
        { planId: 2, materialId: 9, needDate: '2026-10-20', grossTon: '5.000' },
      ],
      [
        { kind: 'ON_HAND', materialId: 9, availableDate: null, ton: '3.000', reservedForPlanId: null, sourceId: 1 },
        { kind: 'SCHEDULED', materialId: 9, availableDate: '2026-10-15', ton: '4.000', reservedForPlanId: null, sourceId: 2 },
      ],
    );
    expect(lines.map((l) => [l.planId, l.coveredOnHandTon, l.coveredScheduledTon, l.netTon])).toEqual([
      [1, '3.000', '0.000', '2.000'],
      [2, '0.000', '4.000', '1.000'],
    ]);
    expect(usage.map((u) => u.remainingTon)).toEqual(['0.000', '0.000']);
  });
  it('수주에 연결된 계획 몫의 입고예정은 그 계획이 먼저 쓰고 다른 계획이 쓰지 않는다', () => {
    const { lines } = netRequirements(
      [
        { planId: 1, materialId: 9, needDate: '2026-10-10', grossTon: '2.000' },
        { planId: 2, materialId: 9, needDate: '2026-10-20', grossTon: '4.000' },
      ],
      [{ kind: 'SCHEDULED', materialId: 9, availableDate: '2026-10-05', ton: '4.000', reservedForPlanId: 2, sourceId: 5 }],
    );
    expect(lines.map((l) => l.netTon)).toEqual(['2.000', '0.000']);
  });
});

// 표 한 줄: 총소요 − 원료 LOT 잔량(usableOnHandTon) − 입고예정(scheduledUsedTon) = 순소요 (0보다 작으면 0)
describe('MRP 원료 줄의 공급 내역 (표 숫자끼리 맞게)', () => {
  const onHand = (sourceId: number, ton: string): MrpSupply => ({ kind: 'ON_HAND', materialId: 9, availableDate: null, ton, reservedForPlanId: null, sourceId });
  const scheduled = (sourceId: number, ton: string, availableDate: string | null, reservedForPlanId: number | null = null): MrpSupply => ({
    kind: 'SCHEDULED',
    materialId: 9,
    availableDate,
    ton,
    reservedForPlanId,
    sourceId,
  });
  const need = (planId: number, needDate: string, grossTon: string): MrpRequirement => ({ planId, materialId: 9, needDate, grossTon });
  const breakdown = (requirements: MrpRequirement[], supplies: MrpSupply[], isShown: (line: MrpNetLine) => boolean = () => true) => {
    const { lines } = netRequirements(requirements, supplies);
    const shown = lines.filter(isShown);
    return { supply: supplyBreakdownOf(9, lines, supplies, isShown), grossTon: decSum(shown.map((l) => l.grossTon)), netTon: decSum(shown.map((l) => l.netTon)) };
  };
  /** 행 산수가 맞고, 입고예정 합계 = 쓴 몫 + 이유별 뺀 몫 */
  const expectRowAdds = ({ supply, grossTon, netTon }: ReturnType<typeof breakdown>) => {
    const left = decSub(decSub(grossTon, supply.usableOnHandTon), supply.scheduledUsedTon);
    expect(decCmp(left, 0) > 0 ? left : '0.000').toBe(netTon);
    expect(decSum([supply.scheduledUsedTon, supply.scheduledOtherPlansTon, supply.scheduledAfterNeedDateTon, supply.scheduledEarlierPlansTon, supply.scheduledSpareTon])).toBe(supply.scheduledTon);
    expect(decSub(supply.onHandTon, supply.onHandEarlierPlansTon)).toBe(supply.usableOnHandTon);
  };

  it('14.1 합금철: 필요일(10-20) 뒤에 도착하는 입고예정 3.500t는 입고예정 칸에서 빼고 이유를 따로 준다 → 2.500 − 1.000 − 0.000 = 1.500', () => {
    const result = breakdown([need(1, '2026-10-20', '2.500')], [onHand(1, '1.000'), scheduled(2, '3.500', '2026-10-28', 99)]);
    expect(result.netTon).toBe('1.500');
    expect(result.supply).toMatchObject({ onHandTon: '1.000', usableOnHandTon: '1.000', scheduledTon: '3.500', scheduledUsedTon: '0.000', scheduledAfterNeedDateTon: '3.500', scheduledOtherPlansTon: '0.000', scheduledSpareTon: '0.000' });
    expectRowAdds(result);
  });

  it('다른 수주의 열린 계획 몫 입고예정은 쓰지 못하고 "다른 계획 몫"으로 빠진다 (REQ-PRD-005)', () => {
    // 계획 1(보임, 10-10)이 모자라고, 계획 2(기간 뒤)의 몫 4t는 10-05에 오지만 계획 1이 쓰지 못한다
    const result = breakdown([need(1, '2026-10-10', '5.000'), need(2, '2026-11-20', '4.000')], [scheduled(3, '4.000', '2026-10-05', 2)], (l) => l.needDate <= '2026-10-31');
    expect(result.netTon).toBe('5.000');
    expect(result.supply).toMatchObject({ scheduledTon: '4.000', scheduledUsedTon: '0.000', scheduledOtherPlansTon: '4.000' });
    expectRowAdds(result);
  });

  it('일부만 쓴 입고예정: 늦게 필요한 계획이 3t를 쓰고, 나머지 7t는 모자란 계획의 필요일 뒤에 와서 뺀다', () => {
    const result = breakdown([need(1, '2026-10-10', '5.000'), need(2, '2026-10-20', '3.000')], [scheduled(4, '10.000', '2026-10-15')]);
    expect(result.netTon).toBe('5.000');
    expect(result.supply).toMatchObject({ scheduledUsedTon: '3.000', scheduledAfterNeedDateTon: '7.000', scheduledSpareTon: '0.000' });
    expectRowAdds(result);
  });

  it('보이지 않는 기간 앞 계획이 먼저 쓴 잔량·입고예정은 따로 빠진다', () => {
    // 계획 1(09-25, 기간 앞)이 잔량 6t + 입고예정 1t를 먼저 쓰고, 계획 2(10-10)는 남은 입고예정 1t만 쓴다
    const result = breakdown([need(1, '2026-09-25', '7.000'), need(2, '2026-10-10', '5.000')], [onHand(1, '6.000'), scheduled(5, '2.000', '2026-09-20')], (l) => l.needDate >= '2026-10-01');
    expect(result.netTon).toBe('4.000');
    expect(result.supply).toMatchObject({ onHandTon: '6.000', onHandEarlierPlansTon: '6.000', usableOnHandTon: '0.000', scheduledUsedTon: '1.000', scheduledEarlierPlansTon: '1.000' });
    expectRowAdds(result);
  });

  it('소요가 이미 잔량으로 채워지면 쓰지 않은 입고예정은 "남는 몫", 납기 없는 발주는 필요일 뒤 도착으로 본다', () => {
    const spare = breakdown([need(1, '2026-10-10', '5.000')], [onHand(1, '10.000'), scheduled(6, '4.000', '2026-10-01')]);
    expect(spare.netTon).toBe('0.000');
    expect(spare.supply).toMatchObject({ usableOnHandTon: '10.000', scheduledUsedTon: '0.000', scheduledSpareTon: '4.000' });
    expectRowAdds(spare);
    const noDueDate = breakdown([need(1, '2026-10-10', '5.000')], [onHand(1, '1.000'), scheduled(7, '4.000', null)]);
    expect(noDueDate.supply).toMatchObject({ scheduledUsedTon: '0.000', scheduledAfterNeedDateTon: '4.000' });
    expectRowAdds(noDueDate);
  });

  it('계획 몫 입고예정을 그 계획이 다 쓰지 않고 남겨도 모자란 다른 계획은 쓰지 못한다 → 그 계획에는 "다른 계획 몫"', () => {
    const result = breakdown([need(1, '2026-10-10', '2.000'), need(2, '2026-10-20', '6.000')], [scheduled(8, '5.000', '2026-10-01', 1)]);
    expect(result.netTon).toBe('6.000');
    expect(result.supply).toMatchObject({ scheduledUsedTon: '2.000', scheduledOtherPlansTon: '3.000' });
    expectRowAdds(result);
  });
});
