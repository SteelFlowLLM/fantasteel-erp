// 역할·권한 공통 코드. 값·표시명은 공통 코드 정의서 그대로 (PLAN 4장).
// 부서장은 역할이 아니다 (department.head_employee_id로 판단, REQ-AUTH-004).

export const ROLE = {
  SALES: 'SALES',
  PURCHASE: 'PURCHASE',
  PRODUCTION: 'PRODUCTION',
  QUALITY: 'QUALITY',
  LOGISTICS: 'LOGISTICS',
  ADMIN: 'ADMIN',
} as const;
export type RoleCode = (typeof ROLE)[keyof typeof ROLE];
export const ROLE_LABEL: Record<RoleCode, string> = {
  SALES: '영업',
  PURCHASE: '구매',
  PRODUCTION: '생산',
  QUALITY: '품질',
  LOGISTICS: '물류',
  ADMIN: '관리자',
};

/** 권한이 없으면 role_permission 행을 두지 않는다 */
export const PERMISSION_LEVEL = {
  USE: 'USE',
  VIEW: 'VIEW',
} as const;
export type PermissionLevel = (typeof PERMISSION_LEVEL)[keyof typeof PERMISSION_LEVEL];
export const PERMISSION_LEVEL_LABEL: Record<PermissionLevel, string> = {
  USE: '사용',
  VIEW: '조회',
};

export const PERMISSION = {
  SALES_ORDER_CREATE: 'SALES_ORDER_CREATE',
  SALES_ORDER_CANCEL: 'SALES_ORDER_CANCEL',
  SHIPMENT_REQUEST_MANAGE: 'SHIPMENT_REQUEST_MANAGE',
  PURCHASE_REQUISITION_CREATE: 'PURCHASE_REQUISITION_CREATE',
  PURCHASE_ORDER_CONFIRM: 'PURCHASE_ORDER_CONFIRM',
  GOODS_RECEIPT_CONFIRM: 'GOODS_RECEIPT_CONFIRM',
  PRODUCTION_PLAN_CONFIRM: 'PRODUCTION_PLAN_CONFIRM',
  PRODUCTION_RESULT_CONFIRM: 'PRODUCTION_RESULT_CONFIRM',
  HOT_ROLLING_ALLOCATE: 'HOT_ROLLING_ALLOCATE',
  INSPECTION_REGISTER: 'INSPECTION_REGISTER',
  INSPECTION_STANDARD_MANAGE: 'INSPECTION_STANDARD_MANAGE',
  DISPOSITION_SET: 'DISPOSITION_SET',
  GOODS_ISSUE_CONFIRM: 'GOODS_ISSUE_CONFIRM',
  MILL_SHEET_READ: 'MILL_SHEET_READ',
  EMPLOYEE_MANAGE: 'EMPLOYEE_MANAGE',
  ORG_MANAGE: 'ORG_MANAGE',
  MASTER_MANAGE: 'MASTER_MANAGE',
} as const;
export type Permission = (typeof PERMISSION)[keyof typeof PERMISSION];

export const PERMISSION_LABEL: Record<Permission, string> = {
  SALES_ORDER_CREATE: '수주 등록',
  SALES_ORDER_CANCEL: '수주 취소',
  SHIPMENT_REQUEST_MANAGE: '출하요청·배정 확정',
  PURCHASE_REQUISITION_CREATE: '구매요청 등록·MRP',
  PURCHASE_ORDER_CONFIRM: '발주',
  GOODS_RECEIPT_CONFIRM: '입고 확정',
  PRODUCTION_PLAN_CONFIRM: '생산계획·히트 편성',
  // 공통 코드 정의서 표시명은 '공정 실적(실적 시뮬레이션 포함)'이지만 '공정 실적'은 용어 사전 금지어다 (TRM-047).
  // 용어 사전을 우선해 화면에는 '작업 실적'으로 쓴다 (PLAN 6장 1번).
  PRODUCTION_RESULT_CONFIRM: '작업 실적(실적 시뮬레이션 포함)',
  HOT_ROLLING_ALLOCATE: '열연 투입 배정',
  INSPECTION_REGISTER: '검사 입력',
  INSPECTION_STANDARD_MANAGE: '검사 기준 관리',
  DISPOSITION_SET: '불합격 처리 상태 지정',
  GOODS_ISSUE_CONFIRM: '출고 확정',
  MILL_SHEET_READ: '밀시트 조회·출력',
  EMPLOYEE_MANAGE: '사원 관리',
  ORG_MANAGE: '부서·권한 관리',
  MASTER_MANAGE: '기준정보 관리',
};

/** 권한 표의 '영역' 열 (공통 코드 정의서 PERMISSION) */
export const PERMISSION_AREAS = ['영업', '구매', '생산', '품질', '물류', '관리'] as const;
export type PermissionArea = (typeof PERMISSION_AREAS)[number];
export const PERMISSION_AREA: Record<Permission, PermissionArea> = {
  SALES_ORDER_CREATE: '영업',
  SALES_ORDER_CANCEL: '영업',
  SHIPMENT_REQUEST_MANAGE: '영업',
  PURCHASE_REQUISITION_CREATE: '구매',
  PURCHASE_ORDER_CONFIRM: '구매',
  GOODS_RECEIPT_CONFIRM: '구매',
  PRODUCTION_PLAN_CONFIRM: '생산',
  PRODUCTION_RESULT_CONFIRM: '생산',
  HOT_ROLLING_ALLOCATE: '생산',
  INSPECTION_REGISTER: '품질',
  INSPECTION_STANDARD_MANAGE: '품질',
  DISPOSITION_SET: '품질',
  GOODS_ISSUE_CONFIRM: '물류',
  MILL_SHEET_READ: '물류',
  EMPLOYEE_MANAGE: '관리',
  ORG_MANAGE: '관리',
  MASTER_MANAGE: '관리',
};

/** 공통 코드 정의서 표 순서 (권한 행렬의 행 순서) */
export const PERMISSIONS: readonly Permission[] = Object.values(PERMISSION);
