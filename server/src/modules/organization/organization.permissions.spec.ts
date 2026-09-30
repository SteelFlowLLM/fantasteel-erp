import 'reflect-metadata';
import { PERMISSION } from '@fantasteel/shared';
import { REQUIRED_PERMISSION, type RequiredPermission } from '../../common/auth/auth.decorators';
import { DepartmentController } from './department.controller';
import { EmployeeController } from './employee.controller';
import { RoleController } from './role.controller';

// @nestjs/common 12는 ESM 전용이라 플래그 없는 jest에서는 대체품을 쓴다 (testing/nest-common.shim.ts 참고)
jest.mock('@nestjs/common', () => require('./testing/nest-common.shim'));
// 컨트롤러가 주입받는 서비스는 실시간·JWT(ESM 패키지)까지 끌고 오므로 빈 클래스로 바꾼다. 여기서는 메타데이터만 본다.
jest.mock('./employee.service', () => ({ EmployeeService: class {} }));
jest.mock('./department.service', () => ({ DepartmentService: class {} }));
jest.mock('./role.service', () => ({ RoleService: class {} }));

// 컨트롤러마다 붙은 권한 데코레이터가 설계대로인지 고정한다. 데코레이터가 빠지면 누구나 부를 수 있게 된다.
const need = (target: object, method: string): RequiredPermission | undefined =>
  Reflect.getMetadata(REQUIRED_PERMISSION, (target as Record<string, object>)[method]) as RequiredPermission | undefined;

describe('organization 컨트롤러 권한', () => {
  const emp = EmployeeController.prototype;
  const dept = DepartmentController.prototype;
  const role = RoleController.prototype;

  it('사원 변경 API는 EMPLOYEE_MANAGE USE가 필요하다', () => {
    for (const m of ['create', 'update', 'unlock', 'resetPassword']) {
      expect(need(emp, m)).toEqual({ anyOf: [PERMISSION.EMPLOYEE_MANAGE], level: 'USE' });
    }
  });

  it('사원 목록·상세는 EMPLOYEE_MANAGE VIEW 이상이 필요하다', () => {
    for (const m of ['list', 'get']) expect(need(emp, m)).toEqual({ anyOf: [PERMISSION.EMPLOYEE_MANAGE], level: 'VIEW' });
  });

  it('사원 디렉터리는 로그인한 누구나 쓴다 (권한 데코레이터 없음)', () => {
    expect(need(emp, 'directory')).toBeUndefined();
  });

  it('부서 변경 API는 ORG_MANAGE USE가 필요하고, 목록·조직도는 누구나 본다', () => {
    for (const m of ['create', 'update']) expect(need(dept, m)).toEqual({ anyOf: [PERMISSION.ORG_MANAGE], level: 'USE' });
    for (const m of ['list', 'tree']) expect(need(dept, m)).toBeUndefined();
  });

  it('권한 행렬 변경은 ORG_MANAGE USE, 조회는 ORG_MANAGE 또는 EMPLOYEE_MANAGE VIEW', () => {
    expect(need(role, 'replacePermissions')).toEqual({ anyOf: [PERMISSION.ORG_MANAGE], level: 'USE' });
    for (const m of ['list', 'get']) expect(need(role, m)).toEqual({ anyOf: [PERMISSION.ORG_MANAGE, PERMISSION.EMPLOYEE_MANAGE], level: 'VIEW' });
  });
});
