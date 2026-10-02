// API 공통 응답 포맷 (코드 컨벤션 5장). 모듈별 응답 타입은 이 파일 옆에 모듈 이름으로 추가한다 (컨벤션 6장 [권장]).
import type { Permission, PermissionLevel, Role } from './codes';

export interface ApiSuccess<T> {
  success: true;
  data: T;
}
export interface ApiFailure {
  success: false;
  error: { code: string; message: string };
}
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** 목록 응답 (페이징 page·size·sort, 컨벤션 5장) */
export interface PageResult<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
}

/** 로그인한 사원. 서버가 쿠키의 토큰으로 매 요청마다 다시 읽는다 (클라이언트가 보낸 역할값은 쓰지 않음) */
export interface AuthUser {
  employeeId: number;
  employeeNo: string;
  employeeName: string;
  roleCode: Role;
  departmentId: number;
  jobGradeId: number;
  /** 이 사원이 부서장인 부서 id (구매요청 승인권자 판단, REQ-AUTH-004) */
  headDepartmentIds: number[];
  permissions: Partial<Record<Permission, PermissionLevel>>;
}
