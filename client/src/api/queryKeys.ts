// 조회 키 모음. 첫 요소 = 주제(API 복수 명사). 같은 주제로 시작하는 키는 한꺼번에 무효화할 수 있다.
import type { ItemType, ProductItemType, RoleCode } from '@/codes';

export interface EmployeeListQuery {
  departmentId?: number;
  roleCode?: RoleCode;
  isActive?: boolean;
  keyword?: string;
}

export interface ItemListQuery {
  itemType?: ItemType;
}

export interface ProductSpecListQuery {
  itemType?: ProductItemType;
  steelGradeId?: number;
}

export const queryKeys = {
  session: (employeeId: number) => ['session', employeeId] as const,
  accounts: () => ['employees', 'accounts'] as const,
  managedEmployees: (query: EmployeeListQuery = {}) => ['employees', 'managed', query] as const,
  departments: () => ['departments', 'list'] as const,
  orgChart: () => ['departments', 'org-chart'] as const,
  jobGrades: () => ['job-grades', 'list'] as const,
  roles: () => ['roles', 'list'] as const,
  customers: () => ['customers', 'list'] as const,
  suppliers: () => ['suppliers', 'list'] as const,
  yards: () => ['yards', 'list'] as const,
  steelGrades: () => ['steel-grades', 'list'] as const,
  items: (query: ItemListQuery = {}) => ['items', 'list', query] as const,
  productSpecs: (query: ProductSpecListQuery = {}) => ['product-specs', 'list', query] as const,
  specMappings: () => ['spec-mappings', 'list'] as const,
  routings: () => ['routings', 'list'] as const,
  specificConsumptions: () => ['specific-consumptions', 'list'] as const,
  productionSetting: () => ['production-settings'] as const,
  unreadNotificationCount: (employeeId: number) => ['notifications', 'unread-count', employeeId] as const,
  recentNotifications: (employeeId: number) => ['notifications', 'recent', employeeId] as const,
  unreadChatCount: (employeeId: number) => ['chat-rooms', 'unread-count', employeeId] as const,
  recentChatRooms: (employeeId: number) => ['chat-rooms', 'recent', employeeId] as const,
  approvalWaitingCount: (employeeId: number) => ['purchase-requisitions', 'approval-waiting-count', employeeId] as const,
  search: (keyword: string) => ['search', keyword] as const,
};
