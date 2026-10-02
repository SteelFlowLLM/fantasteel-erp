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
import { lotStateText } from '@/features/production/components/PlanBadges';
import { inspectionHrefOf } from '@/features/production/components/PlanLotsCard';
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
    expect(html).toContain('열연 완료 / 부족 매수');
    expect(html).toContain('수주 상세');
    const readOnly = await render(SEED_EMPLOYEE_NO.admin, createElement(RollingBody, { detail }));
    expect(readOnly).toContain('조회만 할 수 있어요');
  });
});

describe('생산 LOT 표 (검토 반영)', () => {
  it('판정 대기 LOT은 숫자 LOT id로 검사 입력에 가고, 히트만 판정 대기면 히트의 검사로 간다', () => {
    expect(inspectionHrefOf({ id: 11, quality: 'PENDING', heatLotId: 3 })).toBe('/quality/inspections?lot=11');
    expect(inspectionHrefOf({ id: 11, quality: 'HEAT_PENDING', heatLotId: 3 })).toBe('/quality/inspections?lot=3');
    expect(inspectionHrefOf({ id: 11, quality: 'PASS', heatLotId: 3 })).toBeNull();
  });

  it("여재는 미배정 '합격' 슬래브만 (REQ-INV-008): 여재 표시가 있어도 불합격·판정 대기면 여재로 보이지 않는다", () => {
    const slab = { dispositionStatus: null, lotStatus: 'AVAILABLE' as const, allocationPurpose: null, surplusAt: '2026-10-01T00:00:00.000Z', lotType: 'SLAB' as const };
    expect(lotStateText({ ...slab, quality: 'PASS' })).toBe('여재');
    expect(lotStateText({ ...slab, quality: 'FAIL' })).not.toBe('여재');
    expect(lotStateText({ ...slab, quality: 'PENDING' })).not.toBe('여재');
  });

  it('작업 실적: 작업 시작만 한 공정은 실적 등록·시뮬레이션을 막고 작업 완료로만 진행한다', async () => {
    actAs(SEED_EMPLOYEE_NO.steelmaking);
    const planId = planIdOf('PP-2609-0004');
    await productionResultApi.startWork({ productionPlanId: planId, processType: 'CONTINUOUS_CASTING', startedAt: new Date(Date.now() - 3_600_000).toISOString(), heatLotId: null });
    const ctx = await productionResultApi.work(planId);
    const html = await render(SEED_EMPLOYEE_NO.productionHead, createElement(WorkBody, { ctx }));
    expect(html).toContain('진행 중인 작업이 있어요');
    expect(html).toContain('작업 완료');
  });
});
