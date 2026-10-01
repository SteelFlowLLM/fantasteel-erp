// 생산 화면 렌더 확인: 시드 데이터로 상세 본문을 서버 렌더(renderToString)해서 런타임 오류 없이 그려지는지,
// 사용 권한이 없으면 읽기 전용 표시가 나오는지 본다 (브라우저 없이 Vitest node 환경).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { productionPlanApi } from '@/api/production';
import { planIdOf } from '@/api/productionTestKit';
import { productionResultApi } from '@/api/productionResults';
import { rollingApi } from '@/api/rolling';
import { sessionApi } from '@/api/session';
import { PlanDetailBody } from '@/features/production/ProductionPlanScreen';
import { WorkBody } from '@/features/production/ProductionResultScreen';
import { RollingBody } from '@/features/production/RollingScreen';
import { MeContext } from '@/hooks/useMe';
import { actAs, SEED_EMPLOYEE_NO } from '@/test/actors';

async function render(employeeNo: string, element: ReactElement): Promise<string> {
  const employeeId = actAs(employeeNo);
  const me = await sessionApi.getSessionUser(employeeId);
  const client = new QueryClient();
  return renderToString(createElement(QueryClientProvider, { client }, createElement(MeContext.Provider, { value: me }, element)));
}

describe('생산 화면 렌더', () => {
  it('생산계획 상세: 편성표·히트·재생산 필요 띠, 영업(조회만)은 읽기 전용', async () => {
    actAs(SEED_EMPLOYEE_NO.productionHead);
    const plan = await productionPlanApi.detail(planIdOf('PP-2609-0005'));
    const html = await render(SEED_EMPLOYEE_NO.productionHead, createElement(PlanDetailBody, { plan }));
    expect(html).toContain('PP-2609-0005');
    expect(html).toContain('필요 용강량');
    expect(html).toContain('재생산 필요');
    expect(html).not.toContain('조회만 할 수 있어요');
    const readOnly = await render(SEED_EMPLOYEE_NO.sales, createElement(PlanDetailBody, { plan }));
    expect(readOnly).toContain('조회만 할 수 있어요');
  });

  it('작업 실적: 공정별 묶음과 연주 대기 히트, 품질(조회만)은 읽기 전용', async () => {
    actAs(SEED_EMPLOYEE_NO.productionHead);
    const ctx = await productionResultApi.work(planIdOf('PP-2609-0004'));
    const html = await render(SEED_EMPLOYEE_NO.productionHead, createElement(WorkBody, { ctx }));
    for (const word of ['제선', '제강', '연주', '실적 시뮬레이션', 'HM-BF2-260918-01']) expect(html).toContain(word);
    expect(html).not.toContain('공정 실적');
    const readOnly = await render(SEED_EMPLOYEE_NO.quality, createElement(WorkBody, { ctx }));
    expect(readOnly).toContain('조회만 할 수 있어요');
  });

  it('열연 투입 배정: 슬래브 풀·FIFO 추천·코일', async () => {
    actAs(SEED_EMPLOYEE_NO.productionHead);
    const detail = await rollingApi.detail(planIdOf('PP-2609-0003'));
    const html = await render('2001010', createElement(RollingBody, { detail }));
    for (const word of ['FIFO 추천', '예약 가용', '확정 배정', '열연 실적', 'SL-SM355B-250x1500x10000']) expect(html).toContain(word);
    expect(html).not.toContain('귀속');
    const readOnly = await render(SEED_EMPLOYEE_NO.admin, createElement(RollingBody, { detail }));
    expect(readOnly).toContain('조회만 할 수 있어요');
  });
});
