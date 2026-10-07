// 사원 등록·수정·사용 여부 (REQ-AUTH-002, BP-AUTH-01). 조회는 directory.ts(directoryApi.listEmployees)를 쓴다.
// - 모든 변경은 사원 관리(EMPLOYEE_MANAGE) 사용 권한을 다시 확인한다 (COM-002).
// - 사원번호는 로그인 ID라 등록한 뒤에는 바꾸지 않는다. 비밀번호·잠김·이메일은 로그인 작업 때 넣는다 (PLAN 5장).
// - 사용 여부(is_active)는 수정과 따로 '사용 안 함으로 바꾸기'·'다시 사용' 동작으로 바꾼다 (컨벤션 5장 상태 변경은 동작으로).
// - 부서장은 그 부서의 사용 중인 사원이어야 하므로, 부서장인 사원은 다른 부서로 옮기거나 사용 안 함으로 바꾸기 전에 부서장을 먼저 바꾼다.
// - 조직 변경에 맞는 BUSINESS_EVENT_TYPE이 없어 작업 로그는 남기지 않는다 (공통 코드 29개, areas/cross-cutting.md 7장).
import { PERMISSION } from '@/codes';
import { requireActor } from '@/api/actor';
import { FieldErrors, InputError, mockMutation } from '@/api/client';
import { isServerDataSource } from '@/api/http';
import { serverOrganizationApi } from '@/api/server/organization';
import { assertUnchanged, requiredText, requireRow } from '@/api/validation';
import { EMPLOYEE_NO_PATTERN, EMPLOYEE_NO_RULE_TEXT } from '@/features/admin/lib/orgRules';
import type { EmployeeRow, MockTables } from '@/mock/schema';
import { insertRow, updateRow, type MockTx } from '@/mock/store';

const MANAGE = { use: [PERMISSION.EMPLOYEE_MANAGE] } as const;

export interface EmployeeCreateInput {
  employeeNo: string;
  employeeName: string;
  departmentId: number | null;
  jobGradeId: number | null;
  roleId: number | null;
  /** 서버 모드에서만 보낸다 (API-156 bcrypt 저장). 가짜 DB는 비밀번호를 두지 않는다 */
  password?: string;
}

export interface EmployeeUpdateInput {
  id: number;
  employeeName: string;
  departmentId: number | null;
  jobGradeId: number | null;
  roleId: number | null;
  /** 수정 화면을 연 시점의 updatedAt (COM-001) */
  expectedUpdatedAt?: string | null;
}

export interface EmployeeActiveInput {
  id: number;
  expectedUpdatedAt?: string | null;
}

export interface EmployeeSaved {
  id: number;
  employeeNo: string;
  employeeName: string;
  isActive: boolean;
}

const savedOf = (row: EmployeeRow): EmployeeSaved => ({ id: row.id, employeeNo: row.employeeNo, employeeName: row.employeeName, isActive: row.isActive });

/** 이름·부서·직급·역할 (등록·수정 공통). 입력칸 오류를 먼저 모으고, 그다음 참조 대상이 있는지(COM-003) 본다. */
function readOrgFields(tables: Readonly<MockTables>, errors: FieldErrors, input: Omit<EmployeeCreateInput, 'employeeNo'>) {
  const employeeName = requiredText(errors, 'employeeName', input.employeeName, '이름', 50);
  if (input.departmentId === null) errors.add('departmentId', '부서를 골라 주세요');
  if (input.jobGradeId === null) errors.add('jobGradeId', '직급을 골라 주세요');
  if (input.roleId === null) errors.add('roleId', '역할을 골라 주세요');
  errors.throwIfAny();
  return {
    employeeName: employeeName ?? '',
    department: requireRow(tables, 'department', input.departmentId, '부서'),
    jobGrade: requireRow(tables, 'jobGrade', input.jobGradeId, '직급'),
    role: requireRow(tables, 'role', input.roleId, '역할'),
  };
}

function headDepartmentsOf(tables: Readonly<MockTables>, employeeId: number) {
  return tables.department.filter((d) => d.headEmployeeId === employeeId);
}

function setActive(tx: MockTx, input: EmployeeActiveInput, isActive: boolean): EmployeeSaved {
  requireActor(tx.tables, MANAGE);
  const employee = requireRow(tx.tables, 'employee', input.id, '사원');
  assertUnchanged(employee.updatedAt, input.expectedUpdatedAt, '사원 정보');
  if (employee.isActive === isActive) return savedOf(employee);
  if (!isActive) {
    const heads = headDepartmentsOf(tx.tables, employee.id);
    if (heads.length > 0) {
      throw new InputError(
        `${heads.map((d) => d.departmentName).join('·')} 부서장이라 사용 안 함으로 바꿀 수 없어요. 부서·직급·권한 화면에서 부서장을 먼저 바꿔 주세요`,
      );
    }
  }
  const row = updateRow(tx, 'employee', employee.id, { isActive });
  return savedOf(row ?? employee);
}

export const employeeAdminApi = {
  /** 사원 등록: 사용 중(is_active = true)으로 만든다. 비밀번호는 로그인 작업 때 정한다. */
  create: (input: EmployeeCreateInput): Promise<EmployeeSaved> =>
    isServerDataSource() ? serverOrganizationApi.createEmployee(input) : mockMutation((tx) => {
      requireActor(tx.tables, MANAGE);
      const errors = new FieldErrors();
      const employeeNo = requiredText(errors, 'employeeNo', input.employeeNo, '사원번호', 20);
      if (employeeNo !== null && !EMPLOYEE_NO_PATTERN.test(employeeNo)) errors.add('employeeNo', EMPLOYEE_NO_RULE_TEXT);
      else if (employeeNo !== null && tx.tables.employee.some((e) => e.employeeNo === employeeNo)) errors.add('employeeNo', '이미 등록된 사원번호예요');
      const fields = readOrgFields(tx.tables, errors, input);
      const row = insertRow(tx, 'employee', {
        employeeNo: employeeNo ?? '',
        employeeName: fields.employeeName,
        passwordHash: '',
        departmentId: fields.department.id,
        jobGradeId: fields.jobGrade.id,
        roleId: fields.role.id,
        isActive: true,
        lastLoginAt: null,
      });
      return savedOf(row);
    }),

  /** 사원 정보 수정: 이름·부서·직급·역할. 사원번호는 바꾸지 않는다. */
  update: (input: EmployeeUpdateInput): Promise<EmployeeSaved> =>
    isServerDataSource() ? serverOrganizationApi.updateEmployee(input) : mockMutation((tx) => {
      requireActor(tx.tables, MANAGE);
      const employee = requireRow(tx.tables, 'employee', input.id, '사원');
      assertUnchanged(employee.updatedAt, input.expectedUpdatedAt, '사원 정보');
      const errors = new FieldErrors();
      const fields = readOrgFields(tx.tables, errors, input);
      if (fields.department.id !== employee.departmentId) {
        const heads = headDepartmentsOf(tx.tables, employee.id).filter((d) => d.id !== fields.department.id);
        if (heads.length > 0) {
          errors.add('departmentId', `${heads.map((d) => d.departmentName).join('·')} 부서장이라 다른 부서로 옮길 수 없어요. 부서장을 먼저 바꿔 주세요`);
          errors.throwIfAny();
        }
      }
      const row = updateRow(tx, 'employee', employee.id, {
        employeeName: fields.employeeName,
        departmentId: fields.department.id,
        jobGradeId: fields.jobGrade.id,
        roleId: fields.role.id,
      });
      return savedOf(row ?? employee);
    }),

  /** 사용 안 함으로 바꾸기 (퇴사 처리, 컨벤션 7-2). 계정 선택·조직도·담당자 목록에서 빠지고 업무를 할 수 없다. */
  deactivate: (input: EmployeeActiveInput): Promise<EmployeeSaved> =>
    isServerDataSource() ? serverOrganizationApi.setEmployeeActive(input.id, false) : mockMutation((tx) => setActive(tx, input, false)),

  /** 다시 사용 */
  activate: (input: EmployeeActiveInput): Promise<EmployeeSaved> =>
    isServerDataSource() ? serverOrganizationApi.setEmployeeActive(input.id, true) : mockMutation((tx) => setActive(tx, input, true)),
};
