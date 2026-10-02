import type { AuthUser } from '@fantasteel/shared';
import { readCookie } from './auth-token.service';
import { hasPermission } from './auth.guard';
import { assertDepartmentHead } from './department-head';

const user = (overrides: Partial<AuthUser> = {}): AuthUser => ({
  employeeId: 1,
  employeeNo: '2103003',
  employeeName: '박서영',
  roleCode: 'SALES',
  departmentId: 1,
  jobGradeId: 4,
  headDepartmentIds: [],
  permissions: { SALES_ORDER_CREATE: 'USE', PRODUCTION_PLAN_CONFIRM: 'VIEW' },
  ...overrides,
});

describe('권한 확인 (REQ-AUTH-003)', () => {
  it('USE가 필요하면 USE만 통과', () => {
    expect(hasPermission(user(), { permission: 'SALES_ORDER_CREATE', level: 'USE' })).toBe(true);
    expect(hasPermission(user(), { permission: 'PRODUCTION_PLAN_CONFIRM', level: 'USE' })).toBe(false);
  });
  it('VIEW가 필요하면 VIEW·USE 모두 통과, 권한 행이 없으면 거부', () => {
    expect(hasPermission(user(), { permission: 'PRODUCTION_PLAN_CONFIRM', level: 'VIEW' })).toBe(true);
    expect(hasPermission(user(), { permission: 'SALES_ORDER_CREATE', level: 'VIEW' })).toBe(true);
    expect(hasPermission(user(), { permission: 'MILL_SHEET_READ', level: 'VIEW' })).toBe(false);
  });
});

describe('부서장 확인 (REQ-AUTH-004)', () => {
  it('요청자 소속 부서의 부서장이 아니면 COM-002', () => {
    expect(() => assertDepartmentHead(user({ headDepartmentIds: [2] }), 1)).toThrow();
    expect(() => assertDepartmentHead(user({ headDepartmentIds: [1] }), 1)).not.toThrow();
  });
});

describe('쿠키 읽기', () => {
  it('이름이 같은 값만 꺼낸다', () => {
    expect(readCookie('a=1; access_token=abc.def; b=2', 'access_token')).toBe('abc.def');
    expect(readCookie('xaccess_token=1', 'access_token')).toBeUndefined();
    expect(readCookie(undefined, 'access_token')).toBeUndefined();
  });
});
