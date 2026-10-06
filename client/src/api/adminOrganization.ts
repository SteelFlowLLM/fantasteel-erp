// 부서·직급·역할 권한 관리와 조직도 (REQ-AUTH-002·003, REQ-ORG-001~003, BP-AUTH-01).
// 목록 조회는 directory.ts(directoryApi.listDepartments·listJobGrades·listRoles)를 쓴다.
// - 부서·직급·역할 권한 변경은 모두 부서·권한 관리(ORG_MANAGE) 사용 권한을 다시 확인한다 (COM-002). 직급은 이 화면의 탭이라 같은 권한으로 둔다(가정).
// - 부서 계층 순환 금지: 자기 자신·하위 부서를 상위 부서로 지정할 수 없다 (BP-AUTH-01 구현 제안).
// - 부서장은 그 부서의 사용 중인 사원 1명 (REQ-ORG-002). 부서장은 역할이 아니다.
// - 삭제는 참조가 없을 때만 (컨벤션 7-2). 거부는 InputError.
// - 조직 변경에 맞는 BUSINESS_EVENT_TYPE이 없어 작업 로그는 남기지 않는다 (areas/cross-cutting.md 7장).
import { PERMISSION_LEVEL, PERMISSIONS, PERMISSION, type Permission, type PermissionLevel } from '@/codes';
import { requireActor } from '@/api/actor';
import { FieldErrors, InputError, mockMutation, mockQuery } from '@/api/client';
import { compareByJobGrade, orderDepartments } from '@/api/orgViews';
import { assertUnchanged, nonNegativeInteger, requiredText, requireRow } from '@/api/validation';
import {
  DEPARTMENT_CODE_PATTERN,
  DEPARTMENT_CODE_RULE_TEXT,
  JOB_GRADE_CODE_PATTERN,
  JOB_GRADE_CODE_RULE_TEXT,
  blockedParentIdsOf,
} from '@/features/admin/lib/orgRules';
import type { MockTables } from '@/mock/schema';
import { insertRow, updateRow } from '@/mock/store';

const MANAGE = { use: [PERMISSION.ORG_MANAGE] } as const;

export const adminOrgKeys = {
  orgChart: () => ['departments', 'admin-org-chart'] as const,
};

// ── 입력 모양 ─────────────────────────────────────────────

export interface DepartmentCreateInput {
  departmentCode: string;
  departmentName: string;
  parentId: number | null;
  sortOrder: number | string;
}

export interface DepartmentUpdateInput extends DepartmentCreateInput {
  id: number;
  headEmployeeId: number | null;
  expectedUpdatedAt?: string | null;
}

export interface DeleteInput {
  id: number;
  expectedUpdatedAt?: string | null;
}

export interface JobGradeCreateInput {
  jobGradeCode: string;
  jobGradeName: string;
  sortOrder: number | string;
}

export interface JobGradeUpdateInput extends JobGradeCreateInput {
  id: number;
  expectedUpdatedAt?: string | null;
}

export interface RolePermissionsInput {
  roleId: number;
  /** 사용·조회만 보낸다. 없는 권한은 행을 두지 않는다. */
  permissions: { permission: Permission; permissionLevel: PermissionLevel }[];
  expectedUpdatedAt?: string | null;
}

export interface SavedRef {
  id: number;
  name: string;
}

// ── 조직도 (REQ-ORG-003) ──────────────────────────────────

export interface OrgChartMemberView {
  id: number;
  employeeNo: string;
  employeeName: string;
  jobGradeName: string;
  isHead: boolean;
}

export interface OrgChartDepartmentView {
  id: number;
  departmentCode: string;
  departmentName: string;
  depth: number;
  head: { id: number; employeeName: string; jobGradeName: string } | null;
  /** 사용 중인 소속 사원. 직급 표시 순서 → 사원번호 순 */
  members: OrgChartMemberView[];
  /** 하위 부서까지 더한 인원 */
  totalMemberCount: number;
  children: OrgChartDepartmentView[];
}

function buildOrgChart(tables: Readonly<MockTables>): OrgChartDepartmentView[] {
  const gradeName = (jobGradeId: number) => tables.jobGrade.find((g) => g.id === jobGradeId)?.jobGradeName ?? '-';
  const compare = compareByJobGrade(tables);
  const ordered = orderDepartments(tables);
  const build = (parentId: number | null): OrgChartDepartmentView[] =>
    ordered
      .filter(({ department }) => department.parentId === parentId)
      .map(({ department, depth }) => {
        const head = tables.employee.find((e) => e.id === department.headEmployeeId);
        const members = tables.employee
          .filter((e) => e.isActive && e.departmentId === department.id)
          .sort(compare)
          .map((e) => ({ id: e.id, employeeNo: e.employeeNo, employeeName: e.employeeName, jobGradeName: gradeName(e.jobGradeId), isHead: e.id === department.headEmployeeId }));
        const children = build(department.id);
        return {
          id: department.id,
          departmentCode: department.departmentCode,
          departmentName: department.departmentName,
          depth,
          head: head ? { id: head.id, employeeName: head.employeeName, jobGradeName: gradeName(head.jobGradeId) } : null,
          members,
          totalMemberCount: members.length + children.reduce((sum, child) => sum + child.totalMemberCount, 0),
          children,
        };
      });
  return build(null);
}

// ── 부서 ─────────────────────────────────────────────────

function readDepartmentFields(tables: Readonly<MockTables>, errors: FieldErrors, input: DepartmentCreateInput, selfId: number | null) {
  const departmentCode = requiredText(errors, 'departmentCode', input.departmentCode.toUpperCase(), '부서 코드', 30);
  if (departmentCode !== null && !DEPARTMENT_CODE_PATTERN.test(departmentCode)) errors.add('departmentCode', DEPARTMENT_CODE_RULE_TEXT);
  else if (departmentCode !== null && tables.department.some((d) => d.id !== selfId && d.departmentCode === departmentCode)) {
    errors.add('departmentCode', '이미 쓰는 부서 코드예요');
  }
  const departmentName = requiredText(errors, 'departmentName', input.departmentName, '부서명', 50);
  const sortOrder = nonNegativeInteger(errors, 'sortOrder', input.sortOrder, '정렬 순서');
  if (input.parentId !== null && blockedParentIdsOf(tables.department, selfId).has(input.parentId)) {
    errors.add('parentId', '자기 자신이나 하위 부서는 상위 부서로 지정할 수 없어요');
  }
  errors.throwIfAny();
  const parent = input.parentId === null ? null : requireRow(tables, 'department', input.parentId, '상위 부서');
  return { departmentCode: departmentCode ?? '', departmentName: departmentName ?? '', sortOrder: sortOrder ?? 0, parentId: parent?.id ?? null };
}

/** 부서를 지울 수 없는 이유 (참조 중). 없으면 null. */
function departmentInUseReason(tables: Readonly<MockTables>, departmentId: number): string | null {
  const employees = tables.employee.filter((e) => e.departmentId === departmentId).length;
  if (employees > 0) return `소속 사원이 ${employees}명 있어 삭제할 수 없어요. 사원을 다른 부서로 옮긴 뒤 지워 주세요`;
  const children = tables.department.filter((d) => d.parentId === departmentId).length;
  if (children > 0) return `하위 부서가 ${children}개 있어 삭제할 수 없어요`;
  if (tables.notification.some((n) => n.departmentId === departmentId)) return '부서 알림에 쓰인 부서라 삭제할 수 없어요';
  return null;
}

// ── 직급 ─────────────────────────────────────────────────

function readJobGradeFields(tables: Readonly<MockTables>, errors: FieldErrors, input: JobGradeCreateInput, selfId: number | null) {
  const jobGradeCode = requiredText(errors, 'jobGradeCode', input.jobGradeCode.toUpperCase(), '직급 코드', 30);
  if (jobGradeCode !== null && !JOB_GRADE_CODE_PATTERN.test(jobGradeCode)) errors.add('jobGradeCode', JOB_GRADE_CODE_RULE_TEXT);
  else if (jobGradeCode !== null && tables.jobGrade.some((g) => g.id !== selfId && g.jobGradeCode === jobGradeCode)) {
    errors.add('jobGradeCode', '이미 쓰는 직급 코드예요');
  }
  const jobGradeName = requiredText(errors, 'jobGradeName', input.jobGradeName, '직급명', 30);
  const sortOrder = nonNegativeInteger(errors, 'sortOrder', input.sortOrder, '표시 순서');
  errors.throwIfAny();
  return { jobGradeCode: jobGradeCode ?? '', jobGradeName: jobGradeName ?? '', sortOrder: sortOrder ?? 0 };
}

function removeById<T extends { id: number }>(rows: T[], id: number): void {
  const index = rows.findIndex((row) => row.id === id);
  if (index >= 0) rows.splice(index, 1);
}

export const adminOrgApi = {
  /** 조직도: 부서 트리와 부서별 인원(이름, 직급, 부서장 여부). 사용 중인 사원만, 직급 표시 순서대로. */
  getOrgChart: (): Promise<OrgChartDepartmentView[]> => mockQuery(buildOrgChart),
};

export const departmentAdminApi = {
  /** 부서 만들기. 부서장은 소속 사원이 생긴 뒤 수정에서 지정한다. */
  create: (input: DepartmentCreateInput): Promise<SavedRef> =>
    mockMutation((tx) => {
      requireActor(tx.tables, MANAGE);
      const fields = readDepartmentFields(tx.tables, new FieldErrors(), input, null);
      const row = insertRow(tx, 'department', { ...fields, headEmployeeId: null });
      return { id: row.id, name: row.departmentName };
    }),

  /** 부서 수정: 부서 코드·부서명·상위 부서·부서장·정렬 순서 */
  update: (input: DepartmentUpdateInput): Promise<SavedRef> =>
    mockMutation((tx) => {
      requireActor(tx.tables, MANAGE);
      const department = requireRow(tx.tables, 'department', input.id, '부서');
      assertUnchanged(department.updatedAt, input.expectedUpdatedAt, '부서');
      const errors = new FieldErrors();
      if (input.headEmployeeId !== null) {
        const head = tx.tables.employee.find((e) => e.id === input.headEmployeeId);
        if (head && (!head.isActive || head.departmentId !== department.id)) errors.add('headEmployeeId', '부서장은 이 부서의 사용 중인 사원 중에서 골라 주세요');
      }
      const fields = readDepartmentFields(tx.tables, errors, input, department.id);
      const head = input.headEmployeeId === null ? null : requireRow(tx.tables, 'employee', input.headEmployeeId, '부서장');
      const row = updateRow(tx, 'department', department.id, { ...fields, headEmployeeId: head?.id ?? null });
      return { id: department.id, name: row?.departmentName ?? fields.departmentName };
    }),

  /** 부서 삭제: 소속 사원·하위 부서·구매요청·부서 알림이 없을 때만 */
  remove: (input: DeleteInput): Promise<SavedRef> =>
    mockMutation((tx) => {
      requireActor(tx.tables, MANAGE);
      const department = requireRow(tx.tables, 'department', input.id, '부서');
      assertUnchanged(department.updatedAt, input.expectedUpdatedAt, '부서');
      const reason = departmentInUseReason(tx.tables, department.id);
      if (reason) throw new InputError(reason);
      removeById(tx.tables.department, department.id);
      return { id: department.id, name: department.departmentName };
    }),
};

export const jobGradeAdminApi = {
  create: (input: JobGradeCreateInput): Promise<SavedRef> =>
    mockMutation((tx) => {
      requireActor(tx.tables, MANAGE);
      const fields = readJobGradeFields(tx.tables, new FieldErrors(), input, null);
      const row = insertRow(tx, 'jobGrade', fields);
      return { id: row.id, name: row.jobGradeName };
    }),

  update: (input: JobGradeUpdateInput): Promise<SavedRef> =>
    mockMutation((tx) => {
      requireActor(tx.tables, MANAGE);
      const jobGrade = requireRow(tx.tables, 'jobGrade', input.id, '직급');
      assertUnchanged(jobGrade.updatedAt, input.expectedUpdatedAt, '직급');
      const fields = readJobGradeFields(tx.tables, new FieldErrors(), input, jobGrade.id);
      const row = updateRow(tx, 'jobGrade', jobGrade.id, fields);
      return { id: jobGrade.id, name: row?.jobGradeName ?? fields.jobGradeName };
    }),

  /** 직급 삭제: 이 직급의 사원이 없을 때만 */
  remove: (input: DeleteInput): Promise<SavedRef> =>
    mockMutation((tx) => {
      requireActor(tx.tables, MANAGE);
      const jobGrade = requireRow(tx.tables, 'jobGrade', input.id, '직급');
      assertUnchanged(jobGrade.updatedAt, input.expectedUpdatedAt, '직급');
      const employees = tx.tables.employee.filter((e) => e.jobGradeId === jobGrade.id).length;
      if (employees > 0) throw new InputError(`이 직급의 사원이 ${employees}명 있어 삭제할 수 없어요. 사원의 직급을 먼저 바꿔 주세요`);
      removeById(tx.tables.jobGrade, jobGrade.id);
      return { id: jobGrade.id, name: jobGrade.jobGradeName };
    }),
};

export const roleAdminApi = {
  /**
   * 역할의 권한을 통째로 바꾼다 (REQ-AUTH-003). 보내지 않은 권한은 행을 지운다(= 없음).
   * 저장하면 그 역할 사원의 메뉴·버튼이 바로 바뀐다 (이 탭은 조회 무효화, 다른 탭은 BroadcastChannel).
   */
  replacePermissions: (input: RolePermissionsInput): Promise<SavedRef> =>
    mockMutation((tx) => {
      requireActor(tx.tables, MANAGE);
      const role = requireRow(tx.tables, 'role', input.roleId, '역할');
      assertUnchanged(role.updatedAt, input.expectedUpdatedAt, `${role.roleName} 역할 권한`);
      const next = new Map<Permission, PermissionLevel>();
      for (const row of input.permissions) {
        const validPermission = (PERMISSIONS as readonly string[]).includes(row.permission);
        const validLevel = row.permissionLevel === PERMISSION_LEVEL.USE || row.permissionLevel === PERMISSION_LEVEL.VIEW;
        if (!validPermission || !validLevel || next.has(row.permission)) throw new InputError('권한 값이 올바르지 않아요');
        next.set(row.permission, row.permissionLevel);
      }
      const current = tx.tables.rolePermission.filter((p) => p.roleId === role.id);
      for (const row of current) {
        const level = next.get(row.permission);
        if (level === undefined) removeById(tx.tables.rolePermission, row.id);
        else if (level !== row.permissionLevel) updateRow(tx, 'rolePermission', row.id, { permissionLevel: level });
      }
      for (const [permission, permissionLevel] of next) {
        if (!current.some((row) => row.permission === permission)) insertRow(tx, 'rolePermission', { roleId: role.id, permission, permissionLevel });
      }
      updateRow(tx, 'role', role.id, {});
      return { id: role.id, name: role.roleName };
    }),
};
