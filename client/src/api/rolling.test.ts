// 열연 투입 배정·열연 실적 api (REQ-PRD-004, REQ-INV-006·009, BP-INV-01, 14.2, 9.3 INV-001~004)
// 시드: PP-2609-0003 (SM355B 코일 6개) — 슬래브 8매 중 3매 열연(코일 3개), 적격 미배정 3매, 판정 대기 2매.
import { describe, expect, it } from 'vitest';
import { InputError } from '@/api/client';
import { rollingApi } from '@/api/rolling';
import { createSalesOrderForTest, eventsOf, lotsOfPlan, planIdOf, planOf, readDb } from '@/api/productionTestKit';
import { checkInvariants } from '@/mock/services';
import { actAs, SEED_EMPLOYEE_NO } from '@/test/actors';

const HOT_ROLLING_NO = '2001010';
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const clean = () => expect(readDb((t) => checkInvariants(t))).toEqual([]);
const pp3 = () => planIdOf('PP-2609-0003');

describe('열연 대상 조회', () => {
  it('코일 계획: 필요 매수 = 부족 − 코일 − 배정, FIFO 추천은 예약 가용 안에서만', async () => {
    actAs(HOT_ROLLING_NO);
    const plans = await rollingApi.plans();
    expect(plans.find((p) => p.productionPlanNo === 'PP-2609-0003')).toMatchObject({ shortageQty: 6, rolledQty: 3, allocatedQty: 0, neededQty: 3, rollable: true });
    const detail = await rollingApi.detail(pp3());
    expect(detail.plan.slabItem.itemCode).toBe('SL-SM355B-250x1500x10000');
    // 수주 상세 링크용 (reports/3 A-3)
    expect(detail.salesOrderId).toEqual(expect.any(Number));
    expect(detail.recommendedLotIds).toHaveLength(3);
    expect(detail.candidates.map((c) => c.fifoRank)).toEqual([1, 2, 3]);
    const fifoKeys = detail.candidates.map((c) => `${c.producedDate} ${c.lotNo}`);
    expect(fifoKeys).toEqual([...fifoKeys].sort());
    expect(detail.coils).toHaveLength(3);
    expect(detail.coils[0].lotNo.startsWith('CBOF1-')).toBe(true);

    actAs(SEED_EMPLOYEE_NO.sales);
    await expect(rollingApi.plans()).rejects.toMatchObject({ code: 'COM-002' });
  });
});

describe('배정 확정·변경·해제 (BP-INV-01)', () => {
  it('미합격 INV-002, 소진 INV-004, 이미 배정 INV-003, 사용 권한 없음 COM-002', async () => {
    const planId = pp3();
    const slabs = lotsOfPlan(planId, 'SLAB');
    const pending = slabs.find((s) => s.isPassed === null);
    const consumed = slabs.find((s) => s.lotStatus === 'CONSUMED');
    actAs(HOT_ROLLING_NO);
    await expect(rollingApi.confirm({ productionPlanId: planId, lotIds: [pending?.id ?? 0] })).rejects.toMatchObject({ code: 'INV-002' });
    await expect(rollingApi.confirm({ productionPlanId: planId, lotIds: [consumed?.id ?? 0] })).rejects.toMatchObject({ code: 'INV-004' });

    const detail = await rollingApi.detail(planId);
    const first = detail.recommendedLotIds[0];
    actAs(SEED_EMPLOYEE_NO.quality);
    await expect(rollingApi.confirm({ productionPlanId: planId, lotIds: [first] })).rejects.toMatchObject({ code: 'COM-002' });

    actAs(HOT_ROLLING_NO);
    const recommendedBefore = eventsOf('ALLOCATION_RECOMMENDED').length;
    await expect(rollingApi.confirm({ productionPlanId: planId, lotIds: [first] })).resolves.toEqual({ allocatedQty: 1 });
    expect(eventsOf('ALLOCATION_RECOMMENDED')).toHaveLength(recommendedBefore + 1);
    await expect(rollingApi.confirm({ productionPlanId: planId, lotIds: [first] })).rejects.toMatchObject({ code: 'INV-003' });
    clean();
  });

  it('14.2: 판매 예약 몫은 열연에 쓰지 않는다 — 같은 슬래브 규격 수주가 2매를 예약하면 1매만 배정할 수 있다 (INV-001)', async () => {
    await createSalesOrderForTest('CUS-03', [{ itemCode: 'SL-SM355B-250x1500x10000', orderedQty: 2, dueDate: '2026-12-01' }]);
    actAs(HOT_ROLLING_NO);
    const detail = await rollingApi.detail(pp3());
    expect(detail.plan.slabPool).toMatchObject({ eligibleQty: 3, activeReservedQty: 2, availableQty: 1 });
    expect(detail.plan.recommendableQty).toBe(1);
    expect(detail.recommendedLotIds).toHaveLength(1);
    const two = detail.candidates.slice(0, 2).map((c) => c.lotId);
    await expect(rollingApi.confirm({ productionPlanId: pp3(), lotIds: two })).rejects.toMatchObject({ code: 'INV-001' });
    await rollingApi.confirm({ productionPlanId: pp3(), lotIds: detail.recommendedLotIds });
    const after = await rollingApi.detail(pp3());
    expect(after.plan.slabPool.availableQty).toBe(0);
    clean();
  });

  it('변경은 사유가 있어야 하고, 기존 배정 해제 + 새 배정을 한 번에 한다. 해제도 된다', async () => {
    actAs(HOT_ROLLING_NO);
    const planId = pp3();
    const detail = await rollingApi.detail(planId);
    await rollingApi.confirm({ productionPlanId: planId, lotIds: [detail.recommendedLotIds[0]] });
    const allocation = (await rollingApi.detail(planId)).plan.allocations[0];
    const other = detail.recommendedLotIds[1];
    await expect(rollingApi.change({ allocationId: allocation.allocationId, newLotId: other, reasonText: ' ' })).rejects.toBeInstanceOf(InputError);
    const changedBefore = eventsOf('ALLOCATION_CHANGED').length;
    const { allocationId } = await rollingApi.change({ allocationId: allocation.allocationId, newLotId: other, reasonText: '야드 위치 때문에 가까운 슬래브로' });
    expect(eventsOf('ALLOCATION_CHANGED')).toHaveLength(changedBefore + 1);
    const rows = readDb((t) => t.allocation.filter((a) => a.id === allocation.allocationId || a.id === allocationId));
    expect(rows.map((r) => r.allocationStatus).sort()).toEqual(['CONFIRMED', 'RELEASED']);

    await rollingApi.release({ allocationId, reasonText: '계획 재검토' });
    expect(readDb((t) => t.allocation.find((a) => a.id === allocationId)?.allocationStatus)).toBe('RELEASED');
    await expect(rollingApi.release({ allocationId })).rejects.toBeInstanceOf(InputError);
    clean();
  });
});

describe('열연 실적 (슬래브 1매 → 코일 1개)', () => {
  it('배정 슬래브를 소비하고 C+슬래브번호 코일을 만든다. 코일 수가 부족 매수에 닿으면 계획 완료, 소진 배정은 바꿀 수 없다(INV-004)', async () => {
    const planId = pp3();
    actAs(HOT_ROLLING_NO);
    await expect(rollingApi.registerHotRolling({ productionPlanId: planId, startedAt: hoursAgo(2), completedAt: hoursAgo(1) })).rejects.toBeInstanceOf(InputError);
    const detail = await rollingApi.detail(planId);
    await rollingApi.confirm({ productionPlanId: planId, lotIds: detail.recommendedLotIds });
    const confirmed = await rollingApi.detail(planId);
    expect(confirmed.rollableAllocationIds).toHaveLength(3);

    actAs(SEED_EMPLOYEE_NO.quality);
    await expect(rollingApi.registerHotRolling({ productionPlanId: planId, startedAt: hoursAgo(2), completedAt: hoursAgo(1) })).rejects.toMatchObject({ code: 'COM-002' });

    actAs(HOT_ROLLING_NO);
    const result = await rollingApi.registerHotRolling({ productionPlanId: planId, startedAt: hoursAgo(2), completedAt: hoursAgo(1) });
    expect(result.coilLotNos).toHaveLength(3);
    const slabNos = confirmed.plan.allocations.map((a) => a.lotNo);
    expect(result.coilLotNos).toEqual(slabNos.map((no) => `C${no.replace(/^HT-/, '')}`));
    const coils = lotsOfPlan(planId, 'COIL');
    expect(coils).toHaveLength(6);
    expect(readDb((t) => t.qualityInspection.filter((q) => coils.some((c) => c.id === q.lotId)).length)).toBe(6);
    expect(planOf(planId).productionPlanStatus).toBe('COMPLETED');
    await expect(rollingApi.release({ allocationId: confirmed.plan.allocations[0].allocationId })).rejects.toMatchObject({ code: 'INV-004' });
    clean();
  });
});
