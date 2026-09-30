// 조직 정보에서 사람 고르기 (REQ-ORG-004): 메신저 멤버 선택·업무 담당자 지정.
// 로그인한 누구나 부를 수 있는 두 조회만 쓴다 — docs/api/organization.md.
import { useQuery } from '@tanstack/react-query';
import { api } from './client';

/** GET /employees/directory — ACTIVE 사원만 (부서 id, 사원번호순) */
export interface DirectoryEmployee {
  id: number;
  employeeNo: string;
  employeeName: string;
  departmentId: number;
  departmentName: string;
  jobGrade: string;
  roleCode: string;
  isDepartmentHead: boolean;
}

export interface DirectoryTreeMember {
  id: number;
  employeeName: string;
  jobGrade: string;
  roleCode: string;
  /** 이 부서의 부서장인지 */
  isHead: boolean;
}

/** GET /departments/tree — 조직도 */
export interface DirectoryTreeNode {
  id: number;
  departmentCode: string;
  departmentName: string;
  sortOrder: number;
  head: { id: number; employeeName: string; jobGrade: string } | null;
  members: DirectoryTreeMember[];
  children: DirectoryTreeNode[];
}

export const directoryApi = {
  employees: () => api.get<DirectoryEmployee[]>('/employees/directory'),
  tree: () => api.get<DirectoryTreeNode[]>('/departments/tree'),
};

const STALE = 60_000;

export function useDirectoryEmployees(enabled = true) {
  return useQuery({ queryKey: ['employees', 'directory'], queryFn: directoryApi.employees, staleTime: STALE, enabled });
}

export function useDirectoryTree(enabled = true) {
  return useQuery({ queryKey: ['departments', 'tree'], queryFn: directoryApi.tree, staleTime: STALE, enabled });
}
