// 왼쪽 레일 메뉴 (B안). 역할별 업무 메뉴는 그 권한이 조회(VIEW) 이상일 때만 보인다. 승인함은 부서장에게만 보인다.
// 다른 영역의 조회 권한은 메뉴를 늘리지 않고, 화면 안의 연결(링크)로 쓴다.
import { PERMISSION, type Permission, type RoleCode } from '@/codes';
import type { IconName } from '@/components/Icon';
import type { SoonGrade } from '@/components/ComingSoon';
import { canView, isDepartmentHead, type PermissionMap } from '@/lib/permissions';

export type NavBadgeKey = 'notifications' | 'chat' | 'approvals';

export interface NavItem {
  kind: 'item';
  href: string;
  label: string;
  icon: IconName;
  /** 이 중 하나라도 조회(VIEW) 이상이면 보인다. 없으면 모든 사원에게 보인다. */
  permissions?: readonly Permission[];
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

const item = (value: Omit<NavItem, 'kind'>): NavItem => ({ kind: 'item', ...value });

const INVENTORY = item({ href: '/inventories', label: '재고', icon: 'stock' });

const ROLE_MENU: Record<RoleCode, readonly NavItem[]> = {
  SALES: [
    item({ href: '/sales-orders', label: '수주', icon: 'clipboard', permissions: [PERMISSION.SALES_ORDER_CREATE, PERMISSION.SALES_ORDER_CANCEL], match: ['/sales-orders/'] }),
    item({ href: '/sales-orders/new', label: '등록', icon: 'plus', permissions: [PERMISSION.SALES_ORDER_CREATE] }),
    item({ href: '/shipment-requests', label: '출하요청', icon: 'truck', permissions: [PERMISSION.SHIPMENT_REQUEST_MANAGE], match: ['/shipment-requests/'] }),
    INVENTORY,
  ],
  PURCHASE: [
    item({ href: '/mrp', label: 'MRP', icon: 'calc', permissions: [PERMISSION.PURCHASE_REQUISITION_CREATE] }),
    item({ href: '/purchase-requisitions', label: '구매요청', icon: 'cart', permissions: [PERMISSION.PURCHASE_REQUISITION_CREATE], match: ['/purchase-requisitions/', '/action-drafts/'] }),
    item({ href: '/purchase-orders', label: '발주', icon: 'building', permissions: [PERMISSION.PURCHASE_ORDER_CONFIRM] }),
    item({ href: '/goods-receipts', label: '입고', icon: 'box', permissions: [PERMISSION.GOODS_RECEIPT_CONFIRM] }),
    INVENTORY,
  ],
  PRODUCTION: [
    item({ href: '/production/plans', label: '생산계획', icon: 'calendar', permissions: [PERMISSION.PRODUCTION_PLAN_CONFIRM] }),
    item({ href: '/production/results', label: '작업 실적', icon: 'factory', permissions: [PERMISSION.PRODUCTION_RESULT_CONFIRM] }),
    item({ href: '/production/rolling', label: '열연 투입 배정', icon: 'coil', permissions: [PERMISSION.HOT_ROLLING_ALLOCATE] }),
    INVENTORY,
  ],
  QUALITY: [
    item({ href: '/quality/inspections', label: '검사 입력', icon: 'quality', permissions: [PERMISSION.INSPECTION_REGISTER] }),
    item({ href: '/quality/rejected', label: '불합격 관리', icon: 'alert', permissions: [PERMISSION.DISPOSITION_SET] }),
    item({ href: '/quality/standards', label: '검사 기준', icon: 'book', permissions: [PERMISSION.INSPECTION_STANDARD_MANAGE] }),
    INVENTORY,
  ],
  LOGISTICS: [
    item({ href: '/goods-issues', label: '출고 확정', icon: 'truck', permissions: [PERMISSION.GOODS_ISSUE_CONFIRM] }),
    item({ href: '/mill-sheets', label: '밀시트', icon: 'file', permissions: [PERMISSION.MILL_SHEET_READ] }),
    INVENTORY,
  ],
  ADMIN: [
    item({ href: '/admin/employees', label: '사원', icon: 'users', permissions: [PERMISSION.EMPLOYEE_MANAGE] }),
    item({ href: '/admin/organization', label: '부서·직급·권한', icon: 'key', permissions: [PERMISSION.ORG_MANAGE] }),
    item({ href: '/admin/master-data', label: '기준정보', icon: 'database', permissions: [PERMISSION.MASTER_MANAGE] }),
  ],
};

export interface NavUser {
  roleCode: RoleCode;
  permissions: PermissionMap;
  headDepartmentIds: readonly number[];
}

export function buildNavigation(user: NavUser): NavEntry[] {
  const visible = (entry: NavItem) => !entry.permissions || canView(user, ...entry.permissions);
  const approvals: NavItem[] = isDepartmentHead(user) ? [item({ href: '/approvals', label: '승인함', icon: 'approve', badge: 'approvals' })] : [];
  return [
    item({ href: '/dashboard', label: '대시보드', icon: 'dashboard' }),
    ...ROLE_MENU[user.roleCode].filter(visible),
    ...approvals,
    { kind: 'separator', key: 'common' },
    item({ href: '/lots/trace', label: 'LOT 추적', icon: 'trace' }),
    item({ href: '/business-events', label: '작업 로그', icon: 'history' }),
    item({ href: '/tasks', label: '업무·알림', icon: 'task', badge: 'notifications' }),
    item({ href: '/messenger', label: '메신저', icon: 'chat', badge: 'chat' }),
    { kind: 'separator', key: 'soon' },
    item({ href: '/agent', label: 'AI Factory Agent', icon: 'radar', soon: 'P2' }),
    item({ href: '/meetings', label: '회의록', icon: 'mic', soon: 'P2' }),
    item({ href: '/past-cases', label: '과거 사례 검색', icon: 'search', soon: 'EX' }),
  ];
}

/** 지금 주소에 해당하는 메뉴 (가장 길게 맞는 것). '/sales-orders/new'는 '등록'이 '수주'보다 길게 맞는다. */
export function activeNavHref(entries: readonly NavEntry[], pathname: string): string | null {
  let best: string | null = null;
  let bestLength = -1;
  for (const entry of entries) {
    if (entry.kind !== 'item') continue;
    for (const candidate of [entry.href, ...(entry.match ?? [])]) {
      const hit = candidate.endsWith('/') ? pathname.startsWith(candidate) : pathname === candidate || pathname.startsWith(`${candidate}/`);
      if (hit && candidate.length > bestLength) {
        best = entry.href;
        bestLength = candidate.length;
      }
    }
  }
  return best;
}
