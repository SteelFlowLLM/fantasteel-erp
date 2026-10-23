// 열연 투입 서버 어댑터(api/server/production.ts serverRollingApi): 화면 모양, 확정 순서(추천 → 배정), 변경·해제 경로와 사유.
import type { HotRollingDetail as ServerHotRollingDetail, HotRollingPlanListItem } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { rollingApi } from '@/api/rolling';
import { ok, page, stopFakeServer, useFakeServer } from '@/api/server/serverTestKit';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

afterEach(() => stopFakeServer());

const allocation = (allocationId: number, lotId: number, isRollable: boolean, allocationStatus = 'CONFIRMED') => ({
  allocationId,
  lotId,
  lotNo: `SL-${lotId}`,
  producedDate: '2026-10-04',
  heatNo: 'HT-BOF1-261004-001',
  sourcePlanNo: 'PP-2610-0001',
  confirmedAt: '2026-10-05T01:00:00.000Z',
  allocationStatus,
  isRollable,
});
const candidate = (lotId: number, isRecommended: boolean) => ({ lotId, lotNo: `SL-${lotId}`, producedDate: '2026-10-04', heatNo: 'HT-BOF1-261004-001', sourcePlanNo: 'PP-2610-0001', isOwnPlan: true, yardName: '슬래브 야드', fifoRank: lotId, isRecommended });

// 어댑터가 읽는 칸만 채운다
const hotRolling = (rollingAllocations = [allocation(701, 11, true), allocation(702, 12, false)]) =>
  ({
    plan: { id: 400, productionPlanNo: 'PP-2610-0002', productionPlanStatus: 'IN_PROGRESS', salesOrderId: 60, salesOrderNo: 'SO-2610-002', dueDate: '2026-10-30' },
    coilItem: { id: 21, itemCode: 'CL-SM355A-4.5x1500x544000', itemName: 'SM355A 코일', theoreticalWeightTon: '28.818' },
    slabItem: { id: 22, itemCode: 'SL-SM355A-250x1500x10000', itemName: 'SM355A 슬래브', theoreticalWeightTon: '29.438' },
    shortageQty: 6,
    usableCoilQty: 1,
    failedCoilQty: 1,
    confirmedAllocationQty: 2,
    neededQty: 3,
    slabPool: { onHandQty: 8, reservedQty: 6, rollingAllocatedQty: 2, availableQty: 0 },
    recommendableQty: 1,
    isRollable: true,
    notRollableReason: null,
    rollingAllocations,
    candidates: [candidate(13, true), candidate(14, false)],
    results: [],
    coils: [
      { lotId: 31, lotNo: 'CL-31', parentSlabNo: 'SL-9', producedDate: '2026-10-06', lotType: 'COIL', inspectionResult: 'FAIL', heatInspectionResult: 'PASS', lotStatus: 'AVAILABLE', hasConfirmedAllocation: false },
      { lotId: 32, lotNo: 'CL-32', parentSlabNo: 'SL-10', producedDate: '2026-10-06', lotType: 'COIL', inspectionResult: 'PASS', heatInspectionResult: 'PASS', lotStatus: 'AVAILABLE', hasConfirmedAllocation: true },
    ],
  }) as unknown as ServerHotRollingDetail;

describe('열연 투입 서버 어댑터', () => {
  it('목록: 서버 열연 투입 목록 한 번으로 코일 계획 줄을 만들고(완료·취소 포함), 계획마다 상세를 부르지 않는다. 슬래브 규격을 못 정한 계획은 뺀다', async () => {
    const item = (id: number, productionPlanStatus: string, over: Partial<HotRollingPlanListItem> = {}) =>
      ({
        plan: { id, productionPlanNo: `PP-2610-000${id}`, productionPlanStatus, salesOrderNo: 'SO-2610-002', dueDate: '2026-10-30', itemCode: 'CL-SM355A-4.5x1500x544000' },
        slabItemCode: 'SL-SM355A-250x1500x10000',
        shortageQty: 6,
        usableCoilQty: 1,
        failedCoilQty: 1,
        confirmedAllocationQty: 2,
        neededQty: 3,
        isRollable: productionPlanStatus === 'IN_PROGRESS',
        ...over,
      }) as unknown as HotRollingPlanListItem;
    const calls = useFakeServer(SEED_EMPLOYEE_NO.productionHead, (c) =>
      c.path === '/production-plans/hot-rolling' ? ok(page([item(4, 'IN_PROGRESS'), item(3, 'COMPLETED'), item(2, 'CANCELLED', { slabItemCode: null })])) : undefined,
    );
    const rows = await rollingApi.plans();
    expect(rows.map((r) => [r.productionPlanId, r.productionPlanStatus, r.rollable])).toEqual([
      [4, 'IN_PROGRESS', true],
      [3, 'COMPLETED', false],
    ]);
    expect(rows[0]).toEqual({
      productionPlanId: 4,
      productionPlanNo: 'PP-2610-0004',
      productionPlanStatus: 'IN_PROGRESS',
      salesOrderNo: 'SO-2610-002',
      dueDate: '2026-10-30',
      coilItemCode: 'CL-SM355A-4.5x1500x544000',
      slabItemCode: 'SL-SM355A-250x1500x10000',
      shortageQty: 6,
      rolledQty: 1,
      failedCoilQty: 1,
      allocatedQty: 2,
      neededQty: 3,
      rollable: true,
    });
    expect(calls.map((c) => c.path)).toEqual(['/production-plans/hot-rolling']);
  });

  it('상세: 추천 LOT·열연할 수 있는 배정·코일 품질을 화면 모양으로 바꾼다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.productionHead, (c) => (c.path === '/production-plans/400/hot-rolling' ? ok(hotRolling()) : undefined));
    const detail = await rollingApi.detail(400);
    expect(detail.recommendedLotIds).toEqual([13]);
    expect(detail.rollableAllocationIds).toEqual([701]);
    expect(detail.plan).toMatchObject({ productionPlanId: 400, allocatedQty: 2, rolledQty: 1, neededQty: 3, slabPool: { eligibleQty: 8, activeReservedQty: 6, hotRollingConfirmedQty: 2 } });
    expect(detail.coils.map((c) => [c.lotNo, c.slabNo, c.quality])).toEqual([
      ['CL-31', 'SL-9', 'FAIL'],
      ['CL-32', 'SL-10', 'PASS'],
    ]);
  });

  it('확정은 추천(작업 로그)을 먼저 부르고 고른 슬래브를 배정한다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.productionHead, () => ok(hotRolling()));
    expect(await rollingApi.confirm({ productionPlanId: 400, lotIds: [13] })).toEqual({ allocatedQty: 1 });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /production-plans/400/hot-rolling/recommend', 'POST /production-plans/400/hot-rolling/allocations']);
    expect(calls[1].body).toEqual({ lotIds: [13] });
  });

  it('변경은 배정의 계획을 찾아 새 슬래브와 사유로 해제하고 새 배정 id를 돌려준다. 해제는 빈 사유를 보내지 않는다', async () => {
    const changed = hotRolling([allocation(701, 11, false, 'RELEASED'), allocation(703, 14, true)]);
    const calls = useFakeServer(SEED_EMPLOYEE_NO.productionHead, (c) => (c.method === 'GET' ? ok(hotRolling()) : ok(changed)));
    await rollingApi.detail(400);
    expect(await rollingApi.change({ allocationId: 701, newLotId: 14, reasonText: '  표면 결함 슬래브 교체 ' })).toEqual({ allocationId: 703 });
    expect(calls[1]).toMatchObject({ path: '/production-plans/400/hot-rolling/allocations/701/release', body: { newLotId: 14, reason: '표면 결함 슬래브 교체' } });

    await rollingApi.release({ allocationId: 702, reasonText: '   ' });
    expect(calls[2]).toMatchObject({ path: '/production-plans/400/hot-rolling/allocations/702/release', body: {} });
  });
});
