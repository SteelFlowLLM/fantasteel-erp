// (main) 화면 목록과 여는 조건. 왼쪽 레일과 화면 잠금(RouteGuard)이 같은 표를 쓴다.
// 권한이 있는 화면: 조회(VIEW) 이상이면 열리고, 사용(USE)이 없으면 읽기 전용이다. 등록 화면은 사용 권한이 있어야 열린다.
// 승인함은 부서장만(REQ-AUTH-004), 대시보드·LOT 추적·작업 로그·업무·알림·메신저·재고는 모든 사원이 연다.
import { PERMISSION, type Permission, type PermissionArea } from '@/codes';
import type { IconName } from '@/components/Icon';
import { canUse, canView, isDepartmentHead, type PermissionMap } from '@/lib/permissions';

export type NavBadgeKey = 'notifications' | 'chat' | 'approvals';

export type ScreenAccess =
  | { kind: 'everyone' }
  | { kind: 'departmentHead' }
  /** VIEW = 조회 이상이면 연다(사용 권한이 없으면 읽기 전용), USE = 사용 권한이 있어야 연다 */
  | { kind: 'permission'; level: 'VIEW' | 'USE'; permissions: readonly Permission[] };

export interface ScreenDef {
  href: string;
  label: string;
  icon: IconName;
  access: ScreenAccess;
  /** 레일의 '다른 영역 화면' 묶음에 넣을 때의 영역. 없으면 그 묶음에 넣지 않는다. */
  area?: PermissionArea;
  /** 이 경로로 시작하는 화면(상세 등)도 이 화면으로 본다 */
  match?: readonly string[];
  badge?: NavBadgeKey;
  /** 준비 중 (기능 없이 디자인만) */
  soon?: 'P2' | 'EX';
}

const EVERYONE: ScreenAccess = { kind: 'everyone' };
const view = (...permissions: Permission[]): ScreenAccess => ({ kind: 'permission', level: 'VIEW', permissions });
const use = (...permissions: Permission[]): ScreenAccess => ({ kind: 'permission', level: 'USE', permissions });

const screen = (def: ScreenDef): ScreenDef => def;

export const SCREEN = {
  dashboard: screen({ href: '/dashboard', label: '대시보드', icon: 'dashboard', access: EVERYONE }),
  salesOrders: screen({
    href: '/sales-orders',
    label: '수주',
    icon: 'clipboard',
    access: view(PERMISSION.SALES_ORDER_CREATE, PERMISSION.SALES_ORDER_CANCEL),
    area: '영업',
    match: ['/sales-orders/'],
  }),
  salesOrderNew: screen({ href: '/sales-orders/new', label: '등록', icon: 'plus', access: use(PERMISSION.SALES_ORDER_CREATE) }),
  shipmentRequests: screen({
    href: '/shipment-requests',
    label: '출하요청',
    icon: 'truck',
    access: view(PERMISSION.SHIPMENT_REQUEST_MANAGE),
    area: '영업',
    match: ['/shipment-requests/'],
  }),
  shipmentRequestNew: screen({ href: '/shipment-requests/new', label: '출하요청 등록', icon: 'plus', access: use(PERMISSION.SHIPMENT_REQUEST_MANAGE) }),
  inventories: screen({ href: '/inventories', label: '재고', icon: 'stock', access: EVERYONE }),
  mrp: screen({ href: '/mrp', label: 'MRP', icon: 'calc', access: view(PERMISSION.PURCHASE_REQUISITION_CREATE), area: '구매' }),
  purchaseRequisitions: screen({
    href: '/purchase-requisitions',
    label: '구매요청',
    icon: 'cart',
    access: view(PERMISSION.PURCHASE_REQUISITION_CREATE),
    area: '구매',
    match: ['/purchase-requisitions/', '/action-drafts/'],
  }),
  purchaseOrders: screen({ href: '/purchase-orders', label: '발주', icon: 'building', access: view(PERMISSION.PURCHASE_ORDER_CONFIRM), area: '구매' }),
  goodsReceipts: screen({ href: '/goods-receipts', label: '입고', icon: 'box', access: view(PERMISSION.GOODS_RECEIPT_CONFIRM), area: '구매' }),
  approvals: screen({ href: '/approvals', label: '승인함', icon: 'approve', access: { kind: 'departmentHead' }, badge: 'approvals' }),
  productionPlans: screen({ href: '/production/plans', label: '생산계획', icon: 'calendar', access: view(PERMISSION.PRODUCTION_PLAN_CONFIRM), area: '생산' }),
  productionResults: screen({
    href: '/production/results',
    label: '작업 실적',
    icon: 'factory',
    access: view(PERMISSION.PRODUCTION_RESULT_CONFIRM),
    area: '생산',
  }),
  hotRolling: screen({ href: '/production/rolling', label: '열연 투입 배정', icon: 'coil', access: view(PERMISSION.HOT_ROLLING_ALLOCATE), area: '생산' }),
  inspections: screen({ href: '/quality/inspections', label: '검사 입력', icon: 'quality', access: view(PERMISSION.INSPECTION_REGISTER), area: '품질' }),
  rejectedLots: screen({ href: '/quality/rejected', label: '불합격 관리', icon: 'alert', access: view(PERMISSION.DISPOSITION_SET), area: '품질' }),
  inspectionStandards: screen({
    href: '/quality/standards',
    label: '검사 기준',
    icon: 'book',
    access: view(PERMISSION.INSPECTION_STANDARD_MANAGE),
    area: '품질',
  }),
  goodsIssues: screen({ href: '/goods-issues', label: '출고 확정', icon: 'truck', access: view(PERMISSION.GOODS_ISSUE_CONFIRM), area: '물류' }),
  millSheets: screen({ href: '/mill-sheets', label: '밀시트', icon: 'file', access: view(PERMISSION.MILL_SHEET_READ), area: '물류' }),
  employees: screen({ href: '/admin/employees', label: '사원', icon: 'users', access: view(PERMISSION.EMPLOYEE_MANAGE), area: '관리' }),
  organization: screen({ href: '/admin/organization', label: '부서·직급·권한', icon: 'key', access: view(PERMISSION.ORG_MANAGE), area: '관리' }),
  masterData: screen({ href: '/admin/master-data', label: '기준정보', icon: 'database', access: view(PERMISSION.MASTER_MANAGE), area: '관리' }),
  orgChart: screen({ href: '/org-chart', label: '조직도', icon: 'building', access: EVERYONE }),
  lotTrace: screen({ href: '/lots/trace', label: 'LOT 추적', icon: 'trace', access: EVERYONE }),
  businessEvents: screen({ href: '/business-events', label: '작업 로그', icon: 'history', access: EVERYONE }),
  tasks: screen({ href: '/tasks', label: '업무·알림', icon: 'task', access: EVERYONE, badge: 'notifications' }),
  messenger: screen({ href: '/messenger', label: '메신저', icon: 'chat', access: EVERYONE, badge: 'chat' }),
  agent: screen({ href: '/agent', label: 'AI Factory Agent', icon: 'radar', access: EVERYONE, soon: 'P2' }),
  meetings: screen({ href: '/meetings', label: '회의록', icon: 'mic', access: EVERYONE, soon: 'P2' }),
  pastCases: screen({ href: '/past-cases', label: '과거 사례 검색', icon: 'search', access: EVERYONE, soon: 'EX' }),
} as const satisfies Record<string, ScreenDef>;

export const SCREENS: readonly ScreenDef[] = Object.values(SCREEN);

export interface AccessUser {
  permissions: PermissionMap;
  headDepartmentIds: readonly number[];
}

/** 이 화면을 열 수 있는지 */
export function canOpenScreen(user: AccessUser, access: ScreenAccess): boolean {
  switch (access.kind) {
    case 'everyone':
      return true;
    case 'departmentHead':
      return isDepartmentHead(user);
    case 'permission':
      return access.level === 'USE' ? canUse(user, ...access.permissions) : canView(user, ...access.permissions);
  }
}

/** 주소가 가리키는 화면 (가장 길게 맞는 것). '/sales-orders/new'는 '등록'이 '수주'보다 길게 맞는다. */
export function screenOfPath(pathname: string, screens: readonly ScreenDef[] = SCREENS): ScreenDef | null {
  let best: ScreenDef | null = null;
  let bestLength = -1;
  for (const entry of screens) {
    for (const candidate of [entry.href, ...(entry.match ?? [])]) {
      const hit = candidate.endsWith('/') ? pathname.startsWith(candidate) : pathname === candidate || pathname.startsWith(`${candidate}/`);
      if (hit && candidate.length > bestLength) {
        best = entry;
        bestLength = candidate.length;
      }
    }
  }
  return best;
}

/** 열 때 필요한 권한 문구 (잠금 화면 안내). 예: "기준정보 관리 조회 이상 권한" */
export function accessRequirementText(access: ScreenAccess, labelOf: (permission: Permission) => string): string {
  switch (access.kind) {
    case 'everyone':
      return '';
    case 'departmentHead':
      return '부서장만 볼 수 있어요';
    case 'permission': {
      const names = access.permissions.map(labelOf).join('·');
      return access.level === 'USE' ? `${names} 사용 권한이 있어야 열 수 있어요` : `${names} 조회 이상 권한이 있어야 열 수 있어요`;
    }
  }
}
