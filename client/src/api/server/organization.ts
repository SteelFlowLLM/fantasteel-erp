// 조직 관리 화면 ↔ 서버 API (server/src/modules/organization). 서버 응답을 화면이 쓰는 모양(가짜 DB와 같은 타입)으로 바꾼다.
// 사원·부서·직급·역할 id는 서버 id를 그대로 쓴다. ERD에 없는 칸(직급 코드·부서 정렬 순서·최근 접속)은 빈 값으로 둔다.
import type {
  DepartmentNode,
  PageResult,
  DepartmentView as ServerDepartmentView,
  EmployeeView as ServerEmployeeView,
  JobGradeView as ServerJobGradeView,
  RoleView as ServerRoleView,
} from '@fantasteel/shared';
import type { EmployeeCreateInput, EmployeeSaved, EmployeeUpdateInput } from '@/api/adminEmployees';
import type { DeleteInput, DepartmentCreateInput, DepartmentUpdateInput, JobGradeCreateInput, JobGradeUpdateInput, OrgChartDepartmentView, RolePermissionsInput, SavedRef } from '@/api/adminOrganization';
import type { DepartmentView, EmployeeView, JobGradeView, RoleView } from '@/api/directory';
import { FieldErrors, InputError } from '@/api/errors';
import { serverRequest } from '@/api/http';
import type { EmployeeListQuery } from '@/api/queryKeys';
import { DEPARTMENT_CODE_PATTERN, DEPARTMENT_CODE_RULE_TEXT, EMPLOYEE_NO_PATTERN, EMPLOYEE_NO_RULE_TEXT } from '@/features/admin/lib/orgRules';

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

// ── 변경 (API-156·157·159·160·162·164). 서버에는 화면을 연 뒤 바뀌었는지 보는 확인(expectedUpdatedAt)이 없어 보내지 않는다 ──

const savedEmployee = (e: ServerEmployeeView): EmployeeSaved => ({ id: e.id, employeeNo: e.employeeNo, employeeName: e.employeeName, isActive: e.isActive });

/** 사원번호 형식(가정값, orgRules)은 서버에 검사가 없어 화면에서 먼저 확인한다 */
async function createEmployee(input: EmployeeCreateInput): Promise<EmployeeSaved> {
  const { password, employeeName, departmentId, jobGradeId, roleId } = input;
  const employeeNo = input.employeeNo.trim();
  const errors = new FieldErrors();
  if (employeeNo && !EMPLOYEE_NO_PATTERN.test(employeeNo)) errors.add('employeeNo', EMPLOYEE_NO_RULE_TEXT);
  if (!password) errors.add('password', '비밀번호를 입력해 주세요');
  errors.throwIfAny();
  return savedEmployee(await serverRequest<ServerEmployeeView>('POST', '/employees', { body: { employeeNo, password, employeeName, departmentId, jobGradeId, roleId } }));
}

async function updateEmployee(input: EmployeeUpdateInput): Promise<EmployeeSaved> {
  const { employeeName, departmentId, jobGradeId, roleId } = input;
  return savedEmployee(await serverRequest<ServerEmployeeView>('PATCH', `/employees/${input.id}`, { body: { employeeName, departmentId, jobGradeId, roleId } }));
}

/** 퇴사 처리·다시 사용 (사원은 삭제하지 않는다) */
async function setEmployeeActive(id: number, isActive: boolean): Promise<EmployeeSaved> {
  return savedEmployee(await serverRequest<ServerEmployeeView>('PATCH', `/employees/${id}`, { body: { isActive } }));
}

const savedDepartment = (d: ServerDepartmentView): SavedRef => ({ id: d.id, name: d.departmentName });

/** 부서 코드 형식(가정값, orgRules)은 서버에 검사가 없어 화면에서 먼저 확인한다 */
async function createDepartment(input: DepartmentCreateInput): Promise<SavedRef> {
  const departmentCode = input.departmentCode.trim().toUpperCase();
  if (departmentCode && !DEPARTMENT_CODE_PATTERN.test(departmentCode)) throw new InputError('부서 코드를 확인해 주세요', { departmentCode: DEPARTMENT_CODE_RULE_TEXT });
  const { departmentName, parentId } = input;
  return savedDepartment(await serverRequest<ServerDepartmentView>('POST', '/departments', { body: { departmentCode, departmentName, parentId } }));
}

/** 부서코드는 바꾸지 않는다 */
async function updateDepartment(input: DepartmentUpdateInput): Promise<SavedRef> {
  const { departmentName, parentId, headEmployeeId } = input;
  return savedDepartment(await serverRequest<ServerDepartmentView>('PATCH', `/departments/${input.id}`, { body: { departmentName, parentId, headEmployeeId } }));
}

/** API-271. 하위 부서·소속 사원(퇴사자 포함)이 있으면 서버가 COM-004로 막는다 */
async function deleteDepartment(input: DeleteInput): Promise<SavedRef> {
  return savedDepartment(await serverRequest<ServerDepartmentView>('DELETE', `/departments/${input.id}`));
}

function sortOrderOf(input: JobGradeCreateInput): number {
  const sortOrder = String(input.sortOrder).trim();
  if (!/^-?\d+$/.test(sortOrder)) throw new InputError('표시 순서를 확인해 주세요', { sortOrder: '표시 순서는 정수로 입력해 주세요' });
  return Number(sortOrder);
}

async function createJobGrade(input: JobGradeCreateInput): Promise<SavedRef> {
  const saved = await serverRequest<ServerJobGradeView>('POST', '/job-grades', { body: { jobGradeName: input.jobGradeName, sortOrder: sortOrderOf(input) } });
  return { id: saved.id, name: saved.jobGradeName };
}

/** API-272. 직급 코드는 ERD에 없어 보내지 않는다 */
async function updateJobGrade(input: JobGradeUpdateInput): Promise<SavedRef> {
  const saved = await serverRequest<ServerJobGradeView>('PATCH', `/job-grades/${input.id}`, { body: { jobGradeName: input.jobGradeName, sortOrder: sortOrderOf(input) } });
  return { id: saved.id, name: saved.jobGradeName };
}

/** API-273. 쓰는 사원(퇴사자 포함)이 있으면 서버가 COM-004로 막는다 */
async function deleteJobGrade(input: DeleteInput): Promise<SavedRef> {
  const saved = await serverRequest<ServerJobGradeView>('DELETE', `/job-grades/${input.id}`);
  return { id: saved.id, name: saved.jobGradeName };
}

async function replaceRolePermissions(input: RolePermissionsInput): Promise<SavedRef> {
  const saved = await serverRequest<ServerRoleView>('PUT', `/roles/${input.roleId}/permissions`, { body: { permissions: input.permissions } });
  return { id: saved.id, name: saved.roleName };
}

export const serverOrganizationApi = {
  listEmployees,
  listDepartments,
  getOrgChart,
  listJobGrades,
  listRoles,
  createEmployee,
  updateEmployee,
  setEmployeeActive,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  createJobGrade,
  updateJobGrade,
  deleteJobGrade,
  replaceRolePermissions,
};
