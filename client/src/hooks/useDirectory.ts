// 조직 조회 훅 (사원·부서·조직도·직급·역할)
import { useQuery } from '@tanstack/react-query';
import { directoryApi } from '@/api/directory';
import { queryKeys, type EmployeeListQuery } from '@/api/queryKeys';

export function useEmployeeList(query: EmployeeListQuery = {}) {
  return useQuery({ queryKey: queryKeys.employees(query), queryFn: () => directoryApi.listEmployees(query) });
}

export function useDepartmentList() {
  return useQuery({ queryKey: queryKeys.departments(), queryFn: directoryApi.listDepartments });
}

export function useOrgChart() {
  return useQuery({ queryKey: queryKeys.orgChart(), queryFn: directoryApi.getOrgChart });
}

export function useJobGradeList() {
  return useQuery({ queryKey: queryKeys.jobGrades(), queryFn: directoryApi.listJobGrades });
}

export function useRoleList() {
  return useQuery({ queryKey: queryKeys.roles(), queryFn: directoryApi.listRoles });
}
