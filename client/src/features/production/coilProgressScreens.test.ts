// 생산 화면의 열연 코일 수: 불합격 코일은 '만든 코일'로 세지 않는다 (BP-QC-01, core.md '남은 일' 2).
// 코일 6개 중 1개가 불합격이면 계획은 진행중이고, 단계 표시는 '열연 6/6 완료'가 아니라 '열연 5/6 진행 중'이다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { inspectionApi } from '@/api/inspections';
import { productionPlanApi } from '@/api/production';
import { lotsOfPlan, planIdOf, planOf } from '@/api/productionTestKit';
import { productionResultApi } from '@/api/productionResults';
import { rollingApi } from '@/api/rolling';
import { sessionApi } from '@/api/session';
import { PlanDetailBody } from '@/features/production/ProductionPlanScreen';
import { WorkBody } from '@/features/production/ProductionResultScreen';
import { RollingBody } from '@/features/production/RollingScreen';
import { MeContext } from '@/hooks/useMe';
import { actAs, SEED_EMPLOYEE_NO } from '@/test/actors';

const HOT_ROLLING_NO = '2001010';
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

async function render(employeeNo: string, element: ReactElement): Promise<string> {
  const employeeId = actAs(employeeNo);
  const me = await sessionApi.getSessionUser(employeeId);
  return renderToString(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MeContext.Provider, { value: me }, element)));
}

/**
 * 시드 코일 계획 PP-2609-0003(부족 6개, 시드 코일 3개): 첫 코일을 불합격으로 고치고 추천 슬래브 3매를 더 열연한다.
 * → 코일 6개 중 불합격 1개, 쓸 수 있는 코일 5개 < 부족 6개 (계획은 진행중)
 */
async function failOneCoilAndRollMore(): Promise<number> {
  const planId = planIdOf('PP-2609-0003');
  actAs(SEED_EMPLOYEE_NO.quality);
  const firstCoil = lotsOfPlan(planId, 'COIL')[0];
  if (!firstCoil) throw new Error('시드 코일이 없어요');
  const form = await inspectionApi.detail(firstCoil.id);
  const strength = form.items.find((item) => item.inspectionItemCode === 'YIELD_STRENGTH');
  if (!strength) throw new Error('항복강도 항목이 없어요');
  const outcome = await inspectionApi.register({ lotId: firstCoil.id, values: [{ inspectionStandardItemId: strength.inspectionStandardItemId, measuredValue: '1' }], expectedUpdatedAt: form.updatedAt });
  expect(outcome.inspectionResult).toBe('FAIL');

  actAs(HOT_ROLLING_NO);
  const detail = await rollingApi.detail(planId);
  await rollingApi.confirm({ productionPlanId: planId, lotIds: detail.recommendedLotIds });
  await rollingApi.registerHotRolling({ productionPlanId: planId, startedAt: hoursAgo(2), completedAt: hoursAgo(1) });
  return planId;
}

describe('열연 단계의 코일 수 (불합격 코일은 세지 않는다)', () => {
  it('생산계획 상세: 코일 6개 중 1개가 불합격이면 열연 5/6 진행 중이다 (열연 6/6 완료가 아니다)', async () => {
    const planId = await failOneCoilAndRollMore();
    expect(planOf(planId).productionPlanStatus).toBe('IN_PROGRESS');
    actAs(SEED_EMPLOYEE_NO.productionHead);
    const plan = await productionPlanApi.detail(planId);
    expect(plan.progress).toMatchObject({ coilQty: 6, usableCoilQty: 5 });

    const html = await render(SEED_EMPLOYEE_NO.productionHead, createElement(PlanDetailBody, { plan }));
    expect(html).toContain('aria-label="열연 5/6 진행 중"');
    expect(html).not.toContain('열연 6/6');
  });

  it('작업 실적: 단계 표시와 열연 카드 머리글도 쓸 수 있는 코일 수로 보이고, 불합격 개수를 함께 알려 준다', async () => {
    const planId = await failOneCoilAndRollMore();
    actAs(SEED_EMPLOYEE_NO.productionHead);
    const ctx = await productionResultApi.work(planId);

    const html = await render(SEED_EMPLOYEE_NO.productionHead, createElement(WorkBody, { ctx }));
    expect(html).toContain('aria-label="열연 5/6 진행 중"');
    expect(html).not.toContain('열연 6/6');
    expect(html).toContain('코일 5/6개 (불합격 1개 제외)');
    expect(html).not.toContain('코일 6/6');
  });

  it('열연 투입 배정: 코일 수 옆에 불합격 코일 수가 보인다 (목록 행 값은 api가 넘긴다)', async () => {
    const planId = await failOneCoilAndRollMore();
    actAs(SEED_EMPLOYEE_NO.productionHead);
    const row = (await rollingApi.plans()).find((p) => p.productionPlanId === planId);
    expect(row).toMatchObject({ rolledQty: 5, failedCoilQty: 1, shortageQty: 6 });

    const detail = await rollingApi.detail(planId);
    const html = await render(HOT_ROLLING_NO, createElement(RollingBody, { detail }));
    expect(html).toContain('5/6');
    expect(html).toContain('불합격 코일 1개 제외');
    expect(html).toContain('코일 6개 (불합격 1개)');
  });

  it('불합격 코일이 없으면 불합격 문구를 내지 않는다', async () => {
    actAs(SEED_EMPLOYEE_NO.productionHead);
    const planId = planIdOf('PP-2609-0003');
    const detail = await rollingApi.detail(planId);
    expect(detail.plan.failedCoilQty).toBe(0);
    const html = await render(HOT_ROLLING_NO, createElement(RollingBody, { detail }));
    expect(html).not.toContain('불합격 코일');
    expect(html).not.toContain('(불합격');
  });
});
