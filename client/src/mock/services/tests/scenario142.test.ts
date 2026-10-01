// 업무 프로세스 14.2 P1 코일·혼합·취소 + 열연 배정 규칙
import { describe, expect, it } from 'vitest';
import {
  cancelSalesOrder,
  changeAllocation,
  confirmRollingAllocations,
  createSalesOrder,
  productionPlanView,
  registerCasting,
  registerHotRolling,
  registerIronmaking,
  registerSteelmaking,
  releaseAllocation,
  rollingPlanView,
  rollingRecommendation,
  salesOrderDetail,
  salesOrderTimeline,
  simulatePlan,
} from '@/mock/services';
import { createKit, expectCode, expectInputError, stockRawMaterials } from '@/mock/services/tests/kit';

describe('14.2 코일·슬래브 혼합 수주와 열연', () => {
  const k = createKit();
  const t = k.tables;
  const coilCode = 'CL-SS275-4.5x1500x544000';
  const slabBCode = 'SL-SS275-250x1500x10000';
  let coilPlanId = 0;
  let slabPlanId = 0;
  let coilItemId = 0;

  it('혼합 수주: 품목마다 자기 라우팅으로 부족분만 계획 (코일 누적 수율 = 연주 × 열연)', () => {
    stockRawMaterials(k, '2026-10-01T08:00:00+09:00');
    const result = createSalesOrder(k.at('2026-10-01T09:00:00+09:00'), k.actor('sales'), {
      customerId: k.customerId('CUS-04'),
      items: [
        { itemId: k.itemId(coilCode), orderedQty: 3, dueDate: '2026-10-25' },
        { itemId: k.itemId(slabBCode), orderedQty: 2, dueDate: '2026-10-25' },
      ],
    });
    coilItemId = result.items[0].id;
    const [coilPlan, slabPlan] = result.productionPlans;
    coilPlanId = coilPlan.id;
    slabPlanId = slabPlan.id;
    expect(coilPlan).toMatchObject({ itemId: k.itemId(coilCode), shortageQty: 3, cumulativeYieldRate: '0.9596', heatCount: 1 });
    expect(slabPlan).toMatchObject({ itemId: k.itemId(slabBCode), shortageQty: 2, cumulativeYieldRate: '0.9800', heatCount: 1 });
    // 3 × 28.825 = 86.475 ÷ 0.9596 = 90.116
    expect(coilPlan.requiredSteelTon).toBe('90.116');
    expect(productionPlanView(t, coilPlanId).slabSpec?.itemCode).toBe(slabBCode);
    k.expectClean();
  });

  it('코일 계획 시뮬레이션: 연주까지, 판정 대기 슬래브는 열연하지 않는다', () => {
    const result = simulatePlan(k.at('2026-10-02T18:00:00+09:00'), k.actor('steelmaking'), { productionPlanId: coilPlanId, randomSeed: 9 });
    expect(result.steps.map((s) => s.processType)).toEqual(['IRONMAKING', 'STEELMAKING', 'CONTINUOUS_CASTING']);
    expect(result.skippedRolling).not.toBeNull();
    const slabs = k.lotsOfPlan(coilPlanId, 'SLAB');
    expect(slabs).toHaveLength(8);
    expect(slabs.every((s) => s.itemId === k.itemId(slabBCode))).toBe(true);
    for (const slab of slabs) k.inspect('2026-10-03T09:00:00+09:00', slab.id);
    const heat = k.lotsOfPlan(coilPlanId, 'HEAT')[0];
    const outcome = k.inspect('2026-10-03T09:30:00+09:00', heat.id);
    // 코일 계획의 슬래브는 슬래브 수주에 자동 예약하지 않는다(계획 품목이 코일)
    expect(outcome.autoReservedQty).toBe(0);
    expect(rollingPlanView(t, coilPlanId)).toMatchObject({ neededQty: 3, recommendableQty: 3 });
  });

  it('열연 배정은 판매 슬래브 예약을 침범하지 않는다', () => {
    // 다른 수주가 같은 슬래브 규격 6매를 재고 우선 예약 → 예약 가용 2
    const other = createSalesOrder(k.at('2026-10-03T10:00:00+09:00'), k.actor('sales'), {
      customerId: k.customerId('CUS-01'),
      items: [{ itemId: k.itemId(slabBCode), orderedQty: 6, dueDate: '2026-10-30' }],
    });
    expect(other.reservations.map((r) => r.reservedQty)).toEqual([6]);
    const view = rollingPlanView(t, coilPlanId);
    expect(view.slabPool.availableQty).toBe(2);
    expect(view.recommendableQty).toBe(2);
    const recommendation = rollingRecommendation(t, coilPlanId);
    expect(recommendation.lots).toHaveLength(2);
    const extra = k.lotsOfPlan(coilPlanId, 'SLAB').find((s) => !recommendation.lots.some((l) => l.lotId === s.id));
    expectCode(
      () => confirmRollingAllocations(k.at('2026-10-03T11:00:00+09:00'), k.actor('hotRollingHead'), { productionPlanId: coilPlanId, lotIds: [...recommendation.lots.map((l) => l.lotId), extra?.id ?? 0] }),
      'INV-001',
    );
    const allocations = confirmRollingAllocations(k.at('2026-10-03T11:00:00+09:00'), k.actor('hotRollingHead'), { productionPlanId: coilPlanId, lotIds: recommendation.lots.map((l) => l.lotId) });
    expect(allocations.every((a) => a.allocationPurpose === 'HOT_ROLLING' && a.productionPlanId === coilPlanId && a.allocationStatus === 'CONFIRMED')).toBe(true);
    expectCode(() => confirmRollingAllocations(k.at('2026-10-03T11:01:00+09:00'), k.actor('hotRollingHead'), { productionPlanId: coilPlanId, lotIds: [allocations[0].lotId] }), 'INV-003');
    // 남은 슬래브(판매 예약 몫)는 필요 매수가 남아도 배정할 수 없다
    expectCode(() => confirmRollingAllocations(k.at('2026-10-03T11:01:00+09:00'), k.actor('hotRollingHead'), { productionPlanId: coilPlanId, lotIds: [extra?.id ?? 0] }), 'INV-001');
    expect(rollingPlanView(t, coilPlanId).slabPool.availableQty).toBe(0);
    // 배정 변경: 판매 예약 몫 안의 LOT이라도 예약은 수량이라 변경은 해제+새 배정으로 한 번에 (사유 필수)
    expectInputError(() => changeAllocation(k.at('2026-10-03T11:02:00+09:00'), k.actor('hotRollingHead'), { allocationId: allocations[0].id, newLotId: extra?.id ?? 0, reasonText: ' ' }), 'reasonText');
    const changed = changeAllocation(k.at('2026-10-03T11:03:00+09:00'), k.actor('hotRollingHead'), { allocationId: allocations[0].id, newLotId: extra?.id ?? 0, reasonText: '야드 위치' });
    expect(t.allocation.find((a) => a.id === allocations[0].id)?.allocationStatus).toBe('RELEASED');
    expect(changed).toMatchObject({ lotId: extra?.id, allocationStatus: 'CONFIRMED', productionPlanId: coilPlanId });
    const event = t.businessEvent.find((e) => e.businessEventType === 'ALLOCATION_CHANGED');
    expect(event).toMatchObject({ reasonCode: 'ALLOCATION_CHANGE', reasonText: '야드 위치' });
    expectCode(() => changeAllocation(k.at('2026-10-03T11:04:00+09:00'), k.actor('hotRollingHead'), { allocationId: allocations[1].id, newLotId: extra?.id ?? 0, reasonText: '중복' }), 'INV-003');
    k.expectClean();
  });

  it('슬래브 1매 → 코일 1개 (C + 슬래브번호, 코일 규격 이론중량), 코일 검사 → 자동 예약', () => {
    const allocated = t.allocation.filter((a) => a.productionPlanId === coilPlanId && a.allocationStatus === 'CONFIRMED');
    const slabNos = allocated.map((a) => t.lot.find((l) => l.id === a.lotId)?.lotNo ?? '');
    const { coilLots } = registerHotRolling(k.at('2026-10-04T12:00:00+09:00'), k.actor('hotRollingHead'), {
      productionPlanId: coilPlanId,
      startedAt: '2026-10-04T10:00:00+09:00',
      completedAt: '2026-10-04T11:30:00+09:00',
    });
    expect(coilLots.map((c) => c.lotNo).sort()).toEqual(slabNos.map((no) => `C${no.replace(/^HT-/, '')}`).sort());
    expect(coilLots.every((c) => c.itemId === k.itemId(coilCode) && c.lotType === 'COIL')).toBe(true);
    for (const coil of coilLots) {
      const relation = t.lotRelation.filter((r) => r.childLotId === coil.id);
      expect(relation).toHaveLength(1);
      expect(t.lot.find((l) => l.id === relation[0].parentLotId)?.lotStatus).toBe('CONSUMED');
    }
    expect(t.allocation.filter((a) => a.productionPlanId === coilPlanId && a.allocationStatus === 'CONSUMED')).toHaveLength(2);
    const result = t.productionResult.find((r) => r.processType === 'HOT_ROLLING' && r.productionPlanId === coilPlanId);
    expect(result).toMatchObject({ outputQty: 2, outputTon: '57.650' }); // 2 × 28.825
    for (const coil of coilLots) k.inspect('2026-10-04T14:00:00+09:00', coil.id);
    expect(t.reservation.filter((r) => r.salesOrderItemId === coilItemId && r.reservationStatus === 'ACTIVE').reduce((s, r) => s + r.reservedQty, 0)).toBe(2);
    // 소진된 슬래브는 다시 배정할 수 없다
    const consumed = t.lot.find((l) => l.lotStatus === 'CONSUMED' && l.lotType === 'SLAB' && l.productionPlanId === coilPlanId);
    expectCode(() => confirmRollingAllocations(k.at('2026-10-04T15:00:00+09:00'), k.actor('hotRollingHead'), { productionPlanId: coilPlanId, lotIds: [consumed?.id ?? 0] }), 'INV-004');
    expect(rollingPlanView(t, coilPlanId)).toMatchObject({ rolledQty: 2, neededQty: 1 });
    k.expectClean();
  });

  it('판정 대기 슬래브는 배정할 수 없다 (INV-002), 배정 해제', () => {
    simulatePlan(k.at('2026-10-05T18:00:00+09:00'), k.actor('steelmaking'), { productionPlanId: slabPlanId, randomSeed: 3 });
    const pending = k.lotsOfPlan(slabPlanId, 'SLAB')[0];
    expectCode(() => confirmRollingAllocations(k.at('2026-10-05T19:00:00+09:00'), k.actor('hotRollingHead'), { productionPlanId: coilPlanId, lotIds: [pending.id] }), 'INV-002');
    k.expectClean();
  });

  it('생산 시작 전 수주 취소 → 계획 CANCELLED, 예약 RELEASED, 품목·헤더 취소', () => {
    const stockItem = k.itemId('SL-SS275-250x1200x10000');
    const so = createSalesOrder(k.at('2026-10-06T09:00:00+09:00'), k.actor('sales'), { customerId: k.customerId('CUS-02'), items: [{ itemId: stockItem, orderedQty: 8, dueDate: '2026-10-30' }] });
    expect(so.reservations.map((r) => r.reservedQty)).toEqual([6]);
    expectInputError(() => cancelSalesOrder(k.at('2026-10-06T10:00:00+09:00'), k.actor('sales'), { salesOrderId: so.salesOrder.id, cancelReason: '' }), 'cancelReason');
    cancelSalesOrder(k.at('2026-10-06T10:00:00+09:00'), k.actor('sales'), { salesOrderId: so.salesOrder.id, cancelReason: '고객 요청' });
    expect(t.productionPlan.find((p) => p.id === so.productionPlans[0].id)?.productionPlanStatus).toBe('CANCELLED');
    expect(t.reservation.filter((r) => r.salesOrderItemId === so.items[0].id).map((r) => r.reservationStatus)).toEqual(['RELEASED']);
    expect(t.inventory.find((i) => i.itemId === stockItem)?.reservedQty).toBe(0);
    const detail = salesOrderDetail(t, so.salesOrder.id);
    expect(detail.status).toBe('CANCELLED');
    expect(detail.cancelBlock).toBe('CANCELLED');
    const types = salesOrderTimeline(t, so.salesOrder.id).map((e) => [e.businessEventType, e.reasonCode]);
    expect(types).toEqual(
      expect.arrayContaining([
        ['SALES_ORDER_CANCELLED', 'ORDER_CANCELLED'],
        ['RESERVATION_RELEASED', 'ORDER_CANCELLED'],
        ['PRODUCTION_PLAN_CANCELLED', 'ORDER_CANCELLED'],
      ]),
    );
    k.expectClean();
  });

  it('연주 진행 중 취소 → 수주 연결 해제·완료 후 여재, 연주 후 슬래브가 여재가 된다', () => {
    const stockItem = k.itemId('SL-SS275-250x1200x10000');
    const so = createSalesOrder(k.at('2026-10-07T09:00:00+09:00'), k.actor('sales'), { customerId: k.customerId('CUS-02'), items: [{ itemId: stockItem, orderedQty: 8, dueDate: '2026-10-30' }] });
    const plan = so.productionPlans[0];
    registerIronmaking(k.at('2026-10-07T14:00:00+09:00'), k.actor('ironmakingHead'), {
      productionPlanId: plan.id,
      blastFurnaceCode: 'BF2',
      startedAt: '2026-10-07T09:30:00+09:00',
      completedAt: '2026-10-07T13:30:00+09:00',
      outputTon: '277.778',
    });
    const { heatLot } = registerSteelmaking(k.at('2026-10-07T16:00:00+09:00'), k.actor('steelmakingHead'), {
      productionPlanId: plan.id,
      converterCode: 'BOF1',
      startedAt: '2026-10-07T14:30:00+09:00',
      completedAt: '2026-10-07T15:30:00+09:00',
      inputHotMetalTon: '277.778',
    });
    expect(t.productionPlan.find((p) => p.id === plan.id)?.productionPlanStatus).toBe('IN_PROGRESS');
    cancelSalesOrder(k.at('2026-10-07T17:00:00+09:00'), k.actor('sales'), { salesOrderId: so.salesOrder.id, cancelReason: '사양 변경' });
    const after = t.productionPlan.find((p) => p.id === plan.id);
    expect(after).toMatchObject({ productionPlanStatus: 'IN_PROGRESS', salesOrderItemId: null, isSurplusOnCompletion: true });
    expect(t.reservation.filter((r) => r.salesOrderItemId === so.items[0].id).every((r) => r.reservationStatus === 'RELEASED')).toBe(true);
    const surplusEvent = salesOrderTimeline(t, so.salesOrder.id).find((e) => e.businessEventType === 'SURPLUS_CONVERTED');
    expect(surplusEvent).toMatchObject({ reasonCode: 'SURPLUS_CONVERSION' });
    expect(surplusEvent?.beforeData).toMatchObject({ salesOrderItemId: so.items[0].id });
    const { slabLots } = registerCasting(k.at('2026-10-07T20:00:00+09:00'), k.actor('steelmakingHead'), {
      productionPlanId: plan.id,
      heatLotId: heatLot.id,
      outputQty: 10,
      startedAt: '2026-10-07T18:00:00+09:00',
      completedAt: '2026-10-07T19:30:00+09:00',
    });
    expect(slabLots.every((s) => s.surplusAt !== null)).toBe(true);
    expect(t.productionPlan.find((p) => p.id === plan.id)?.productionPlanStatus).toBe('COMPLETED');
    // 나중에 합격해도 끊긴 계획이라 자동 예약하지 않는다
    for (const slab of slabLots) k.inspect('2026-10-08T09:00:00+09:00', slab.id);
    expect(k.inspect('2026-10-08T09:30:00+09:00', heatLot.id).autoReservedQty).toBe(0);
    k.expectClean();
  });
});

describe('연결이 끊긴 진행 계획의 연주 → 여재 (합금철이 있는 시드)', () => {
  it('제강 뒤 취소 → 연주 슬래브 surplus_at + SURPLUS_CONVERTED, 계획 COMPLETED', () => {
    const k = createKit();
    const t = k.tables;
    // 시드의 PP-2609-0004(SM355B 슬래브 계획)는 제선·제강까지 했다 → 수주 SO-2609-003 취소는 출하요청이 없으므로 가능
    const plan = t.productionPlan.find((p) => p.productionPlanNo === 'PP-2609-0004');
    const so = t.salesOrder.find((s) => s.salesOrderNo === 'SO-2609-003');
    if (!plan || !so) throw new Error('시드 없음');
    expect(plan.productionPlanStatus).toBe('IN_PROGRESS');
    cancelSalesOrder(k.at('2026-10-01T09:00:00+09:00'), k.actor('salesHead'), { salesOrderId: so.id, cancelReason: '고객사 프로젝트 취소' });
    expect(t.productionPlan.find((p) => p.id === plan.id)).toMatchObject({ salesOrderItemId: null, isSurplusOnCompletion: true });
    // 코일 계획(PP-2609-0003)도 진행 중이라 연결 해제
    expect(t.productionPlan.find((p) => p.productionPlanNo === 'PP-2609-0003')).toMatchObject({ salesOrderItemId: null, isSurplusOnCompletion: true });
    const heat = k.lotsOfPlan(plan.id, 'HEAT')[0];
    const { slabLots } = registerCasting(k.at('2026-10-01T12:00:00+09:00'), k.actor('steelmakingHead'), {
      productionPlanId: plan.id,
      heatLotId: heat.id,
      outputQty: 10,
      startedAt: '2026-10-01T10:00:00+09:00',
      completedAt: '2026-10-01T11:30:00+09:00',
    });
    expect(slabLots.every((s) => s.surplusAt !== null)).toBe(true);
    expect(t.productionPlan.find((p) => p.id === plan.id)?.productionPlanStatus).toBe('COMPLETED');
    expect(t.businessEvent.filter((e) => e.businessEventType === 'SURPLUS_CONVERTED' && e.targetId === plan.id).length).toBeGreaterThanOrEqual(2);
    // 히트 생산량을 넘는 연주는 막는다
    k.expectClean();
  });

  it('히트에서 나올 수 있는 매수를 넘는 연주는 막는다 (floor(히트 톤 × 연주 수율 ÷ 1매 중량))', () => {
    const k = createKit();
    const plan = k.tables.productionPlan.find((p) => p.productionPlanNo === 'PP-2609-0004');
    if (!plan) throw new Error('시드 없음');
    const heat = k.lotsOfPlan(plan.id, 'HEAT')[0];
    expectInputError(
      () => registerCasting(k.at('2026-10-01T12:00:00+09:00'), k.actor('steelmakingHead'), { productionPlanId: plan.id, heatLotId: heat.id, outputQty: 11, startedAt: '2026-10-01T10:00:00+09:00', completedAt: '2026-10-01T11:00:00+09:00' }),
      'outputQty',
    );
    registerCasting(k.at('2026-10-01T12:00:00+09:00'), k.actor('steelmakingHead'), { productionPlanId: plan.id, heatLotId: heat.id, outputQty: 10, startedAt: '2026-10-01T10:00:00+09:00', completedAt: '2026-10-01T11:00:00+09:00' });
    // 같은 히트를 두 번 연주할 수 없다 (1히트 계획은 이미 완료)
    expectInputError(() => registerCasting(k.at('2026-10-01T13:00:00+09:00'), k.actor('steelmakingHead'), { productionPlanId: plan.id, heatLotId: heat.id, outputQty: 1, startedAt: '2026-10-01T12:00:00+09:00', completedAt: '2026-10-01T12:30:00+09:00' }));
    k.expectClean();
  });

  it('배정 해제는 CONFIRMED만 (소진된 배정은 INV-004)', () => {
    const k = createKit();
    const consumed = k.tables.allocation.find((a) => a.allocationStatus === 'CONSUMED');
    if (!consumed) throw new Error('시드 없음');
    expectCode(() => releaseAllocation(k.at('2026-10-01T09:00:00+09:00'), k.actor('sales'), { allocationId: consumed.id }), 'INV-004');
  });
});
