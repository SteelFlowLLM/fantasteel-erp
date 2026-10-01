// 위젯 카드 그리기 점검 (dev 서버 없이): 시드 데이터로 모든 위젯을 서버 렌더링해 오류 없이 그려지는지,
// 권한이 없으면 잠금, P2 위젯은 준비 중으로 보이는지 확인한다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { dashboardApi, dashboardKeys, DASHBOARD_WIDGET_KEYS, type DataWidgetKey } from '@/api/dashboard';
import { sessionApi, type SessionUser } from '@/api/session';
import { DashboardScreen } from '@/features/dashboard/DashboardScreen';
import { isSoonWidget, widgetDef } from '@/features/dashboard/widgetCatalog';
import { WIDGET_COMPONENTS } from '@/features/dashboard/widgets/widgetRegistry';
import { MeContext } from '@/hooks/useMe';
import { getMockDb } from '@/mock/db';
import { seedTxAt } from '@/mock/seeds';
import { seedDashboard } from '@/mock/seeds/dashboard';
import { actAs, SEED_EMPLOYEE_NO } from '@/test/actors';

beforeEach(() => {
  getMockDb().transact((tx) => {
    if (!tx.tables.salesOrder.some((so) => so.salesOrderNo === 'SO-2608-001')) seedDashboard(seedTxAt(tx, '2026-08-24T09:00:00+09:00'));
  });
});

async function renderWidgets(employeeNo: string, editing = false): Promise<Map<string, string>> {
  const employeeId = actAs(employeeNo);
  const me: SessionUser = await sessionApi.getSessionUser(employeeId);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const key of DASHBOARD_WIDGET_KEYS) {
    if (isSoonWidget(key)) continue;
    const dataKey: DataWidgetKey = key;
    try {
      queryClient.setQueryData(dashboardKeys.widget(dataKey, employeeId), await dashboardApi.widget(dataKey));
    } catch {
      // 권한이 없는 위젯은 조회하지 않는다 (화면도 조회하지 않고 잠금을 보인다)
    }
  }
  const wrap = (child: ReactNode) => createElement(QueryClientProvider, { client: queryClient }, createElement(MeContext.Provider, { value: me }, child));
  const out = new Map<string, string>();
  for (const key of DASHBOARD_WIDGET_KEYS) {
    out.set(key, renderToStaticMarkup(wrap(createElement(WIDGET_COMPONENTS[key], { editing, onRemove: () => undefined }))));
  }
  return out;
}

describe('위젯 카드', () => {
  it('관리자: 14개 모두 제목과 본문이 그려지고, P2 2개는 준비 중', async () => {
    const html = await renderWidgets(SEED_EMPLOYEE_NO.admin);
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
    expect(html.get('AGENT_RISK')).toContain('담당 부서원이 확정');
    expect(html.get('SHIPMENT_RESULT')).toContain('슬래브(매)');
  });

  it('물류 담당: 수주·수율 위젯은 잠금, 공정 흐름은 볼 수 없는 단계만 잠금', async () => {
    const html = await renderWidgets(SEED_EMPLOYEE_NO.logistics);
    expect(html.get('ORDER_FULFILLMENT')).toContain('이 위젯을 볼 권한이 없어요');
    expect(html.get('ORDER_FULFILLMENT')).toContain('수주 등록·수주 취소 조회 권한이 필요해요');
    expect(html.get('PROCESS_YIELD')).toContain('이 위젯을 볼 권한이 없어요');
    expect(html.get('SHIPMENT_RESULT')).not.toContain('이 위젯을 볼 권한이 없어요');
    expect(html.get('PROCESS_FLOW')).toContain('권한 없음');
    expect(html.get('PRODUCT_STOCK')).toContain('SL-SS275-250x1200x10000');
  });

  it('대시보드 화면 틀: 인사·위젯 편집 버튼 (격자는 브라우저에서 너비를 잰 뒤 그린다)', async () => {
    const employeeId = actAs(SEED_EMPLOYEE_NO.sales);
    const me = await sessionApi.getSessionUser(employeeId);
    const markup = renderToStaticMarkup(
      createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MeContext.Provider, { value: me }, createElement(DashboardScreen))),
    );
    expect(markup).toContain(`${me.employeeName}님, 안녕하세요`);
    expect(markup).toContain('위젯 편집');
  });

  it('편집 중: 제외 버튼이 있고 바로가기 링크는 숨긴다', async () => {
    const html = await renderWidgets(SEED_EMPLOYEE_NO.admin, true);
    expect(html.get('RECENT_EVENTS')).toContain('최근 작업 로그 위젯 제외');
    expect(html.get('RECENT_EVENTS')).not.toContain('href="/business-events"');
    const view = await renderWidgets(SEED_EMPLOYEE_NO.admin);
    expect(view.get('RECENT_EVENTS')).toContain('href="/business-events"');
  });
});
