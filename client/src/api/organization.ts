// 사원·부서·역할(권한 행렬) API — docs/api/organization.md 의 모양 그대로.
import type { EmployeeStatus, RoleCode } from '@fantasteel/shared';
import { api } from './client';

export type PermissionLevelValue = 'USE' | 'VIEW';

/** GET /employees, GET /employees/:id, POST·PATCH 결과 */
export interface EmployeeView {
  id: number;
  employeeNo: string;
  employeeName: string;
  email: string | null;
  departmentId: number;
  departmentName: string;
  roleId: number;
  roleCode: string;
  roleName: string;
  jobGrade: string;
  employeeStatus: EmployeeStatus;
  failedLoginCount: number;
  lastLoginAt: string | null;
  isDepartmentHead: boolean;
  createdAt: string;
  updatedAt: string;
}

/** GET /employees/directory — 로그인한 누구나, ACTIVE 사원만 */
export interface EmployeeDirectoryEntry {
  id: number;
  employeeNo: string;
  employeeName: string;
  departmentId: number;
  departmentName: string;
  jobGrade: string;
  roleCode: string;
  isDepartmentHead: boolean;
}

export interface DepartmentView {
  id: number;
  departmentCode: string;
  departmentName: string;
  parentId: number | null;
  headEmployeeId: number | null;
  headEmployeeName: string | null;
  sortOrder: number;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrgChartMember {
  id: number;
  employeeName: string;
  jobGrade: string;
  roleCode: string;
  isHead: boolean;
}

export interface OrgChartNode {
  id: number;
  departmentCode: string;
  departmentName: string;
  sortOrder: number;
  head: { id: number; employeeName: string; jobGrade: string } | null;
  members: OrgChartMember[];
  children: OrgChartNode[];
}

export interface PermissionEntry { permissionCode: string; permissionLevel: PermissionLevelValue }
export interface RoleView { id: number; roleCode: string; roleName: string; permissions: PermissionEntry[] }

export interface ListEmployeesQuery {
  departmentId?: number;
  roleCode?: RoleCode;
  employeeStatus?: EmployeeStatus;
  keyword?: string;
}

export interface CreateEmployeeBody {
  employeeNo: string;
  employeeName: string;
  departmentId: number;
  roleId: number;
  jobGrade: string;
  email?: string;
  initialPassword: string;
}

export interface UpdateEmployeeBody {
  employeeName?: string;
  departmentId?: number;
  roleId?: number;
  jobGrade?: string;
  email?: string | null;
  employeeStatus?: 'ACTIVE' | 'INACTIVE';
}

export interface CreateDepartmentBody {
  departmentCode: string;
  departmentName: string;
  parentId?: number | null;
  headEmployeeId?: number | null;
  sortOrder?: number;
}

export interface UpdateDepartmentBody {
  departmentName?: string;
  parentId?: number | null;
  headEmployeeId?: number | null;
  sortOrder?: number;
}

export const employeeApi = {
  list: (q: ListEmployeesQuery = {}) => api.get<EmployeeView[]>('/employees', { ...q }),
  directory: () => api.get<EmployeeDirectoryEntry[]>('/employees/directory'),
  create: (dto: CreateEmployeeBody) => api.post<EmployeeView>('/employees', dto),
  update: ({ id, ...dto }: UpdateEmployeeBody & { id: number }) => api.patch<EmployeeView>(`/employees/${id}`, dto),
  unlock: (id: number) => api.post<EmployeeView>(`/employees/${id}/unlock`),
  resetPassword: ({ id, newPassword }: { id: number; newPassword: string }) => api.post<EmployeeView>(`/employees/${id}/reset-password`, { newPassword }),
};

export const departmentApi = {
  list: () => api.get<DepartmentView[]>('/departments'),
  tree: () => api.get<OrgChartNode[]>('/departments/tree'),
  create: (dto: CreateDepartmentBody) => api.post<DepartmentView>('/departments', dto),
  update: ({ id, ...dto }: UpdateDepartmentBody & { id: number }) => api.patch<DepartmentView>(`/departments/${id}`, dto),
};

export const roleApi = {
  list: () => api.get<RoleView[]>('/roles'),
  replacePermissions: ({ id, permissions }: { id: number; permissions: PermissionEntry[] }) => api.put<RoleView>(`/roles/${id}/permissions`, { permissions }),
};
