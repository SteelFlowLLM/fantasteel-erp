// MRP 기간과 시점별 차감 (REQ-PRD-005 "수주에 연결된 생산계획은 다른 수주의 입고예정에서 제외", 04 4.4 "같은 공급을 계획별로 중복 차감하지 않는다", BP-PRD-01).
// 차감은 고른 기간과 관계없이 열린 계획 전부로 하고(앞선 필요일이 먼저), 기간은 무엇을 보일지만 정한다.
//   P: SS275 슬래브 36매 수주, 납기 2026-10-20 → 철광석이 모자란다
//   Q: 같은 규격 36매 다른 수주, 납기 2026-11-20
import { describe, expect, it } from 'vitest';
import { decCmp } from '@/lib/decimal';
import { approvePurchaseRequisition, createPurchaseOrders, createPurchaseRequisition, createSalesOrder } from '@/mock/services';
import { computeMrpForPeriod, type MrpPeriodView } from '@/mock/services/ext/purchasing';
import { createKit, type Kit } from '@/mock/services/tests/kit';

const AT = '2026-10-01T09:00:00+09:00';
const OCT = { from: '2026-10-01', to: '2026-10-31' };
const NOV = { from: '2026-11-01', to: '2026-11-30' };

function setup(): { kit: Kit; planP: number; planQ: number; ore: number } {
  const kit = createKit();
  const planOf = (dueDate: string): number => {
    const result = createSalesOrder(kit.at(AT), kit.actor('sales'), {
      customerId: kit.customerId('CUS-01'),
      items: [{ itemId: kit.itemId('SL-SS275-250x1200x10000'), orderedQty: 36, dueDate }],
    });
    const plan = result.productionPlans[0];
    if (!plan) throw new Error('생산계획이 없어요');
    return plan.id;
  };
  return { kit, planP: planOf('2026-10-20'), planQ: planOf('2026-11-20'), ore: kit.itemId('ORE01') };
}

const materialOf = (view: MrpPeriodView, planId: number, itemId: number) => view.plans.find((p) => p.productionPlanId === planId)?.materials.find((m) => m.itemId === itemId);

describe('MRP 기간 · 시점별 차감', () => {
  it('기간 시작 전 계획(밀린 소요)이 잔량을 먼저 쓰고 함께 보인다 · 기간을 바꿔도 계획별 결과는 같다', () => {
    const { kit, planP, planQ, ore } = setup();
    const both = computeMrpForPeriod(kit.tables, { from: OCT.from, to: NOV.to });
    const nov = computeMrpForPeriod(kit.tables, NOV);

    // 11월 기간: P(10-20)는 기간 전이라도 아직 남은 히트가 있어 밀린 소요로 보인다
    expect(nov.plans.find((p) => p.productionPlanId === planP)).toMatchObject({ needDate: '2026-10-20', beforePeriod: true });
    expect(nov.plans.find((p) => p.productionPlanId === planQ)).toMatchObject({ needDate: '2026-11-20', beforePeriod: false });
    expect(nov.requisitionLines.some((l) => l.productionPlanId === planP && l.itemId === ore)).toBe(true);

    // P가 철광석 잔량을 먼저 다 써서 모자라므로, Q는 같은 잔량을 다시 쓰지 못한다(이중 차감 없음)
    const oreP = materialOf(nov, planP, ore);
    const oreQ = materialOf(nov, planQ, ore);
    expect(oreP && decCmp(oreP.netTon, 0)).toBeGreaterThan(0);
    expect(oreQ?.netTon).toBe(oreQ?.grossTon);

    // 계획별 순소요는 고른 기간과 관계없다
    for (const planId of [planP, planQ]) {
      expect(nov.plans.find((p) => p.productionPlanId === planId)?.materials).toEqual(both.plans.find((p) => p.productionPlanId === planId)?.materials);
    }
    // 원료 합계: 채운 톤 + 순소요 = 총소요, 쓴 잔량 ≤ 원료 LOT 잔량
    const oreRow = nov.materials.find((m) => m.itemId === ore);
    expect(oreRow).toBeDefined();
    if (oreRow) {
      expect(decCmp(oreRow.coveredOnHandTon, oreRow.onHandTon)).toBeLessThanOrEqual(0);
      expect(Number(oreRow.coveredOnHandTon) + Number(oreRow.coveredScheduledTon) + Number(oreRow.netTon)).toBeCloseTo(Number(oreRow.grossTon), 3);
    }
  });

  it('기간 뒤 계획 몫으로 발주한 입고예정은 다른 수주의 계획이 쓰지 못하고, 그 계획의 기간에서 쓰인다', () => {
    const { kit, planP, planQ, ore } = setup();
    const octBefore = computeMrpForPeriod(kit.tables, OCT);
    const pNetBefore = materialOf(octBefore, planP, ore)?.netTon ?? '0';
    expect(decCmp(pNetBefore, 0)).toBeGreaterThan(0);
    expect(octBefore.plans.some((p) => p.productionPlanId === planQ)).toBe(false);

    // Q 몫 철광석 구매요청(production_plan_id = Q) → 승인 → 발주(입고 예정 10-10, P의 필요일보다 앞섬)
    const purchase = kit.actor('purchase');
    const { purchaseRequisition, items } = createPurchaseRequisition(kit.at(AT), purchase, {
      desiredReceiptDate: '2026-10-10',
      items: [{ itemId: ore, requiredTon: '10000', productionPlanId: planQ }],
    });
    approvePurchaseRequisition(kit.at(AT), kit.actor('purchaseHead'), { purchaseRequisitionId: purchaseRequisition.id });
    createPurchaseOrders(kit.at(AT), purchase, { purchaseRequisitionItemIds: items.map((i) => i.id), dueDate: '2026-10-10' });

    // 10월 기간: Q는 보이지 않지만 그 몫 입고예정은 Q 전용이라 P의 순소요는 그대로
    const octAfter = computeMrpForPeriod(kit.tables, OCT);
    expect(materialOf(octAfter, planP, ore)?.netTon).toBe(pNetBefore);
    expect(octAfter.materials.find((m) => m.itemId === ore)?.coveredScheduledTon).toBe(octBefore.materials.find((m) => m.itemId === ore)?.coveredScheduledTon);

    // 11월 기간: Q가 자기 몫 입고예정으로 채우고, P는 여전히 밀린 부족으로 보인다
    const novAfter = computeMrpForPeriod(kit.tables, NOV);
    expect(materialOf(novAfter, planQ, ore)?.netTon).toBe('0.000');
    expect(materialOf(novAfter, planP, ore)?.netTon).toBe(pNetBefore);
    kit.expectClean();
  });
});
