// 위젯 카드 그리기 점검 (dev 서버 없이): 고정 데이터로 모든 위젯을 서버 렌더링해 오류 없이 그려지는지,
// 권한이 없으면 잠금, P2 위젯은 준비 중으로 보이는지 확인한다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { dashboardKeys, DASHBOARD_WIDGET_KEYS, type DataWidgetKey } from '@/api/dashboard';
import { DashboardScreen } from '@/features/dashboard/DashboardScreen';
import { WIDGET_DATA } from '@/features/dashboard/testing/dashboardFixtures';
import { isSoonWidget, widgetDef } from '@/features/dashboard/widgetCatalog';
import { WIDGET_COMPONENTS } from '@/features/dashboard/widgets/widgetRegistry';
import { MeContext } from '@/hooks/useMe';
import { fmtPct } from '@/lib/format';
import { SEED_EMPLOYEE_NO } from '@/test/actors';
import type { PermissionMap } from '@/lib/permissions';
import { sessionUserOf } from '@/test/sessionUsers';

/** 모든 위젯에 데이터를 넣어 두어도 권한이 없는 위젯은 로그인 사원 권한으로 잠긴다. permissions를 주면 역할 기본 권한 대신 쓴다 */
function renderWidgets(employeeNo: string, editing = false, permissions?: PermissionMap): Map<string, string> {
  const me = { ...sessionUserOf(employeeNo), ...(permissions ? { permissions } : {}) };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const key of DASHBOARD_WIDGET_KEYS) {
    if (isSoonWidget(key)) continue;
    const dataKey: DataWidgetKey = key;
    queryClient.setQueryData(dashboardKeys.widget(dataKey, me.employeeId), WIDGET_DATA[dataKey]);
  }
  const wrap = (child: ReactNode) => createElement(QueryClientProvider, { client: queryClient }, createElement(MeContext.Provider, { value: me }, child));
  const out = new Map<string, string>();
  for (const key of DASHBOARD_WIDGET_KEYS) {
    out.set(key, renderToStaticMarkup(wrap(createElement(WIDGET_COMPONENTS[key], { editing, onRemove: () => undefined }))));
  }
  return out;
}

describe('위젯 카드', () => {
  it('관리자: 14개 모두 제목과 본문이 그려지고, P2 1개(AI 활용 현황)는 준비 중', () => {
    const html = renderWidgets(SEED_EMPLOYEE_NO.admin);
    for (const key of DASHBOARD_WIDGET_KEYS) {
      const markup = html.get(key) ?? '';
      expect(markup).toContain(widgetDef(key).label);
      expect(markup).not.toContain('불러오는 중');
      expect(markup).not.toContain('이 위젯을 볼 권한이 없어요');
      if (isSoonWidget(key)) expect(markup).toContain('준비 중 (P2)');
    }
    expect(html.get('ORDER_FULFILLMENT')).toContain('SO-2609-004');
    expect(html.get('ORDER_FULFILLMENT')).toContain('검사합격');
    expect(html.get('PROCESS_FLOW')).toContain('진행 중 수주');
    expect(html.get('AGENT_RISK')).toContain('확정 대기 후보');
    expect(html.get('AGENT_RISK')).toContain('PP-2610-0003');
    expect(html.get('SHIPMENT_RESULT')).toContain('슬래브(매)');
  });

  it('구매 담당: 업무 조회는 모든 역할이라 수주·수율·출하 실적 위젯이 보이고, 그 조회 권한을 빼면 잠긴다', () => {
    const html = renderWidgets(SEED_EMPLOYEE_NO.purchase);
    for (const key of ['ORDER_FULFILLMENT', 'PROCESS_YIELD', 'SHIPMENT_RESULT']) expect(html.get(key)).not.toContain('이 위젯을 볼 권한이 없어요');
    expect(html.get('PRODUCT_STOCK')).toContain('SL-SS275-250x1200x10000');
    const limited = renderWidgets(SEED_EMPLOYEE_NO.purchase, false, { PURCHASE_REQUISITION_CREATE: 'USE' });
    expect(limited.get('ORDER_FULFILLMENT')).toContain('이 위젯을 볼 권한이 없어요');
    expect(limited.get('ORDER_FULFILLMENT')).toContain('수주 등록·수주 취소 조회 권한이 필요해요');
    expect(limited.get('PROCESS_YIELD')).toContain('이 위젯을 볼 권한이 없어요');
    expect(limited.get('SHIPMENT_RESULT')).toContain('이 위젯을 볼 권한이 없어요');
    expect(limited.get('PROCESS_FLOW')).not.toContain('권한 없음');
  });

  it('품질 담당: 공정 흐름의 판정 대기 칸을 "내 업무"로 강조하고 검사 입력으로 연결한다. 다른 역할은 강조 없음', () => {
    const quality = (renderWidgets(SEED_EMPLOYEE_NO.quality)).get('PROCESS_FLOW') ?? '';
    expect(quality).toContain('내 업무');
    // 판정 대기 칸(링크 하나)에 검사 입력 주소와 "내 업무" 태그가 함께 있다
    const inspectionLink = quality.split('</a>').find((part) => part.includes('판정 대기')) ?? '';
    expect(inspectionLink).toContain('href="/quality/inspections"');
    expect(inspectionLink).toContain('내 업무');
    const sales = (renderWidgets(SEED_EMPLOYEE_NO.sales)).get('PROCESS_FLOW') ?? '';
    expect(sales).toContain('판정 대기');
    expect(sales).not.toContain('내 업무');
  });

  it('공정 흐름: 열 권한이 없는 단계(수주·출하요청)도 건수는 보이고, 누를 수 없으며 안내만 띄운다', () => {
    expect(renderWidgets(SEED_EMPLOYEE_NO.quality).get('PROCESS_FLOW')).toContain('href="/sales-orders"');
    const qualityOnly: PermissionMap = { INSPECTION_REGISTER: 'USE', DISPOSITION_SET: 'USE', INSPECTION_STANDARD_MANAGE: 'USE' };
    const quality = renderWidgets(SEED_EMPLOYEE_NO.quality, false, qualityOnly).get('PROCESS_FLOW') ?? '';
    expect(quality).not.toContain('권한 없음');
    expect(quality).toContain('납기 위험');
    expect(quality).toContain('배정 대기');
    expect(quality).not.toContain('href="/sales-orders"');
    expect(quality).not.toContain('href="/shipment-requests"');
    expect(quality).toContain('화면을 열 권한이 없어요');
    // 열 수 있는 단계(재고·판정 대기)는 그대로 바로가기
    expect(quality).toContain('href="/inventories"');
  });

  it('Agent 위험 감지: 품질은 카드 머리 한 줄에 확정 대기 건수만, 다른 역할은 건수·유형별·최근 후보와 Agent 화면 바로가기', () => {
    const quality = renderWidgets(SEED_EMPLOYEE_NO.quality).get('AGENT_RISK') ?? '';
    expect(quality).toContain('확정 대기 2건');
    expect(quality).toContain('원료 부족 1');
    // 본문 없이 머리 안에 한 줄이 들어간다 (한 칸 높이 카드)
    expect(quality.indexOf('확정 대기 2건')).toBeLessThan(quality.indexOf('</header>'));
    expect(quality).not.toContain('준비 중');
    const sales = renderWidgets(SEED_EMPLOYEE_NO.sales).get('AGENT_RISK') ?? '';
    expect(sales).toContain('확정 대기 후보');
    expect(sales).toContain('합격 매수 부족 1');
    expect(sales).toContain('href="/agent"');
    expect(sales).not.toContain('준비 중');
  });

  it('공정 흐름 현황: 품질은 판정 대기를 내 업무로 크게 보이고 나머지 단계는 흐리게, 다른 역할은 그대로', () => {
    const quality = (renderWidgets(SEED_EMPLOYEE_NO.quality)).get('PROCESS_FLOW') ?? '';
    expect(quality).toContain('내 업무');
    expect(quality).toContain('text-[34px]');
    expect(quality.match(/opacity-60/g)?.length).toBe(5);
    const sales = (renderWidgets(SEED_EMPLOYEE_NO.sales)).get('PROCESS_FLOW') ?? '';
    expect(sales).not.toContain('내 업무');
    expect(sales).not.toContain('opacity-60');
  });

  it('공정 흐름 현황: 품질의 판정 대기가 0건이면 강조를 끄고(태그만 남김) 나머지 단계도 흐리게 하지 않는다', () => {
    const me = sessionUserOf(SEED_EMPLOYEE_NO.quality);
    const data = WIDGET_DATA.PROCESS_FLOW;
    const queryClient = new QueryClient();
    queryClient.setQueryData(dashboardKeys.widget('PROCESS_FLOW', me.employeeId), { ...data, inspections: { pendingCount: 0, heatCount: 0, slabCount: 0, coilCount: 0 } });
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(MeContext.Provider, { value: me }, createElement(WIDGET_COMPONENTS.PROCESS_FLOW, { editing: false, onRemove: () => undefined })),
      ),
    );
    expect(html).toContain('내 업무');
    expect(html).toContain('판정할 LOT 없음');
    expect(html).not.toContain('text-[34px]');
    expect(html).not.toContain('bg-run-bg shadow');
    expect(html).not.toContain('opacity-60');
    // 그래도 내 업무 칸은 테두리·바탕을 옅게 물들여 다른 단계와 구분한다 (그 칸 하나만)
    const inspectionBox = html.split('</a>').find((part) => part.includes('판정 대기')) ?? '';
    expect(inspectionBox).toContain('border-run/40 bg-run-bg/50');
    expect(html.match(/bg-run-bg\/50/g)?.length).toBe(1);
  });

  it('강종별 불합격률: 판정된 검사가 없는 강종은 막대 없이 한 줄에 이름만, 불합격 0건은 "불합격 없음"', () => {
    const html = (renderWidgets(SEED_EMPLOYEE_NO.quality)).get('REJECT_RATE') ?? '';
    const data = WIDGET_DATA.REJECT_RATE;
    const notInspected = data.grades.filter((g) => g.inspectedCount === 0);
    const noReject = data.grades.filter((g) => g.inspectedCount > 0 && g.failedCount === 0);
    expect(html.includes('판정된 검사 없는 강종')).toBe(notInspected.length > 0);
    for (const g of notInspected) expect(html).toContain(g.steelGradeCode);
    expect(html).not.toContain('판정된 검사 없음');
    expect(html.includes('불합격 없음')).toBe(noReject.length > 0);
    // 0%는 색칠한 막대 없이 글자만 (꽉 찬 막대가 100%로 읽혔다)
    expect(html).not.toContain('bg-ok-bg');
  });

  it('강종별 불합격률: 맨 위에 기간 전체 판정 건수·불합격 건수·불합격률을 크게 보인다', () => {
    const html = (renderWidgets(SEED_EMPLOYEE_NO.quality)).get('REJECT_RATE') ?? '';
    const data = WIDGET_DATA.REJECT_RATE;
    const inspected = data.grades.reduce((sum, g) => sum + g.inspectedCount, 0);
    const failed = data.grades.reduce((sum, g) => sum + g.failedCount, 0);
    expect(inspected).toBeGreaterThan(0);
    expect(html).toContain('판정한 검사');
    expect(html).toContain(`>${inspected}<small`);
    expect(html).toContain(`>${failed}<small`);
    expect(html).toContain(fmtPct(failed / inspected, 1));
  });

  it('대시보드 화면 틀: 인사·위젯 편집 버튼 (격자는 브라우저에서 너비를 잰 뒤 그린다)', () => {
    const me = sessionUserOf(SEED_EMPLOYEE_NO.sales);
    const markup = renderToStaticMarkup(
      createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MeContext.Provider, { value: me }, createElement(DashboardScreen))),
    );
    expect(markup).toContain(`${me.employeeName}님, 안녕하세요`);
    expect(markup).toContain('위젯 편집');
    // 소속·날짜는 상단 바에 있어 인사 줄에 되풀이하지 않는다
    expect(markup).not.toContain(`${me.departmentName} · ${me.roleName}`);
  });

  it('편집 중: 제외 버튼이 있고 바로가기 링크는 숨긴다', () => {
    const html = renderWidgets(SEED_EMPLOYEE_NO.admin, true);
    expect(html.get('RECENT_EVENTS')).toContain('최근 작업 로그 위젯 제외');
    expect(html.get('RECENT_EVENTS')).not.toContain('href="/business-events"');
    const view = renderWidgets(SEED_EMPLOYEE_NO.admin);
    expect(view.get('RECENT_EVENTS')).toContain('href="/business-events"');
  });
});
