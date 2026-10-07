// 조직 관리 화면 ↔ 서버 API (server/src/modules/organization). 서버 응답을 화면이 쓰는 모양(가짜 DB와 같은 타입)으로 바꾼다.
// 사원·부서·직급·역할 id는 서버 id를 그대로 쓴다. ERD에 없는 칸(직급 코드·부서 정렬 순서·최근 접속)은 빈 값으로 두고 화면이 서버 모드에서 숨긴다.
import type {
  DepartmentNode,
  PageResult,
  EmployeeView as ServerEmployeeView,
  JobGradeView as ServerJobGradeView,
  RoleView as ServerRoleView,
} from '@fantasteel/shared';
import type { OrgChartDepartmentView } from '@/api/adminOrganization';
import type { DepartmentView, EmployeeView, JobGradeView, RoleView } from '@/api/directory';
import { serverRequest } from '@/api/http';
import type { EmployeeListQuery } from '@/api/queryKeys';

const PAGE_SIZE = 100;

async function listEmployees(query: EmployeeListQuery): Promise<EmployeeView[]> {
  const rows: ServerEmployeeView[] = [];
  for (let page = 1; ; page++) {
    const result = await serverRequest<PageResult<ServerEmployeeView>>('GET', '/employees', {
      query: {
        departmentId: query.departmentId,
        roleCode: query.roleCode,
        isActive: query.isActive === undefined ? undefined : String(query.isActive),
        keyword: query.keyword?.trim() || undefined,
        page,
        size: PAGE_SIZE,
      },
    });
    rows.push(...result.items);
    if (rows.length >= result.total || result.items.length === 0) break;
  }
  return rows.map((e) => ({ ...e, lastLoginAt: null }));
}

const departmentTree = () => serverRequest<DepartmentNode[]>('GET', '/departments');

/** 트리를 화면 목록 순서(상위 → 하위)로 편다 */
function flatten(nodes: DepartmentNode[], depth = 0, parentName: string | null = null): { node: DepartmentNode; depth: number; parentName: string | null }[] {
  return nodes.flatMap((node) => [{ node, depth, parentName }, ...flatten(node.children, depth + 1, node.departmentName)]);
}

async function listDepartments(): Promise<DepartmentView[]> {
  return flatten(await departmentTree()).map(({ node, depth, parentName }) => ({
    id: node.id,
    departmentCode: node.departmentCode,
    departmentName: node.departmentName,
    parentId: node.parentId,
    parentName,
    headEmployeeId: node.headEmployeeId,
    headEmployeeName: node.headEmployeeName,
    sortOrder: 0,
    depth,
    memberCount: node.members.length,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  }));
}

async function getOrgChart(): Promise<OrgChartDepartmentView[]> {
  const tree = await departmentTree();
  // 부서장은 다른 부서 소속일 수도 있어 트리 전체 인원에서 직급을 찾는다
  const memberById = new Map(flatten(tree).flatMap(({ node }) => node.members.map((m) => [m.id, m] as const)));
  const build = (nodes: DepartmentNode[], depth: number): OrgChartDepartmentView[] =>
    nodes.map((node) => {
      const children = build(node.children, depth + 1);
      const head = node.headEmployeeId === null ? undefined : memberById.get(node.headEmployeeId);
      return {
        id: node.id,
        departmentCode: node.departmentCode,
        departmentName: node.departmentName,
        depth,
        head: node.headEmployeeId === null ? null : { id: node.headEmployeeId, employeeName: node.headEmployeeName ?? '-', jobGradeName: head?.jobGradeName ?? '-' },
        members: node.members.map((m) => ({ id: m.id, employeeNo: m.employeeNo, employeeName: m.employeeName, jobGradeName: m.jobGradeName, isHead: m.isHead })),
        totalMemberCount: node.members.length + children.reduce((sum, child) => sum + child.totalMemberCount, 0),
        children,
      };
    });
  return build(tree, 0);
}

async function listJobGrades(): Promise<JobGradeView[]> {
  const rows = await serverRequest<ServerJobGradeView[]>('GET', '/job-grades');
  return rows.map((g) => ({ id: g.id, jobGradeCode: '', jobGradeName: g.jobGradeName, sortOrder: g.sortOrder, employeeCount: g.employeeCount, updatedAt: g.updatedAt }));
}

async function listRoles(): Promise<RoleView[]> {
  const rows = await serverRequest<ServerRoleView[]>('GET', '/roles');
  return rows.map((r) => ({ id: r.id, roleCode: r.roleCode, roleName: r.roleName, permissions: r.permissions, employeeCount: r.employeeCount, updatedAt: r.updatedAt }));
}

export const serverOrganizationApi = { listEmployees, listDepartments, getOrgChart, listJobGrades, listRoles };
