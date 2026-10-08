// 수주 서버 어댑터: 수주 상세의 재생산 계획 만들기는 생산계획 API(POST /production-plans)를 부른다.
import { afterEach, describe, expect, it } from 'vitest';
import { salesOrderApi } from '@/api/salesOrders';
import { fail, ok, stopFakeServer, useFakeServer } from '@/api/server/serverTestKit';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

afterEach(() => stopFakeServer());

describe('수주 서버 어댑터 (api/server/salesOrders.ts)', () => {
  it('재생산 계획: 수주 품목 id로 POST /production-plans를 부르고 여재 예약 매수·새 계획을 돌려준다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.productionHead, (c) =>
      c.method === 'POST' && c.path === '/production-plans' ? ok({ reservedFromSurplusQty: 1, plan: { id: 42, productionPlanNo: 'PP-2610-0042', shortageQty: 3 } }) : undefined,
    );
    expect(await salesOrderApi.createReproduction({ salesOrderItemId: 7 })).toEqual({ reservedFromSurplusQty: 1, productionPlanId: 42, productionPlanNo: 'PP-2610-0042', shortageQty: 3 });
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([['POST', '/production-plans', { salesOrderItemId: 7 }]]);
  });

  it('재생산 계획: 여재로 다 채워 계획을 만들지 않았으면 계획 없음, 부족 0', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.productionHead, () => ok({ reservedFromSurplusQty: 4, plan: null }));
    expect(await salesOrderApi.createReproduction({ salesOrderItemId: 7 })).toEqual({ reservedFromSurplusQty: 4, productionPlanId: null, productionPlanNo: null, shortageQty: 0 });
  });

  it('재생산 계획: 서버 오류 코드를 그대로 넘긴다 (권한 없음)', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.sales, () => fail(403, 'COM-002', '권한이 없어요'));
    await expect(salesOrderApi.createReproduction({ salesOrderItemId: 7 })).rejects.toMatchObject({ code: 'COM-002' });
  });
});
