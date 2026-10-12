// 생산계획 서버 어댑터의 히트 편성 확정: POST production-plans/:id/confirm, 화면을 연 뒤 바뀌었으면 서버를 부르기 전에 COM-001.
import type { ProductionPlanDetail as ServerPlanDetail } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { productionPlanApi } from '@/api/production';
import { ok, stopFakeServer, useFakeServer } from '@/api/server/serverTestKit';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

// 어댑터가 읽는 칸만 채운다
const detail = { id: 300, productionPlanNo: 'PP-2610-0001', heatCount: 3, updatedAt: '2026-10-12T01:00:00.000Z' } as ServerPlanDetail;

afterEach(() => stopFakeServer());

describe('생산계획 서버 어댑터 (api/server/production.ts) — 히트 편성 확정', () => {
  it('confirm을 부르고 저장된 히트 수를 돌려준다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.productionHead, (c) => (c.method === 'POST' && c.path === '/production-plans/300/confirm' ? ok(detail) : undefined));
    const result = await productionPlanApi.confirmHeatPlan({ productionPlanId: 300 });
    expect(result).toEqual({ id: 300, productionPlanNo: 'PP-2610-0001', heatCount: 3 });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /production-plans/300/confirm']);
  });

  it('화면을 연 뒤 계획이 바뀌었으면 confirm을 부르지 않고 COM-001', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.productionHead, (c) => (c.method === 'GET' && c.path === '/production-plans/300' ? ok(detail) : undefined));
    await expect(productionPlanApi.confirmHeatPlan({ productionPlanId: 300, expectedUpdatedAt: '2026-10-12T00:00:00.000Z' })).rejects.toMatchObject({ code: 'COM-001' });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /production-plans/300']);
  });
});
