// API 공통 응답 포맷 (코드 컨벤션 5장).
export interface ApiSuccess<T> { success: true; data: T }
export interface ApiFailure { success: false; error: { code: string; message: string } }
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** 로그인한 사원 (JWT에서 복원). */
export interface AuthUser {
  employeeId: number;
  employeeNo: string;
  employeeName: string;
  roleCode: string;
  departmentId: number;
  departmentName: string;
  jobGrade: string;
  /** 부서장으로 지정된 부서 id 목록 (승인권자 판단) */
  headDepartmentIds: number[];
  /** 권한 코드 → 수준 */
  permissions: Record<string, 'USE' | 'VIEW'>;
}
