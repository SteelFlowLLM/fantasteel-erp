// 화면 그리기 테스트의 로그인 사원: 서버 시드 테스트 계정(docs/backend/seed.md)과 역할별 권한(역할별 메뉴 v2 3장 표, server/prisma/seed.ts).
// 화면에 넣을 SessionUser를 만든다. 사원·부서 id는 테스트 안에서만 쓰는 번호다.
import type { SessionUser } from '@/api/session';
import { PERMISSION, ROLE_LABEL, type Permission, type PermissionLevel, type RoleCode } from '@/codes';
import type { PermissionMap } from '@/lib/permissions';

/** 열 순서: 영업 · 구매 · 생산 · 품질 · 물류 · 관리자. ● = USE, ○ = VIEW, _ = 없음 */
const ROLE_ORDER: readonly RoleCode[] = ['SALES', 'PURCHASE', 'PRODUCTION', 'QUALITY', 'LOGISTICS', 'ADMIN'];
const ROLE_PERMISSION_TABLE: readonly [Permission, string][] = [
  [PERMISSION.SALES_ORDER_CREATE, '● ○ ○ ○ ○ ○'],
  [PERMISSION.SALES_ORDER_CANCEL, '● ○ ○ ○ ○ ○'],
  [PERMISSION.SHIPMENT_REQUEST_MANAGE, '● ○ ○ ○ ○ ○'],
  [PERMISSION.PURCHASE_REQUISITION_CREATE, '○ ● ○ ○ ○ ○'],
  [PERMISSION.PURCHASE_ORDER_CONFIRM, '○ ● ○ ○ ○ ○'],
  [PERMISSION.GOODS_RECEIPT_CONFIRM, '○ ● ○ ○ ○ ○'],
  [PERMISSION.PRODUCTION_PLAN_CONFIRM, '○ ○ ● ○ ○ ○'],
  [PERMISSION.PRODUCTION_RESULT_CONFIRM, '○ ○ ● ○ ○ ○'],
  [PERMISSION.HOT_ROLLING_ALLOCATE, '○ ○ ● ○ ○ ○'],
  [PERMISSION.INSPECTION_REGISTER, '○ ○ ○ ● ○ ○'],
  [PERMISSION.INSPECTION_STANDARD_MANAGE, '○ ○ ○ ● ○ ○'],
  [PERMISSION.DISPOSITION_SET, '○ ○ ○ ● ○ ○'],
  [PERMISSION.GOODS_ISSUE_CONFIRM, '○ ○ ○ ○ ● ○'],
  [PERMISSION.MILL_SHEET_READ, '○ ○ ○ ○ ● ○'],
  [PERMISSION.EMPLOYEE_MANAGE, '_ _ _ _ _ ●'],
  [PERMISSION.ORG_MANAGE, '_ _ _ _ _ ●'],
  [PERMISSION.MASTER_MANAGE, '○ ○ ○ ○ ○ ●'],
];

/** 역할의 권한 표 (서버 /auth/me의 permissions와 같은 모양) */
export function rolePermissionsOf(roleCode: RoleCode): PermissionMap {
  const column = ROLE_ORDER.indexOf(roleCode);
  const map: PermissionMap = {};
  for (const [permission, marks] of ROLE_PERMISSION_TABLE) {
    const mark = marks.split(' ')[column];
    const level: PermissionLevel | null = mark === '●' ? 'USE' : mark === '○' ? 'VIEW' : null;
    if (level) map[permission] = level;
  }
  return map;
}

const DEPARTMENTS = ['영업부', '구매부', '생산부', '제선파트', '제강파트', '연주파트', '열연파트', '품질부', '물류부', '경영지원부'] as const;
type DepartmentName = (typeof DEPARTMENTS)[number];
const departmentIdOf = (name: DepartmentName) => DEPARTMENTS.indexOf(name) + 1;

/** 서버 시드 테스트 계정 (docs/backend/seed.md 표) */
export const SEED_ACCOUNTS: readonly { employeeNo: string; employeeName: string; departmentName: DepartmentName; jobGradeName: string; roleCode: RoleCode; isHead: boolean }[] = [
  { employeeNo: '1503001', employeeName: '이현정', departmentName: '경영지원부', jobGradeName: '부장', roleCode: 'ADMIN', isHead: true },
  { employeeNo: '1608002', employeeName: '김도윤', departmentName: '영업부', jobGradeName: '부장', roleCode: 'SALES', isHead: true },
  { employeeNo: '2103003', employeeName: '박서영', departmentName: '영업부', jobGradeName: '대리', roleCode: 'SALES', isHead: false },
  { employeeNo: '1702004', employeeName: '최준혁', departmentName: '구매부', jobGradeName: '부장', roleCode: 'PURCHASE', isHead: true },
  { employeeNo: '2207005', employeeName: '정다은', departmentName: '구매부', jobGradeName: '사원', roleCode: 'PURCHASE', isHead: false },
  { employeeNo: '1401006', employeeName: '강민석', departmentName: '생산부', jobGradeName: '부장', roleCode: 'PRODUCTION', isHead: true },
  { employeeNo: '1709007', employeeName: '윤성호', departmentName: '제선파트', jobGradeName: '차장', roleCode: 'PRODUCTION', isHead: true },
  { employeeNo: '1804008', employeeName: '장혜린', departmentName: '제강파트', jobGradeName: '과장', roleCode: 'PRODUCTION', isHead: true },
  { employeeNo: '1906009', employeeName: '임재원', departmentName: '연주파트', jobGradeName: '과장', roleCode: 'PRODUCTION', isHead: true },
  { employeeNo: '2001010', employeeName: '한승우', departmentName: '열연파트', jobGradeName: '과장', roleCode: 'PRODUCTION', isHead: true },
  { employeeNo: '2402011', employeeName: '조은서', departmentName: '제강파트', jobGradeName: '사원', roleCode: 'PRODUCTION', isHead: false },
  { employeeNo: '1802012', employeeName: '오지훈', departmentName: '품질부', jobGradeName: '부장', roleCode: 'QUALITY', isHead: true },
  { employeeNo: '2205013', employeeName: '서민지', departmentName: '품질부', jobGradeName: '대리', roleCode: 'QUALITY', isHead: false },
  { employeeNo: '1610014', employeeName: '신현우', departmentName: '물류부', jobGradeName: '부장', roleCode: 'LOGISTICS', isHead: true },
  { employeeNo: '2304015', employeeName: '권예진', departmentName: '물류부', jobGradeName: '사원', roleCode: 'LOGISTICS', isHead: false },
];

/** 시드 사원의 로그인 정보 (예: sessionUserOf(SEED_EMPLOYEE_NO.quality)) */
export function sessionUserOf(employeeNo: string): SessionUser {
  const index = SEED_ACCOUNTS.findIndex((e) => e.employeeNo === employeeNo);
  const e = SEED_ACCOUNTS[index];
  if (!e) throw new Error(`시드 사원이 없어요: ${employeeNo}`);
  const departmentId = departmentIdOf(e.departmentName);
  return {
    employeeId: index + 1,
    employeeNo: e.employeeNo,
    employeeName: e.employeeName,
    departmentId,
    departmentName: e.departmentName,
    jobGradeName: e.jobGradeName,
    roleCode: e.roleCode,
    roleName: ROLE_LABEL[e.roleCode],
    headDepartmentIds: e.isHead ? [departmentId] : [],
    headDepartmentNames: e.isHead ? [e.departmentName] : [],
    permissions: rolePermissionsOf(e.roleCode),
  };
}
