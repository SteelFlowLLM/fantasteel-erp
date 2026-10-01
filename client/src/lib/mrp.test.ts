import { describe, expect, it } from 'vitest';
import { ferroalloyTonFor, hotMetalTonFor, netRequirements, rawMaterialTonFor } from '@/lib/mrp';

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
