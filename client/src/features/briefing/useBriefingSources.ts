// 아침 브리핑이 읽는 자료. 역할에 필요한 것만, 그 자료를 보여 주는 화면과 같은 조회 권한이 있을 때만 읽는다.
// 대시보드 위젯·목록 화면과 같은 쿼리 키를 써서 이미 읽은 값은 다시 쓰고, 창을 열 때 새로 읽는다.
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { approvalApi, approvalKeys } from '@/api/approvals';
import { dashboardApi, dashboardKeys, type DataWidgetKey } from '@/api/dashboard';
import { dispositionApi, dispositionKeys } from '@/api/dispositions';
import { goodsIssueApi, goodsIssueKeys } from '@/api/goodsIssues';
import { inspectionApi, inspectionKeys } from '@/api/inspections';
import { shipmentRequestApi, shipmentRequestKeys } from '@/api/shipmentRequests';
import { taskApi, taskKeys } from '@/api/tasks';
import { PERMISSION } from '@/codes';
import { briefingSourceKeys, type BriefingSourceKey, type BriefingSources } from '@/features/briefing/lib/briefingRules';
import { canViewWidget } from '@/hooks/useDashboardWidget';
import { useMe } from '@/hooks/useMe';
import { canView, isDepartmentHead } from '@/lib/permissions';

/** skipped = 이 역할이 읽지 않거나 볼 권한이 없음, loading = 읽는 중, done = 읽음(실패도 끝난 것으로 본다) */
export type BriefingSourceState = 'skipped' | 'loading' | 'done';

export interface BriefingSourceRead {
  sources: BriefingSources;
  /** 이 사원이 읽는 자료 (왼쪽 "읽은 자료" 순서) */
  keys: BriefingSourceKey[];
  state: Record<BriefingSourceKey, BriefingSourceState>;
}

function stateOf(wanted: boolean, query: UseQueryResult<unknown>): BriefingSourceState {
  if (!wanted) return 'skipped';
  return query.isPending ? 'loading' : 'done';
}

/** 대시보드 위젯과 같은 키로 읽는다 (대시보드가 이미 읽었으면 그 값을 먼저 보인다) */
function widgetQuery<K extends DataWidgetKey>(key: K, employeeId: number, enabled: boolean) {
  return { queryKey: dashboardKeys.widget(key, employeeId), queryFn: () => dashboardApi.widget(key), enabled, retry: false };
}

/** enabled = 브리핑 창이 열려 있을 때만 읽는다 */
export function useBriefingSources(today: string, enabled: boolean): BriefingSourceRead {
  const me = useMe();
  const head = isDepartmentHead(me);
  const roleKeys = new Set(briefingSourceKeys(me.roleCode, head));
  const allowed: Record<BriefingSourceKey, boolean> = {
    deliveryRisk: canViewWidget(me, 'DELIVERY_RISK'),
    surplusAge: canViewWidget(me, 'SURPLUS_AGE'),
    rejectRate: canViewWidget(me, 'REJECT_RATE'),
    rawMaterialBalance: canViewWidget(me, 'RAW_MATERIAL_BALANCE'),
    purchaseProgress: canViewWidget(me, 'PURCHASE_PROGRESS'),
    productionVolume: canViewWidget(me, 'PRODUCTION_VOLUME'),
    agentRisk: canViewWidget(me, 'AGENT_RISK'),
    inspectionQueue: canView(me, PERMISSION.INSPECTION_REGISTER),
    rejectedLots: canView(me, PERMISSION.DISPOSITION_SET),
    goodsIssueQueue: canView(me, PERMISSION.GOODS_ISSUE_CONFIRM),
    shipmentRequests: canView(me, PERMISSION.SHIPMENT_REQUEST_MANAGE),
    approvalInbox: head,
    taskSummary: true,
  };
  const wants = (key: BriefingSourceKey) => roleKeys.has(key) && allowed[key];
  const on = (key: BriefingSourceKey) => enabled && wants(key);

  const deliveryRisk = useQuery(widgetQuery('DELIVERY_RISK', me.employeeId, on('deliveryRisk')));
  const surplusAge = useQuery(widgetQuery('SURPLUS_AGE', me.employeeId, on('surplusAge')));
  const rejectRate = useQuery(widgetQuery('REJECT_RATE', me.employeeId, on('rejectRate')));
  const rawMaterialBalance = useQuery(widgetQuery('RAW_MATERIAL_BALANCE', me.employeeId, on('rawMaterialBalance')));
  const purchaseProgress = useQuery(widgetQuery('PURCHASE_PROGRESS', me.employeeId, on('purchaseProgress')));
  const productionVolume = useQuery(widgetQuery('PRODUCTION_VOLUME', me.employeeId, on('productionVolume')));
  const agentRisk = useQuery(widgetQuery('AGENT_RISK', me.employeeId, on('agentRisk')));
  const inspectionQueue = useQuery({ queryKey: inspectionKeys.queue(), queryFn: inspectionApi.queue, enabled: on('inspectionQueue'), retry: false });
  const rejectedLots = useQuery({ queryKey: dispositionKeys.list(), queryFn: dispositionApi.list, enabled: on('rejectedLots'), retry: false });
  const goodsIssueQueue = useQuery({ queryKey: goodsIssueKeys.queue(), queryFn: goodsIssueApi.queue, enabled: on('goodsIssueQueue'), retry: false });
  const shipmentRequests = useQuery({ queryKey: shipmentRequestKeys.list(), queryFn: shipmentRequestApi.list, enabled: on('shipmentRequests'), retry: false });
  const approvalInbox = useQuery({ queryKey: approvalKeys.inbox(), queryFn: approvalApi.inbox, enabled: on('approvalInbox'), retry: false });
  const taskSummary = useQuery({ queryKey: [...taskKeys.summary(me.employeeId), today], queryFn: () => taskApi.summary(today), enabled: on('taskSummary'), retry: false });

  const queries = {
    deliveryRisk,
    surplusAge,
    rejectRate,
    rawMaterialBalance,
    purchaseProgress,
    productionVolume,
    agentRisk,
    inspectionQueue,
    rejectedLots,
    goodsIssueQueue,
    shipmentRequests,
    approvalInbox,
    taskSummary,
  } satisfies Record<BriefingSourceKey, UseQueryResult<unknown>>;

  const data = <T,>(key: BriefingSourceKey, query: UseQueryResult<T>): T | null => (wants(key) ? (query.data ?? null) : null);
  const state = Object.fromEntries((Object.keys(queries) as BriefingSourceKey[]).map((key) => [key, stateOf(wants(key), queries[key])])) as Record<BriefingSourceKey, BriefingSourceState>;

  return {
    keys: briefingSourceKeys(me.roleCode, head).filter(wants),
    state,
    sources: {
      today,
      deliveryRisk: data('deliveryRisk', deliveryRisk),
      surplusAge: data('surplusAge', surplusAge),
      rejectRate: data('rejectRate', rejectRate),
      rawMaterialBalance: data('rawMaterialBalance', rawMaterialBalance),
      purchaseProgress: data('purchaseProgress', purchaseProgress),
      productionVolume: data('productionVolume', productionVolume),
      agentRisk: data('agentRisk', agentRisk),
      inspectionQueue: data('inspectionQueue', inspectionQueue),
      rejectedLots: data('rejectedLots', rejectedLots),
      goodsIssueQueue: data('goodsIssueQueue', goodsIssueQueue),
      shipmentRequests: data('shipmentRequests', shipmentRequests),
      approvalInbox: data('approvalInbox', approvalInbox),
      taskSummary: data('taskSummary', taskSummary),
    },
  };
}
