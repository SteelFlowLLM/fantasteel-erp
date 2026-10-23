// 생산 화면 렌더 확인: 고정 데이터로 상세 본문을 서버 렌더(renderToString)해서 런타임 오류 없이 그려지는지,
// 사용 권한이 없으면 읽기 전용 표시가 나오는지 본다 (브라우저 없이 Vitest node 환경).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { lotStateText } from '@/features/production/components/PlanBadges';
import { inspectionHrefOf } from '@/features/production/components/PlanLotsCard';
import { PlanDetailBody } from '@/features/production/ProductionPlanScreen';
import { WorkBody } from '@/features/production/ProductionResultScreen';
import { RollingBody } from '@/features/production/RollingScreen';
import { PLAN_DETAIL, ROLLING_DETAIL, WORK_CONTEXT } from '@/features/production/testing/productionFixtures';
import { MeContext } from '@/hooks/useMe';
import { SEED_EMPLOYEE_NO } from '@/test/actors';
import { sessionUserOf } from '@/test/sessionUsers';

function render(employeeNo: string, element: ReactElement): string {
  const me = sessionUserOf(employeeNo);
  const client = new QueryClient();
  return renderToString(createElement(QueryClientProvider, { client }, createElement(MeContext.Provider, { value: me }, element)));
}

describe('생산 화면 렌더', () => {
  it('생산계획 상세: 편성표·히트·재생산 필요 띠, 영업(조회만)은 읽기 전용', () => {
    const plan = PLAN_DETAIL;
    const html = render(SEED_EMPLOYEE_NO.productionHead, createElement(PlanDetailBody, { plan }));
    expect(html).toContain('PP-2609-0005');
    expect(html).toContain('필요 용강량');
    expect(html).toContain('재생산 필요');
    expect(html).not.toContain('조회만 할 수 있어요');
    const readOnly = render(SEED_EMPLOYEE_NO.sales, createElement(PlanDetailBody, { plan }));
    expect(readOnly).toContain('조회만 할 수 있어요');
  });

  it('생산계획 상세: 계획 상태에서 다시 계산한 히트 수가 다를 때만 히트 편성 확정 띠', () => {
    const plan = PLAN_DETAIL;
    const formation = plan.formation;
    if (!formation) throw new Error('편성표 없음');
    const same = render(SEED_EMPLOYEE_NO.productionHead, createElement(PlanDetailBody, { plan: { ...plan, productionPlanStatus: 'PLANNED' } }));
    expect(same).not.toContain('히트 편성 확정');
    const changed = { ...plan, productionPlanStatus: 'PLANNED' as const, formation: { ...formation, recalculatedHeatCount: formation.heatCount + 1 } };
    const html = render(SEED_EMPLOYEE_NO.productionHead, createElement(PlanDetailBody, { plan: changed }));
    expect(html).toContain('히트 편성 확정');
    expect(html).toContain(`히트 ${formation.heatCount}개 → ${formation.heatCount + 1}개`);
    const started = render(SEED_EMPLOYEE_NO.productionHead, createElement(PlanDetailBody, { plan: { ...changed, productionPlanStatus: 'IN_PROGRESS' } }));
    expect(started).not.toContain('히트 편성 확정');
  });

  it('작업 실적: 공정별 묶음과 연주 대기 히트, 품질(조회만)은 읽기 전용', () => {
    const ctx = WORK_CONTEXT;
    const html = render(SEED_EMPLOYEE_NO.productionHead, createElement(WorkBody, { ctx }));
    for (const word of ['제선', '제강', '연주', '실적 시뮬레이션', 'HM-BF2-260918-01']) expect(html).toContain(word);
    expect(html).not.toContain('공정 실적');
    const readOnly = render(SEED_EMPLOYEE_NO.quality, createElement(WorkBody, { ctx }));
    expect(readOnly).toContain('조회만 할 수 있어요');
  });

  it('열연 투입 배정: 슬래브 풀·FIFO 추천·코일', () => {
    const detail = ROLLING_DETAIL;
    const html = render('2001010', createElement(RollingBody, { detail }));
    for (const word of ['FIFO 추천', '예약 가용', '확정 배정', '열연 실적', 'SL-SM355B-250x1500x10000']) expect(html).toContain(word);
    expect(html).not.toContain('귀속');
    expect(html).toContain('열연 완료 / 부족 매수');
    expect(html).toContain('수주 상세');
    const readOnly = render(SEED_EMPLOYEE_NO.admin, createElement(RollingBody, { detail }));
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

  it('작업 실적: 작업 시작만 한 공정은 실적 등록·시뮬레이션을 막고 작업 완료로만 진행한다', () => {
    // 연주 작업 시작만 한 실적: 완료 시각·산출이 비어 있다
    const started = { ...WORK_CONTEXT.plan.results[0], id: 99, processType: 'CONTINUOUS_CASTING' as const, startedAt: '2026-09-18T09:00:00.000Z', completedAt: null, inputTon: null, outputTon: null, outputLotNos: [] };
    const ctx = {
      ...WORK_CONTEXT,
      plan: { ...WORK_CONTEXT.plan, results: [...WORK_CONTEXT.plan.results, started] },
      openWork: [{ productionResultId: 99, processType: 'CONTINUOUS_CASTING' as const, startedAt: started.startedAt, heatLotId: null, heatNo: null }],
    };
    const html = render(SEED_EMPLOYEE_NO.productionHead, createElement(WorkBody, { ctx }));
    expect(html).toContain('진행 중인 작업이 있어요');
    expect(html).toContain('작업 완료');
  });
});
