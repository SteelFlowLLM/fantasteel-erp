// 왼쪽 레일 메뉴 (B안). 역할별 업무 메뉴 + 공통(추적·협업). 권한(VIEW 이상)이 없으면 보이지 않는다.
import type { AuthUser, Permission } from '@fantasteel/shared';

export interface NavItem {
  path: string;
  label: string;
  icon: string;
  /** 이 중 하나라도 VIEW 이상이면 보인다. 없으면 모든 로그인 사용자. */
  permissions?: Permission[];
  /** 부서장에게만 보인다 */
  headOnly?: boolean;
  /** 준비 중 표시 (기능 없음, 디자인만) */
  soon?: 'P2' | 'EX';
  /** 실시간 배지 키 (shell/useNavBadges) */
  badge?: string;
  /** 이 경로들도 같은 메뉴로 표시 (상세 화면 등) */
  match?: string[];
}
export type NavEntry = NavItem | 'sep';

const ROLE_MENU: Record<string, NavItem[]> = {
  SALES: [
    { path: '/sales-orders', label: '수주', icon: 'order', permissions: ['ORDER_CREATE'], match: ['/sales-orders/'] },
    { path: '/sales-orders/new', label: '등록', icon: 'plus', permissions: ['ORDER_CREATE'] },
    { path: '/shipment-requests', label: '출하요청', icon: 'truck', permissions: ['SHIPMENT_REQUEST'], badge: 'shipmentWaiting', match: ['/shipment-requests/'] },
    { path: '/inventories', label: '재고', icon: 'stock' },
    { path: '/mill-sheets', label: '밀시트', icon: 'file', permissions: ['MILLSHEET_READ'] },
  ],
  PURCHASE: [
    { path: '/mrp', label: 'MRP', icon: 'calc', permissions: ['PURCHASE_REQUISITION_CREATE'] },
    { path: '/purchase-requisitions', label: '구매요청', icon: 'cart', permissions: ['PURCHASE_REQUISITION_CREATE'], match: ['/purchase-requisitions/', '/action-drafts/'] },
    { path: '/purchase-orders', label: '발주', icon: 'building', permissions: ['PO_CONFIRM'] },
    { path: '/goods-receipts', label: '입고', icon: 'box', permissions: ['RECEIPT_CONFIRM'] },
    { path: '/inventories', label: '재고', icon: 'stock' },
  ],
  PRODUCTION: [
    { path: '/production/plans', label: '생산계획', icon: 'calendar', permissions: ['PLAN_CONFIRM'], badge: 'plansToConfirm' },
    { path: '/production/results', label: '공정 실적', icon: 'factory', permissions: ['RESULT_CONFIRM'] },
    { path: '/production/rolling', label: '열연 투입', icon: 'coil', permissions: ['ROLLING_ALLOCATE'] },
    { path: '/purchase-requisitions', label: '구매요청', icon: 'cart', permissions: ['PURCHASE_REQUISITION_CREATE'], match: ['/purchase-requisitions/', '/action-drafts/'] },
    { path: '/inventories', label: '재고', icon: 'stock' },
  ],
  QUALITY: [
    { path: '/quality/inspections', label: '검사 입력', icon: 'quality', permissions: ['INSPECTION_REGISTER'], badge: 'inspectionsPending' },
    { path: '/quality/rejected', label: '불합격 관리', icon: 'alert', permissions: ['DISPOSITION_SET'] },
    { path: '/inventories', label: '재고', icon: 'stock' },
    { path: '/mill-sheets', label: '밀시트', icon: 'file', permissions: ['MILLSHEET_READ'] },
  ],
  LOGISTICS: [
    { path: '/goods-issues', label: '출고 확정', icon: 'truck', permissions: ['GOODS_ISSUE_CONFIRM'], badge: 'goodsIssueWaiting' },
    { path: '/mill-sheets', label: '밀시트', icon: 'file', permissions: ['MILLSHEET_READ'] },
    { path: '/inventories', label: '재고', icon: 'stock' },
  ],
  ADMIN: [
    { path: '/admin/employees', label: '사용자', icon: 'users', permissions: ['EMPLOYEE_MANAGE'] },
    { path: '/admin/organization', label: '부서·권한', icon: 'key', permissions: ['ORG_MANAGE'] },
    { path: '/admin/master-data', label: '기준정보', icon: 'database', permissions: ['MASTER_MANAGE'] },
    { path: '/inventories', label: '재고', icon: 'stock' },
  ],
};

export function navFor(user: AuthUser): NavEntry[] {
  const visible = (i: NavItem) => (!i.permissions || i.permissions.some((p) => !!user.permissions[p])) && (!i.headOnly || user.headDepartmentIds.length > 0);
  const work = (ROLE_MENU[user.roleCode] ?? []).filter(visible);
  const head: NavItem[] = user.headDepartmentIds.length
    ? [
        { path: '/approvals', label: '승인함', icon: 'approve', badge: 'approvals' },
        { path: '/agent', label: 'Agent', icon: 'radar', soon: 'P2' },
      ]
    : [];
  return [
    { path: '/dashboard', label: '대시보드', icon: 'dashboard' },
    ...work,
    ...head,
    'sep',
    { path: '/lots/trace', label: 'LOT 추적', icon: 'trace' },
    { path: '/business-events', label: '작업 로그', icon: 'history' },
    { path: '/past-cases', label: '사례 검색', icon: 'search', soon: 'EX' },
    'sep',
    { path: '/tasks', label: '업무·알림', icon: 'task', badge: 'notifications' },
    { path: '/messenger', label: '메신저', icon: 'chat', badge: 'chat' },
    { path: '/meetings', label: '회의록', icon: 'mic', soon: 'P2' },
  ];
}

/** 현재 주소에 해당하는 메뉴 (가장 길게 맞는 것). */
export function activeNavPath(entries: NavEntry[], pathname: string): string | null {
  let best: string | null = null;
  let bestLen = -1;
  for (const e of entries) {
    if (e === 'sep') continue;
    const candidates = [e.path, ...(e.match ?? [])];
    for (const c of candidates) {
      const hit = c.endsWith('/') ? pathname.startsWith(c) : pathname === c || pathname.startsWith(`${c}/`);
      if (hit && c.length > bestLen) {
        // '/sales-orders/new'는 '등록' 메뉴가 더 길게 맞으므로 자연히 우선한다
        best = e.path;
        bestLen = c.length;
      }
    }
  }
  return best;
}
