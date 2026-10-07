// 대시보드 위젯 데이터 조회와 볼 권한 (REQ-DSH-001·002, BP-DSH-01 "권한 내 집계").
// 권한이 없는 위젯은 조회하지 않고 잠금으로 보인다. api도 같은 권한을 다시 확인한다(COM-002).
import { useQuery } from '@tanstack/react-query';
import { dashboardApi, dashboardKeys, DASHBOARD_REFRESH_MS, DASHBOARD_WIDGET_VIEW, type DataWidgetKey } from '@/api/dashboard';
import { isServerDataSource } from '@/api/http';
import type { Permission } from '@/codes';
import { useMe } from '@/hooks/useMe';
import { canView } from '@/lib/permissions';

export interface WidgetAccess {
  allowed: boolean;
  /** 필요한 조회 권한 (하나라도). 빈 배열 = 모든 사원 */
  permissions: readonly Permission[];
}

/** 이 위젯의 데이터를 볼 수 있는지 */
export function useDashboardWidgetAccess(key: DataWidgetKey): WidgetAccess {
  const me = useMe();
  const permissions = DASHBOARD_WIDGET_VIEW[key];
  return { allowed: permissions.length === 0 || canView(me, ...permissions), permissions };
}

/**
 * 위젯을 다시 읽는 간격. 서버 모드에서는 다른 사원(다른 PC)의 변경을 알려 주는 길이 없어 주기적으로 다시 읽는다.
 * 가짜 DB 모드는 저장 뒤 무효화·탭 동기화(useMockDataSync)로 이미 바로 맞으므로 다시 읽지 않는다.
 * 브라우저 탭이 가려져 있을 때는 TanStack Query 기본값대로 멈춘다.
 */
export const dashboardRefetchInterval = (): number | false => (isServerDataSource() ? DASHBOARD_REFRESH_MS : false);

/** 위젯 하나의 데이터. enabled = 볼 권한이 있을 때만 조회한다 */
export function useDashboardWidget<K extends DataWidgetKey>(key: K, enabled: boolean) {
  const me = useMe();
  return useQuery({
    queryKey: dashboardKeys.widget(key, me.employeeId),
    queryFn: () => dashboardApi.widget(key),
    enabled,
    refetchInterval: dashboardRefetchInterval(),
  });
}
