// 시드 원료 잔량 (가정값 SEED_CORE.rawMaterialReceipts, core-domain 16-2): 14.1(히트 1개) 뒤에도 철광석·석탄·석회석을 사지 않고 히트를 더 만든다.
// 14.1 3단계 MRP는 문서 그대로다 — 실리코망가니즈만 순소요 1.500t, 철광석·석탄·석회석은 충분.
import { describe, expect, it } from 'vitest';
import { SEED_CORE } from '@/mock/seeds/core';
import {
  approvePurchaseRequisition,
  computeMrp,
  createPurchaseOrders,
  createPurchaseRequisition,
  createSalesOrder,
  rawMaterialInventory,
  receiveGoods,
  simulatePlan,
} from '@/mock/services';
import { createKit, type Kit } from '@/mock/services/tests/kit';

const SS275_SLAB = 'SL-SS275-250x1200x10000';

/** 실리코망가니즈만 산다: 계획 연결 구매요청 → 부서장 승인 → 발주 → 전량 입고 (receiptDate = 그날) */
function buySilicoManganese(k: Kit, receiptDate: string, ton: string, productionPlanId: number): void {
  const at = k.at(`${receiptDate}T09:00:00+09:00`);
  const purchase = k.actor('purchase');
  const { purchaseRequisition, items } = createPurchaseRequisition(at, purchase, {
    desiredReceiptDate: receiptDate,
    items: [{ itemId: k.itemId('SMN01'), requiredTon: ton, productionPlanId }],
  });
  approvePurchaseRequisition(at, k.actor('purchaseHead'), { purchaseRequisitionId: purchaseRequisition.id });
  createPurchaseOrders(at, purchase, { purchaseRequisitionItemIds: items.map((i) => i.id) });
  for (const item of items) {
    const line = k.tables.purchaseOrderItem.find((l) => l.purchaseRequisitionItemId === item.id);
    if (line) receiveGoods(at, purchase, { purchaseOrderItemId: line.id, receivedTon: line.scheduledReceiptTon, receiptDate });
  }
}

const remainingOf = (k: Kit): Record<string, string> => Object.fromEntries(rawMaterialInventory(k.tables).map((r) => [r.itemCode, r.remainingTon]));

describe('시드 원료 (철광석·석탄·석회석 넉넉히, 실리코망가니즈는 14.1 MRP 그대로)', () => {
  it('시드 끝 잔량: 철광석 2,333.330 · 석탄 899.998 · 석회석 229.998 · 실리코망가니즈 1.000t (+ 입고예정 3.500t)', () => {
    const k = createKit();
    expect(SEED_CORE.rawMaterialReceipts).toEqual({ ORE01: ['1800.000', '3200.000'], COL01: '1900.000', LIM01: '480.000', SMN01: '20.000' });
    expect(remainingOf(k)).toEqual({ ORE01: '2333.330', COL01: '899.998', LIM01: '229.998', SMN01: '1.000' });
    expect(rawMaterialInventory(k.tables).find((r) => r.itemCode === 'SMN01')?.scheduledReceiptTon).toBe('3.500');
  });

  it('14.1 히트 1개 뒤에도 철광석·석탄·석회석을 사지 않고 히트 4개를 더 만든다', () => {
    const k = createKit();
    const ironmakingMaterials = ['ORE01', 'COL01', 'LIM01'].map((code) => k.itemId(code));
    const ironmakingRequisitionCount = () => k.tables.purchaseRequisitionItem.filter((i) => ironmakingMaterials.includes(i.itemId)).length;
    const seededRequisitionCount = ironmakingRequisitionCount();

    // 14.1 1~3단계: SS275 250×1,200×10,000 10매(재고 6 + 부족 4, 히트 1) → MRP는 실리코망가니즈만 1.500t 부족
    const order141 = createSalesOrder(k.at('2026-10-01T09:00:00+09:00'), k.actor('sales'), {
      customerId: k.customerId('CUS-01'),
      items: [{ itemId: k.itemId(SS275_SLAB), orderedQty: 10, dueDate: '2026-10-20' }],
    });
    const plan141 = order141.productionPlans[0];
    expect(plan141).toMatchObject({ shortageQty: 4, heatCount: 1 });
    const mrp141 = computeMrp(k.tables, { from: '2026-10-01', to: '2026-10-31' });
    expect(mrp141.materials.map((m) => [m.itemCode, m.netTon])).toEqual([
      ['ORE01', '0.000'],
      ['COL01', '0.000'],
      ['LIM01', '0.000'],
      ['SMN01', '1.500'],
    ]);
    buySilicoManganese(k, '2026-10-02', '1.500', plan141.id);
    simulatePlan(k.at('2026-10-03T18:00:00+09:00'), k.actor('steelmaking'), { productionPlanId: plan141.id, randomSeed: 42 });
    expect(remainingOf(k)).toMatchObject({ ORE01: '1888.885', COL01: '733.331', LIM01: '188.331', SMN01: '0.000' });

    // 14.1 뒤 새 수주: SS275 슬래브 40매(14.1 슬래브는 판정 대기라 재고 예약 없음) → 히트 4개
    const next = createSalesOrder(k.at('2026-10-04T09:00:00+09:00'), k.actor('sales'), {
      customerId: k.customerId('CUS-02'),
      items: [{ itemId: k.itemId(SS275_SLAB), orderedQty: 40, dueDate: '2026-10-30' }],
    });
    const plan = next.productionPlans[0];
    expect(plan.heatCount).toBe(4);
    // MRP: 철광석·석탄·석회석은 시드 잔량으로 충분, 구매할 줄은 실리코망가니즈뿐
    const mrpNext = computeMrp(k.tables, { from: '2026-10-01', to: '2026-10-31' });
    expect(mrpNext.materials.filter((m) => m.itemCode !== 'SMN01').every((m) => m.netTon === '0.000')).toBe(true);
    expect(mrpNext.requisitionLines.map((l) => l.itemCode)).toEqual(['SMN01']);

    buySilicoManganese(k, '2026-10-05', '10.000', plan.id);
    const result = simulatePlan(k.at('2026-10-05T23:00:00+09:00'), k.actor('steelmaking'), { productionPlanId: plan.id, randomSeed: 7 });
    expect(result.steps.filter((s) => s.processType === 'IRONMAKING')).toHaveLength(4);
    expect(k.lotsOfPlan(plan.id, 'HEAT')).toHaveLength(4);
    expect(remainingOf(k)).toMatchObject({ ORE01: '111.105', COL01: '66.663', LIM01: '21.663' });
    expect(ironmakingRequisitionCount()).toBe(seededRequisitionCount);
    k.expectClean();
  });
});
