// 생산 화면의 열연 코일 수: 불합격 코일은 '만든 코일'로 세지 않는다 (BP-QC-01, core.md '남은 일' 2).
// 코일 6개 중 1개가 불합격이면 계획은 진행중이고, 단계 표시는 '열연 6/6 완료'가 아니라 '열연 5/6 진행 중'이다.
// 쓸 수 있는 코일 수(progress.usableCoilQty)·불합격 코일 수는 서버가 계산하고, 화면은 그 값을 그대로 보인다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProductionPlanDetail } from '@/api/production';
import type { WorkContext } from '@/api/productionResults';
import type { RollingDetail } from '@/api/rolling';
import { PlanDetailBody } from '@/features/production/ProductionPlanScreen';
import { WorkBody } from '@/features/production/ProductionResultScreen';
import { RollingBody } from '@/features/production/RollingScreen';
import { PLAN_DETAIL, ROLLING_DETAIL, WORK_CONTEXT } from '@/features/production/testing/productionFixtures';
import { MeContext } from '@/hooks/useMe';
import { SEED_EMPLOYEE_NO } from '@/test/actors';
import { sessionUserOf } from '@/test/sessionUsers';

const HOT_ROLLING_NO = '2001010';

function render(employeeNo: string, element: ReactElement): string {
  const me = sessionUserOf(employeeNo);
  return renderToString(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MeContext.Provider, { value: me }, element)));
}

/** 부족 6개 코일 계획: 코일 6개를 만들었고 그중 1개가 불합격 → 쓸 수 있는 코일 5개, 계획은 진행중 */
function asCoilPlan<T extends Pick<ProductionPlanDetail, 'productionPlanStatus' | 'item' | 'formation' | 'progress'>>(plan: T): T {
  if (!plan.formation) throw new Error('편성표 없음');
  return {
    ...plan,
    productionPlanStatus: 'IN_PROGRESS',
    item: { ...plan.item, itemType: 'COIL' },
    formation: { ...plan.formation, shortageQty: 6 },
    progress: { ...plan.progress, coilQty: 6, usableCoilQty: 5 },
  };
}

describe('열연 단계의 코일 수 (불합격 코일은 세지 않는다)', () => {
  it('생산계획 상세: 코일 6개 중 1개가 불합격이면 열연 5/6 진행 중이다 (열연 6/6 완료가 아니다)', () => {
    const plan: ProductionPlanDetail = asCoilPlan(PLAN_DETAIL);
    const html = render(SEED_EMPLOYEE_NO.productionHead, createElement(PlanDetailBody, { plan }));
    expect(html).toContain('aria-label="열연 5/6 진행 중"');
    expect(html).not.toContain('열연 6/6');
  });

  it('작업 실적: 단계 표시와 열연 카드 머리글도 쓸 수 있는 코일 수로 보이고, 불합격 개수를 함께 알려 준다', () => {
    const ctx: WorkContext = { ...WORK_CONTEXT, plan: asCoilPlan(WORK_CONTEXT.plan) };
    const html = render(SEED_EMPLOYEE_NO.productionHead, createElement(WorkBody, { ctx }));
    expect(html).toContain('aria-label="열연 5/6 진행 중"');
    expect(html).not.toContain('열연 6/6');
    expect(html).toContain('코일 5/6개 (불합격 1개 제외)');
    expect(html).not.toContain('코일 6/6');
  });

  it('열연 투입 배정: 코일 수 옆에 불합격 코일 수가 보인다', () => {
    const coils = [...ROLLING_DETAIL.coils, ...ROLLING_DETAIL.coils.map((c) => ({ ...c, lotId: c.lotId + 10, lotNo: `${c.lotNo}-2` }))];
    const detail: RollingDetail = { ...ROLLING_DETAIL, plan: { ...ROLLING_DETAIL.plan, rolledQty: 5, failedCoilQty: 1 }, coils: coils.map((c, i) => (i === 0 ? { ...c, quality: 'FAIL' } : c)) };
    const html = render(HOT_ROLLING_NO, createElement(RollingBody, { detail }));
    expect(html).toContain('5/6');
    expect(html).toContain('불합격 코일 1개 제외');
    expect(html).toContain('코일 6개 (불합격 1개)');
  });

  it('불합격 코일이 없으면 불합격 문구를 내지 않는다', () => {
    const detail = ROLLING_DETAIL;
    expect(detail.plan.failedCoilQty).toBe(0);
    const html = render(HOT_ROLLING_NO, createElement(RollingBody, { detail }));
    expect(html).not.toContain('불합격 코일');
    expect(html).not.toContain('(불합격');
  });
});
