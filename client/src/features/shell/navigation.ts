// 왼쪽 레일 메뉴 (B안). 화면과 여는 조건은 screens.ts 한 표를 쓴다.
// 1) 대시보드 2) 역할의 업무 메뉴(열 수 있는 것만) 3) 부서장이면 승인함
// 4) 구분선 뒤: 조회·사용 권한으로 열 수 있는 다른 영역 화면을 영역 순서(영업 → 구매 → 생산 → 품질 → 물류 → 관리)로
// 5) 구분선 뒤: 공통(조직도·LOT 추적·작업 로그·업무·알림·메신저, 역할별 메뉴 v2 표 순서) 6) 구분선 뒤: 준비 중(P2·EX)
import { PERMISSION_AREAS, type RoleCode } from '@/codes';
import type { IconName } from '@/components/Icon';
import type { SoonGrade } from '@/components/ComingSoon';
import { canOpenScreen, SCREEN, SCREENS, screenOfPath, type AccessUser, type NavBadgeKey, type ScreenDef } from '@/features/shell/screens';

export type { NavBadgeKey } from '@/features/shell/screens';

export interface NavItem {
  kind: 'item';
  href: string;
  label: string;
  icon: IconName;
  /** 준비 중 (기능 없이 디자인만) */
  soon?: Exclude<SoonGrade, 'AI'>;
  badge?: NavBadgeKey;
  /** 이 경로로 시작하는 화면(상세 등)도 이 메뉴로 표시한다 */
  match?: readonly string[];
}

export interface NavSeparator {
  kind: 'separator';
  key: string;
}

export type NavEntry = NavItem | NavSeparator;

const toItem = (def: ScreenDef): NavItem => ({
  kind: 'item',
  href: def.href,
  label: def.label,
  icon: def.icon,
  ...(def.soon ? { soon: def.soon } : {}),
  ...(def.badge ? { badge: def.badge } : {}),
  ...(def.match ? { match: def.match } : {}),
});

/** 역할의 업무 메뉴 (1단계 레일과 같다) */
const ROLE_MENU: Record<RoleCode, readonly ScreenDef[]> = {
  SALES: [SCREEN.salesOrders, SCREEN.salesOrderNew, SCREEN.shipmentRequests, SCREEN.inventories],
  PURCHASE: [SCREEN.mrp, SCREEN.purchaseRequisitions, SCREEN.purchaseOrders, SCREEN.goodsReceipts, SCREEN.inventories],
  PRODUCTION: [SCREEN.productionPlans, SCREEN.productionResults, SCREEN.hotRolling, SCREEN.inventories],
  QUALITY: [SCREEN.inspections, SCREEN.rejectedLots, SCREEN.inspectionStandards, SCREEN.inventories],
  LOGISTICS: [SCREEN.goodsIssues, SCREEN.millSheets, SCREEN.inventories],
  ADMIN: [SCREEN.employees, SCREEN.organization, SCREEN.masterData, SCREEN.llmSettings],
};

/** 다른 영역 화면 묶음의 순서: 영역 순서대로, 같은 영역은 표 순서대로. 재고는 모든 사원 화면이라 맨 뒤에 둔다. */
const AREA_SCREENS: readonly ScreenDef[] = [
  ...PERMISSION_AREAS.flatMap((area) => SCREENS.filter((s) => s.area === area)),
  SCREEN.inventories,
];

const COMMON_SCREENS: readonly ScreenDef[] = [SCREEN.orgChart, SCREEN.lotTrace, SCREEN.businessEvents, SCREEN.tasks, SCREEN.messenger];
const SOON_SCREENS: readonly ScreenDef[] = [SCREEN.agent, SCREEN.meetings, SCREEN.pastCases];

export interface NavUser extends AccessUser {
  roleCode: RoleCode;
}

export function buildNavigation(user: NavUser): NavEntry[] {
  const canOpen = (def: ScreenDef) => canOpenScreen(user, def.access);
  const own = ROLE_MENU[user.roleCode].filter(canOpen);
  const ownHrefs = new Set(own.map((def) => def.href));
  const approvals = canOpen(SCREEN.approvals) ? [SCREEN.approvals] : [];
  const others = AREA_SCREENS.filter((def) => !ownHrefs.has(def.href) && canOpen(def));
  return [
    toItem(SCREEN.dashboard),
    ...own.map(toItem),
    ...approvals.map(toItem),
    ...(others.length ? [{ kind: 'separator', key: 'other-areas' } as const, ...others.map(toItem)] : []),
    { kind: 'separator', key: 'common' },
    ...COMMON_SCREENS.map(toItem),
    { kind: 'separator', key: 'soon' },
    ...SOON_SCREENS.map(toItem),
  ];
}

/** 지금 주소에 해당하는 메뉴 (가장 길게 맞는 것). '/sales-orders/new'는 '등록'이 '수주'보다 길게 맞는다. */
export function activeNavHref(entries: readonly NavEntry[], pathname: string): string | null {
  const items = entries.flatMap((entry) => (entry.kind === 'item' ? [entry] : []));
  const hit = screenOfPath(
    pathname,
    items.map((item) => ({ href: item.href, label: item.label, icon: item.icon, access: { kind: 'everyone' }, match: item.match })),
  );
  return hit?.href ?? null;
}
