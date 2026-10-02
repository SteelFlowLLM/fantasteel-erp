// 실적 시뮬레이션의 작업 시각 배치: 새벽에 실행해도 작업이 어제 날짜로 넘어가지 않아, 오늘 입고한 원료를 쓸 수 있어야 한다.
import { describe, expect, it } from 'vitest';
import { toSeoulDateString } from '@/lib/seoulDate';
import { createSalesOrder, simulatePlan } from '@/mock/services';
import { createKit, stockRawMaterials } from '@/mock/services/tests/kit';

describe('실적 시뮬레이션 작업 시각', () => {
  it('새벽 2시에 실행해도 모든 작업이 오늘 안에 있고, 오늘 입고한 원료로 제선한다', () => {
    const k = createKit();
    // 예전 원료 LOT은 모두 비워, 오늘 입고한 원료만 남긴다
    for (const lot of k.tables.lot) {
      if (lot.lotType === 'RAW_MATERIAL' && lot.lotStatus === 'AVAILABLE') {
        lot.remainingTon = '0.000';
        lot.lotStatus = 'CONSUMED';
      }
    }
    stockRawMaterials(k, '2026-10-02T01:30:00+09:00');
    const created = createSalesOrder(k.at('2026-10-02T01:40:00+09:00'), k.actor('sales'), {
      customerId: k.customerId('CUS-01'),
      items: [{ itemId: k.itemId('SL-SM355A-250x1200x10000'), orderedQty: 4, dueDate: '2026-10-30' }],
    });
    const planId = created.productionPlans[0].id;

    const now = '2026-10-02T02:00:00+09:00';
    const result = simulatePlan(k.at(now), k.actor('steelmaking'), { productionPlanId: planId, randomSeed: 11 });
    expect(result.steps.map((s) => s.processType)).toEqual(['IRONMAKING', 'STEELMAKING', 'CONTINUOUS_CASTING']);

    const results = k.tables.productionResult.filter((r) => r.productionPlanId === planId);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(toSeoulDateString(new Date(r.startedAt))).toBe('2026-10-02');
      expect(r.completedAt).not.toBeNull();
      expect(new Date(r.completedAt ?? '').getTime()).toBeLessThanOrEqual(new Date(now).getTime());
    }
    k.expectClean();
  });

  it('시간이 충분하면 정해진 시간(제선 4·제강 1·연주 2시간) 그대로 지금 끝나도록 둔다', () => {
    const k = createKit();
    stockRawMaterials(k, '2026-10-02T08:00:00+09:00');
    const created = createSalesOrder(k.at('2026-10-02T09:00:00+09:00'), k.actor('sales'), {
      customerId: k.customerId('CUS-01'),
      items: [{ itemId: k.itemId('SL-SM355A-250x1200x10000'), orderedQty: 4, dueDate: '2026-10-30' }],
    });
    const planId = created.productionPlans[0].id;
    simulatePlan(k.at('2026-10-02T18:00:00+09:00'), k.actor('steelmaking'), { productionPlanId: planId, randomSeed: 11 });
    const results = k.tables.productionResult.filter((r) => r.productionPlanId === planId).sort((a, b) => a.id - b.id);
    const hours = results.map((r) => (new Date(r.completedAt ?? '').getTime() - new Date(r.startedAt).getTime()) / 3_600_000);
    expect(hours).toEqual([4, 1, 2]);
    expect(results[results.length - 1].completedAt).toBe(new Date('2026-10-02T18:00:00+09:00').toISOString());
  });
});
