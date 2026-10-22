import { PERMISSION, PROCESS_TYPE, PROCESS_TYPE_LABEL, PRODUCTION_PLAN_STATUS_LABEL, SHIPMENT_REQUEST_STATUS_LABEL, type Permission, type ProcessYieldRow } from '@fantasteel/shared';
import type { DashboardService } from '../../dashboard/dashboard.service';
import { limitRows, optionalEnum, ToolArgumentError, type AssistantTool } from './assistant-tool';

export const DASHBOARD_TOOL_WIDGETS = ['process_flow', 'shipment_result', 'process_yield', 'surplus_age'] as const;
type DashboardToolWidget = (typeof DASHBOARD_TOOL_WIDGETS)[number];

/**
 * 위젯마다 그 대시보드 API(GET dashboard/widgets/*)의 화면 권한. 빈 목록은 모든 사원.
 * 공정 흐름·여재 보유는 모든 사원, 출하 실적은 출고 확정 VIEW, 공정별 수율은 작업 실적 확정 VIEW.
 */
export const DASHBOARD_WIDGET_PERMISSIONS: Record<DashboardToolWidget, readonly Permission[]> = {
  process_flow: [],
  shipment_result: [PERMISSION.GOODS_ISSUE_CONFIRM],
  process_yield: [PERMISSION.PRODUCTION_RESULT_CONFIRM],
  surplus_age: [],
};

/**
 * 대시보드 현황 (GET dashboard/widgets/*, REQ-DSH-001·002). 숫자는 대시보드 service의 계산을 그대로 넘긴다.
 * 권한은 위젯마다 따로 본다(scoped): 출하 실적 권한만 있는 사원이 공정별 수율을 읽거나, 그 숫자가 담긴 사내 채팅 AI 답이
 * 수율 권한이 없는 방 멤버에게 보이지 않게 한다. service도 같은 권한을 한 번 더 확인한다.
 * 수주 충족·제품 재고는 get_sales_orders·get_inventory가 같은 숫자를 줘서 넣지 않는다.
 */
export function dashboardTool(dashboard: DashboardService): AssistantTool {
  return {
    access: {
      checkedBy: 'TOOLBOX',
      permissions: [PERMISSION.GOODS_ISSUE_CONFIRM, PERMISSION.PRODUCTION_RESULT_CONFIRM],
      scoped: { argument: 'widget', permissions: DASHBOARD_WIDGET_PERMISSIONS },
      note: '공정 흐름 현황·여재 보유 기간은 모든 사원이 볼 수 있고, 출하 실적은 출고 확정, 공정별 수율은 작업 실적 확정 조회 권한이 필요해요.',
    },
    definition: {
      name: 'get_dashboard_summary',
      description:
        '대시보드 현황 숫자를 조회한다. widget: process_flow(공정 흐름 현황: 진행 중 수주·납기 위험 수주·생산계획·판정 대기 LOT·가용 재고·출하요청·오늘 출고), shipment_result(최근 30일 출하 실적 매수·톤), process_yield(공정별 수율: 투입·산출 톤, 실적·계획 수율), surplus_age(여재 보유 기간: 규격별 여재 매수·최장 보유 일수).',
      parameters: {
        type: 'object',
        properties: { widget: { type: 'string', enum: [...DASHBOARD_TOOL_WIDGETS], description: '볼 현황' } },
        required: ['widget'],
      },
    },
    async run(args, user) {
      const widget = optionalEnum(args, 'widget', DASHBOARD_TOOL_WIDGETS);
      if (!widget) throw new ToolArgumentError(`widget이 필요해요 (${DASHBOARD_TOOL_WIDGETS.join(', ')})`);
      return WIDGET_RUNNERS[widget](dashboard, user);
    },
  };
}

const WIDGET_RUNNERS: Record<DashboardToolWidget, (dashboard: DashboardService, user: Parameters<AssistantTool['run']>[1]) => ReturnType<AssistantTool['run']>> = {
  async process_flow(dashboard) {
    const w = await dashboard.processFlow();
    return {
      label: '대시보드 · 공정 흐름 현황',
      data: {
        기준일: w.today,
        수주: w.salesOrders && { '진행 중 수주 수': w.salesOrders.openCount, '납기 위험 수주 수': w.salesOrders.dueRiskCount },
        생산계획: w.productionPlans && { [`${PRODUCTION_PLAN_STATUS_LABEL.PLANNED} 수`]: w.productionPlans.plannedCount, [`${PRODUCTION_PLAN_STATUS_LABEL.IN_PROGRESS} 수`]: w.productionPlans.inProgressCount },
        검사: w.inspections && { '판정 대기 LOT 수': w.inspections.pendingCount, '히트 수': w.inspections.heatCount, '슬래브 수': w.inspections.slabCount, '코일 수': w.inspections.coilCount },
        재고: { '슬래브 가용 매수': w.inventories.slabAvailableQty, '코일 가용 매수': w.inventories.coilAvailableQty },
        출하요청: w.shipmentRequests && { [`${SHIPMENT_REQUEST_STATUS_LABEL.REQUESTED} 수`]: w.shipmentRequests.requestedCount, [`${SHIPMENT_REQUEST_STATUS_LABEL.ALLOCATED} 수`]: w.shipmentRequests.allocatedCount },
        '오늘 출고': w.goodsIssues && { '출고 확정 출하요청 수': w.goodsIssues.issuedRequestCount, '출고 LOT 수': w.goodsIssues.issuedLotCount },
      },
    };
  },
  async shipment_result(dashboard, user) {
    const w = await dashboard.shipmentResult(user);
    const { rows, omitted } = limitRows(w.series.filter((p) => p.slabQty > 0 || p.coilQty > 0).reverse());
    return {
      label: `대시보드 · 출하 실적 최근 ${w.days}일`,
      data: {
        기간: `${w.from} ~ ${w.to} (${w.days}일, 출고 확정 기준)`,
        '출고 확정 출하요청 수': w.issuedRequestCount,
        '출고 슬래브 매수': w.totalSlabQty,
        '출고 코일 매수': w.totalCoilQty,
        '출고 톤': w.totalTon,
        '출고한 날(최신순)': rows.map((p) => ({ 날짜: p.date, '슬래브 매수': p.slabQty, '코일 매수': p.coilQty, 톤: p.ton })),
        '생략 줄 수': omitted,
      },
    };
  },
  async process_yield(dashboard, user) {
    const w = await dashboard.processYield(user);
    return {
      label: '대시보드 · 공정별 수율',
      data: {
        공정: w.processes.map(yieldRow),
        안내: `${PROCESS_TYPE_LABEL[PROCESS_TYPE.IRONMAKING]}은 계획 수율을 쓰지 않아 수율 없이 톤만 보여요. 실적 수율 = 산출 톤 합 ÷ 투입 톤 합(완료된 작업 실적)`,
      },
    };
  },
  async surplus_age(dashboard) {
    const w = await dashboard.surplusAge();
    const { rows, omitted } = limitRows(w.items);
    return {
      label: '대시보드 · 여재 보유 기간',
      data: {
        기준일: w.today,
        '여재 매수 합계': w.totalQty,
        '여재 톤 합계': w.totalTon,
        '최장 보유 일수': w.maxAgeDays,
        '규격(오래된 순)': rows.map((r) => ({ 규격: r.itemCode, 강종: r.steelGradeCode, '여재 매수': r.surplusQty, '여재 톤': r.surplusTon, '가장 이른 생산완료일': r.oldestSinceDate, '최장 보유 일수': r.maxAgeDays })),
        '생략 줄 수': omitted,
      },
    };
  },
};

function yieldRow(r: ProcessYieldRow) {
  return {
    공정: PROCESS_TYPE_LABEL[r.processType],
    '완료 실적 수': r.resultCount,
    '투입 톤': r.inputTon,
    '산출 톤': r.outputTon,
    '실적 수율': rateText(r.actualYieldRate),
    '계획 수율': rateText(r.plannedYieldRate),
  };
}

/** '0.9420' → '94.2%' */
function rateText(rate: string | null): string | null {
  return rate === null ? null : `${(Number(rate) * 100).toFixed(1)}%`;
}
