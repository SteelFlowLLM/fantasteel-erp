// 사원 등록·수정·사용 여부 (REQ-AUTH-002, BP-AUTH-01). 조회는 directory.ts(directoryApi.listEmployees)를 쓴다.
// 두 데이터 모드 모두 실제 서버를 부른다 (api/server/organization.ts). 사원 관리(EMPLOYEE_MANAGE) 권한과 부서장 확인은 서버가 한다.
// - 사원번호는 로그인 ID라 등록한 뒤에는 바꾸지 않는다. 등록 때 비밀번호를 받는다.
// - 사용 여부(is_active)는 수정과 따로 '사용 안 함으로 바꾸기'·'다시 사용' 동작으로 바꾼다 (컨벤션 5장 상태 변경은 동작으로).
import { serverOrganizationApi } from '@/api/server/organization';

export interface EmployeeCreateInput {
  employeeNo: string;
  employeeName: string;
  departmentId: number | null;
  jobGradeId: number | null;
  roleId: number | null;
  /** 등록 때 필수 (API-156 bcrypt 저장). 없으면 서버 어댑터가 입력칸 오류로 막는다 */
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

export const employeeAdminApi = {
  /** 사원 등록: 사용 중(is_active = true)으로 만든다. */
  create: (input: EmployeeCreateInput): Promise<EmployeeSaved> => serverOrganizationApi.createEmployee(input),

  /** 사원 정보 수정: 이름·부서·직급·역할. 사원번호는 바꾸지 않는다. */
  update: (input: EmployeeUpdateInput): Promise<EmployeeSaved> => serverOrganizationApi.updateEmployee(input),

  /** 사용 안 함으로 바꾸기 (퇴사 처리, 컨벤션 7-2). 조직도·담당자 목록에서 빠지고 업무를 할 수 없다. */
  deactivate: (input: EmployeeActiveInput): Promise<EmployeeSaved> => serverOrganizationApi.setEmployeeActive(input.id, false),

  /** 다시 사용 */
  activate: (input: EmployeeActiveInput): Promise<EmployeeSaved> => serverOrganizationApi.setEmployeeActive(input.id, true),
};
