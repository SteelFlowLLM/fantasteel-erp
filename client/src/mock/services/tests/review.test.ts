// 검토 반영 (core): 코일 불합격 뒤 재열연·재생산, 잔여 목표의 슬래브 예약 가용 한도, 연결 해제 계획 완료,
// MRP 기간과 순소요, 여재 표시 시점, 재요청 승인 부서, 라우팅 수율 오류 문구.
import { describe, expect, it } from 'vitest';
import type { ApiError } from '@/api/errors';
import { updateRow } from '@/mock/store';
import {
  canApproveRequisition,
  cancelSalesOrder,
  computeMrp,
  confirmRollingAllocations,
  createReproductionPlan,
  createSalesOrder,
  itemShortageOf,
  planProgressOf,
  registerHotRolling,
  rejectPurchaseRequisition,
  resubmitPurchaseRequisition,
  approvePurchaseRequisition,
  rollingPlanView,
  rollingRecommendation,
  routingYieldOf,
} from '@/mock/services';
import { createKit, expectCode, type Kit } from '@/mock/services/tests/kit';

const COIL_PLAN_NO = 'PP-2609-0003';
const COIL_SLAB_SPEC = 'SL-SM355B-250x1500x10000';

function seedCoilPlan(k: Kit) {
  const plan = k.tables.productionPlan.find((p) => p.productionPlanNo === COIL_PLAN_NO);
  const soItem = k.tables.salesOrderItem.find((i) => i.id === plan?.salesOrderItemId);
  if (!plan || !soItem) throw new Error('시드 코일 계획 없음');
  const currentPlan = () => k.tables.productionPlan.find((p) => p.id === plan.id) ?? plan;
  const shortage = () => itemShortageOf(k.tables, soItem);
  return { plan, soItem, currentPlan, shortage };
}

/** 이 계획의 판정 대기 슬래브를 합격시킨다 (히트는 시드에서 이미 합격) */
function passPendingSlabs(k: Kit, planId: number, iso: string): void {
  for (const slab of k.lotsOfPlan(planId, 'SLAB').filter((s) => s.isPassed === null)) k.inspect(iso, slab.id);
}

/** FIFO 추천을 확정하고 열연한 뒤 새 코일을 검사한다 (failFirst: 첫 코일만 항복강도 불합격) */
function rollRecommended(k: Kit, planId: number, day: string, options: { failFirst?: boolean; count?: number } = {}) {
  const lotIds = rollingRecommendation(k.tables, planId)
    .lots.map((l) => l.lotId)
    .slice(0, options.count);
  confirmRollingAllocations(k.at(`${day}T09:00:00+09:00`), k.actor('hotRollingHead'), { productionPlanId: planId, lotIds });
  const { coilLots } = registerHotRolling(k.at(`${day}T12:00:00+09:00`), k.actor('hotRollingHead'), {
    productionPlanId: planId,
    startedAt: `${day}T10:00:00+09:00`,
    completedAt: `${day}T11:30:00+09:00`,
  });
  coilLots.forEach((coil, index) => k.inspect(`${day}T14:00:00+09:00`, coil.id, options.failFirst && index === 0 ? { YIELD_STRENGTH: '354.9' } : {}));
  return coilLots;
}

describe('코일 불합격 → 같은 계획에서 다시 열연 (BP-QC-01, REQ-PRD-004·006)', () => {
  it('불합격 코일은 만든 코일로 세지 않는다: 계획은 진행중으로 남고 모자란 1개를 다시 열연해 채운다', () => {
    const k = createKit();
    const { plan, currentPlan, shortage } = seedCoilPlan(k);
    // 시드 코일 3개 중 1개를 불합격으로 고친다 → 그 수주 예약 1 해제
    const firstCoil = k.lotsOfPlan(plan.id, 'COIL')[0];
    k.inspect('2026-10-01T09:00:00+09:00', firstCoil.id, { YIELD_STRENGTH: '354.9' });
    expect(shortage()).toMatchObject({ activeReservedQty: 2, unsecuredQty: 4 });
    expect(rollingPlanView(k.tables, plan.id)).toMatchObject({ rolledQty: 2, failedCoilQty: 1, neededQty: 4 });

    passPendingSlabs(k, plan.id, '2026-10-01T10:00:00+09:00');
    // 불합격 몫까지 4매를 추천한다. 3매만 먼저 열연한다
    expect(rollingPlanView(k.tables, plan.id)).toMatchObject({ neededQty: 4, recommendableQty: 4 });
    rollRecommended(k, plan.id, '2026-10-02', { count: 3 });
    // 코일 6개 중 불합격 1 → 쓸 수 있는 코일 5 < 부족 6 → 완료가 아니다, 1매 더 열연할 수 있다
    expect(currentPlan().productionPlanStatus).toBe('IN_PROGRESS');
    expect(planProgressOf(k.tables, currentPlan())).toMatchObject({ coilQty: 6, usableCoilQty: 5, outputComplete: false, remainingTargetQty: 1 });
    expect(rollingPlanView(k.tables, plan.id)).toMatchObject({ rolledQty: 5, failedCoilQty: 1, neededQty: 1, recommendableQty: 1, rollable: true });
    expect(shortage()).toMatchObject({ unsecuredQty: 1, openPlanRemainingQty: 1, additionalPlanQty: 0 });

    rollRecommended(k, plan.id, '2026-10-03');
    expect(currentPlan().productionPlanStatus).toBe('COMPLETED');
    expect(shortage()).toMatchObject({ activeReservedQty: 6, unsecuredQty: 0, additionalPlanQty: 0 });
    // 열연하지 않고 남은 자기 슬래브 1매는 계획 완료로 여재
    const leftover = k.lotsOfPlan(plan.id, 'SLAB').filter((s) => s.lotStatus === 'AVAILABLE');
    expect(leftover).toHaveLength(1);
    expect(leftover[0].surplusAt).not.toBeNull();
    k.expectClean();
  });

  it('완료된 뒤 코일이 불합격되면 재생산할 수 있다 (완료 계획은 더 열연하지 않으므로 남은 슬래브를 잔여 목표로 세지 않는다)', () => {
    const k = createKit();
    const { plan, soItem, currentPlan, shortage } = seedCoilPlan(k);
    const lotIds = rollingRecommendation(k.tables, plan.id).lots.map((l) => l.lotId);
    confirmRollingAllocations(k.at('2026-10-01T09:00:00+09:00'), k.actor('hotRollingHead'), { productionPlanId: plan.id, lotIds });
    const { coilLots } = registerHotRolling(k.at('2026-10-01T12:00:00+09:00'), k.actor('hotRollingHead'), {
      productionPlanId: plan.id,
      startedAt: '2026-10-01T10:00:00+09:00',
      completedAt: '2026-10-01T11:30:00+09:00',
    });
    // 코일 6개(판정 대기 3 포함) → 완료
    expect(currentPlan().productionPlanStatus).toBe('COMPLETED');
    coilLots.forEach((coil, index) => k.inspect('2026-10-01T14:00:00+09:00', coil.id, index === 0 ? { YIELD_STRENGTH: '354.9' } : {}));
    // 판정 대기였던 자기 슬래브 2매가 나중에 합격해도 완료 계획은 열연하지 않는다 → 여재
    passPendingSlabs(k, plan.id, '2026-10-01T15:00:00+09:00');
    expect(k.lotsOfPlan(plan.id, 'SLAB').filter((s) => s.lotStatus === 'AVAILABLE').every((s) => s.surplusAt !== null)).toBe(true);
    expect(planProgressOf(k.tables, currentPlan()).remainingTargetQty).toBe(0);
    expect(shortage()).toMatchObject({ unsecuredQty: 1, openPlanRemainingQty: 0, additionalPlanQty: 1, reproductionNeedQty: 1 });

    const { plan: reproduction } = createReproductionPlan(k.at('2026-10-01T16:00:00+09:00'), k.actor('productionHead'), { salesOrderItemId: soItem.id });
    expect(reproduction).toMatchObject({ isReproduction: true, shortageQty: 1, salesOrderItemId: soItem.id });
    // 재생산 코일 계획은 남은 여재 슬래브로 열연할 수 있다
    expect(rollingPlanView(k.tables, reproduction?.id ?? 0)).toMatchObject({ neededQty: 1, recommendableQty: 1 });
    k.expectClean();
  });
});

describe('잔여 목표는 슬래브 예약 가용 안에서만 자기 슬래브를 센다 (4.5, REQ-INV-008)', () => {
  it('다른 수주가 자기 적격 슬래브를 예약으로 가져가면 그만큼 추가 계획 필요 → 재생산할 수 있다', () => {
    const k = createKit();
    const { plan, soItem, shortage } = seedCoilPlan(k);
    expect(shortage()).toMatchObject({ unsecuredQty: 3, openPlanRemainingQty: 3, additionalPlanQty: 0 });
    const other = createSalesOrder(k.at('2026-10-01T09:00:00+09:00'), k.actor('sales'), {
      customerId: k.customerId('CUS-01'),
      items: [{ itemId: k.itemId(COIL_SLAB_SPEC), orderedQty: 3, dueDate: '2026-10-30' }],
    });
    expect(other.reservations.map((r) => r.reservedQty)).toEqual([3]);
    expect(rollingPlanView(k.tables, plan.id)).toMatchObject({ neededQty: 3, recommendableQty: 0 });
    // 판정 대기 2매는 아직 합격해 열연할 수 있다 → 잔여 목표 2, 추가 계획 필요 1
    expect(planProgressOf(k.tables, plan)).toMatchObject({ ownRollableSlabQty: 5, ownAllocatableSlabQty: 2, remainingTargetQty: 2 });
    expect(shortage()).toMatchObject({ unsecuredQty: 3, openPlanRemainingQty: 2, additionalPlanQty: 1, reproductionNeedQty: 1 });
    const { plan: reproduction } = createReproductionPlan(k.at('2026-10-01T10:00:00+09:00'), k.actor('productionHead'), { salesOrderItemId: soItem.id });
    expect(reproduction).toMatchObject({ isReproduction: true, shortageQty: 1 });
    expect(shortage()).toMatchObject({ additionalPlanQty: 0 });

    // 판정 대기 2매가 합격해 열연 → 원래 계획 몫은 채워지고 재생산 계획 몫 1이 남는다
    passPendingSlabs(k, plan.id, '2026-10-02T09:00:00+09:00');
    rollRecommended(k, plan.id, '2026-10-03');
    expect(shortage()).toMatchObject({ unsecuredQty: 1, additionalPlanQty: 0 });
    expect(planProgressOf(k.tables, plan).remainingTargetQty).toBe(0);
    k.expectClean();
  });
});

describe('수주 취소로 연결이 끊긴 진행 계획의 완료 (10장, BP-SO-02)', () => {
  it('모든 히트를 연주한 코일 계획은 연결 해제와 함께 COMPLETED, 연주 전 계획은 진행중', () => {
    const k = createKit();
    const so = k.tables.salesOrder.find((s) => s.salesOrderNo === 'SO-2609-003');
    if (!so) throw new Error('시드 없음');
    cancelSalesOrder(k.at('2026-10-01T09:00:00+09:00'), k.actor('salesHead'), { salesOrderId: so.id, cancelReason: '고객사 프로젝트 취소' });
    const coilPlan = k.tables.productionPlan.find((p) => p.productionPlanNo === COIL_PLAN_NO);
    const slabPlan = k.tables.productionPlan.find((p) => p.productionPlanNo === 'PP-2609-0004');
    expect(coilPlan).toMatchObject({ productionPlanStatus: 'COMPLETED', salesOrderItemId: null, isSurplusOnCompletion: true });
    expect(slabPlan).toMatchObject({ productionPlanStatus: 'IN_PROGRESS', salesOrderItemId: null });
    // 남은 적격 슬래브는 여재, 판정 대기 슬래브는 합격한 뒤 여재
    const slabs = k.lotsOfPlan(coilPlan?.id ?? 0, 'SLAB').filter((s) => s.lotStatus === 'AVAILABLE');
    expect(slabs.filter((s) => s.isPassed === true).every((s) => s.surplusAt !== null)).toBe(true);
    expect(slabs.filter((s) => s.isPassed === null).every((s) => s.surplusAt === null)).toBe(true);
    passPendingSlabs(k, coilPlan?.id ?? 0, '2026-10-01T10:00:00+09:00');
    expect(k.lotsOfPlan(coilPlan?.id ?? 0, 'SLAB').filter((s) => s.lotStatus === 'AVAILABLE').every((s) => s.surplusAt !== null)).toBe(true);
    expect(rollingPlanView(k.tables, coilPlan?.id ?? 0)).toMatchObject({ rollable: false });
    k.expectClean();
  });
});

describe('MRP: 기간은 보여 줄 때만 거른다 (BP-PRD-01 시점별 가용 공급 차감)', () => {
  it('기간 앞의 아직 못 만든 계획도 먼저 잔량을 쓰므로 기간을 바꿔도 같은 계획의 순소요가 같다', () => {
    const k = createKit();
    const slab = k.itemId('SL-SS275-250x1200x10000');
    const a = createSalesOrder(k.at('2026-10-01T09:00:00+09:00'), k.actor('sales'), { customerId: k.customerId('CUS-01'), items: [{ itemId: slab, orderedQty: 10, dueDate: '2026-10-10' }] });
    const b = createSalesOrder(k.at('2026-10-01T09:10:00+09:00'), k.actor('sales'), { customerId: k.customerId('CUS-02'), items: [{ itemId: slab, orderedQty: 10, dueDate: '2026-10-25' }] });
    const planA = a.productionPlans[0];
    const planB = b.productionPlans[0];
    const wide = computeMrp(k.tables, { from: '2026-10-01', to: '2026-10-31' });
    const narrow = computeMrp(k.tables, { from: '2026-10-15', to: '2026-10-31' });
    expect(wide.plans.map((p) => p.productionPlanId)).toEqual([planA.id, planB.id]);
    expect(narrow.plans.map((p) => p.productionPlanId)).toEqual([planB.id]);
    const materialsOf = (view: ReturnType<typeof computeMrp>) => view.plans.find((p) => p.productionPlanId === planB.id)?.materials;
    expect(materialsOf(narrow)).toEqual(materialsOf(wide));
    // 철광석 633.330t 중 444.445t를 앞 계획이 쓴다 → 뒤 계획 순소요 255.560t
    const ore = k.itemId('ORE01');
    expect(materialsOf(narrow)?.find((m) => m.itemId === ore)).toMatchObject({ grossTon: '444.445', netTon: '255.560' });
    expect(narrow.requisitionLines.filter((l) => l.productionPlanId === planA.id)).toEqual([]);
    expect(narrow.requisitionLines.some((l) => l.productionPlanId === planB.id && l.itemId === ore && l.netTon === '255.560')).toBe(true);
  });
});

describe('재요청 승인 부서 (REQ-AUTH-004·REQ-PUR-002)', () => {
  it('반려 뒤 부서를 옮겨 다시 요청하면 요청 부서가 지금 소속으로 바뀌고, 알림을 받은 새 부서장이 승인한다', () => {
    const k = createKit();
    const pr = k.tables.purchaseRequisition.find((p) => p.purchaseRequisitionNo === 'PR-2609-0004');
    if (!pr) throw new Error('시드 없음');
    rejectPurchaseRequisition(k.at('2026-10-01T09:00:00+09:00'), k.actor('purchaseHead'), { purchaseRequisitionId: pr.id, rejectReason: '수량 다시 확인' });
    // 요청자(구매 담당)를 영업 부서로 옮긴다
    const salesHeadId = k.actor('salesHead').employeeId;
    const salesDepartmentId = k.tables.department.find((d) => d.headEmployeeId === salesHeadId)?.id ?? 0;
    updateRow(k.at('2026-10-01T09:30:00+09:00'), 'employee', pr.requesterId, { departmentId: salesDepartmentId });
    const resubmitted = resubmitPurchaseRequisition(k.at('2026-10-01T10:00:00+09:00'), k.actor('purchase'), {
      purchaseRequisitionId: pr.id,
      requestReason: '석회석 재고 보충 (수량 확인)',
      items: [{ itemId: k.itemId('LIM01'), requiredTon: '60' }],
    });
    expect(resubmitted).toMatchObject({ purchaseRequisitionStatus: 'WAITING_APPROVAL', departmentId: salesDepartmentId });
    const notified = k.tables.notification.filter((n) => n.notificationType === 'APPROVAL_REQUESTED' && n.linkPath === `/approvals?pr=${pr.id}`).at(-1);
    expect(notified?.recipientId).toBe(salesHeadId);
    expect(canApproveRequisition(k.tables, salesHeadId, resubmitted)).toBe(true);
    expectCode(() => approvePurchaseRequisition(k.at('2026-10-01T11:00:00+09:00'), k.actor('purchaseHead'), { purchaseRequisitionId: pr.id }), 'COM-002');
    expect(approvePurchaseRequisition(k.at('2026-10-01T11:10:00+09:00'), k.actor('salesHead'), { purchaseRequisitionId: pr.id }).purchaseRequisitionStatus).toBe('APPROVED');
  });
});

describe('오류 문구는 공통 코드 표시명을 쓴다', () => {
  it('라우팅 계획 수율이 없으면 MST-001 + 품목 유형·공정 표시명', () => {
    const k = createKit();
    const t = k.tables;
    t.routing.splice(0, t.routing.length, ...t.routing.filter((r) => !(r.itemType === 'SLAB' && r.processType === 'CONTINUOUS_CASTING')));
    let caught: ApiError | null = null;
    try {
      routingYieldOf(t, 'SLAB', 'CONTINUOUS_CASTING');
    } catch (error) {
      caught = error as ApiError;
    }
    expect(caught).toMatchObject({ code: 'MST-001', detail: '라우팅 계획 수율(슬래브 연주)' });
  });
});
