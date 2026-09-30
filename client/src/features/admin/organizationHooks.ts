// 사용자·부서·권한 화면이 나눠 쓰는 조회 훅과 표시 도우미. 쿼리 키 첫 요소는 서버 실시간 주제 이름.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { EMPLOYEE_STATUS_LABEL, ROLE_CODE_LABEL, type EmployeeStatus, type RoleCode } from '@fantasteel/shared';
import { departmentApi, employeeApi, roleApi, type DepartmentView, type ListEmployeesQuery, type OrgChartNode } from '@/api/organization';
import type { Tone } from '@/components/ui';

export const useEmployeeList = (q: ListEmployeesQuery) =>
  useQuery({ queryKey: ['employees', 'list', q], queryFn: () => employeeApi.list(q), placeholderData: keepPreviousData });

/** 로그인한 누구나 볼 수 있는 ACTIVE 사원 목록 (부서장 후보). */
export const useDirectory = () => useQuery({ queryKey: ['employees', 'directory'], queryFn: employeeApi.directory });

export const useDepartments = () => useQuery({ queryKey: ['departments', 'list'], queryFn: departmentApi.list });
export const useOrgTree = () => useQuery({ queryKey: ['departments', 'tree'], queryFn: departmentApi.tree });

/** 역할·권한 행렬 (ORG_MANAGE 또는 EMPLOYEE_MANAGE 조회 권한). */
export const useRoles = () => useQuery({ queryKey: ['employees', 'roles'], queryFn: roleApi.list });

export const roleLabel = (code: string, fallback?: string) => ROLE_CODE_LABEL[code as RoleCode] ?? fallback ?? code;
export const statusLabel = (s: EmployeeStatus) => EMPLOYEE_STATUS_LABEL[s];
export const statusTone = (s: EmployeeStatus): Tone => (s === 'ACTIVE' ? 'ok' : s === 'LOCKED' ? 'danger' : 'neutral');
/** 디자인의 아바타 색 (영업 s · 품질 q · 관리자 m). */
export const avatarCls = (roleCode: string) => (roleCode === 'SALES' ? ' hl-avatar--s' : roleCode === 'QUALITY' ? ' hl-avatar--q' : roleCode === 'ADMIN' ? ' hl-avatar--m' : '');

/** 부서 선택 목록: 계층 순서로 펴고 들여쓰기 라벨을 붙인다. */
export function flattenDepartments(list: DepartmentView[]): { dept: DepartmentView; depth: number; label: string }[] {
  const byParent = new Map<number | null, DepartmentView[]>();
  for (const d of list) {
    const k = d.parentId !== null && list.some((x) => x.id === d.parentId) ? d.parentId : null;
    byParent.set(k, [...(byParent.get(k) ?? []), d]);
  }
  const out: { dept: DepartmentView; depth: number; label: string }[] = [];
  const walk = (parent: number | null, depth: number) => {
    for (const d of byParent.get(parent) ?? []) {
      out.push({ dept: d, depth, label: `${depth ? `${'　'.repeat(depth)}└ ` : ''}${d.departmentName}` });
      walk(d.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** 부서 id → 그 부서와 모든 하위 부서 id (상위 부서 후보에서 순환을 미리 거를 때). */
export function descendantIds(list: DepartmentView[], id: number): Set<number> {
  const out = new Set<number>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of list) if (d.parentId !== null && out.has(d.parentId) && !out.has(d.id)) { out.add(d.id); grew = true; }
  }
  return out;
}

export const countOrgMembers = (n: OrgChartNode): number => n.members.length + n.children.reduce((s, c) => s + countOrgMembers(c), 0);
