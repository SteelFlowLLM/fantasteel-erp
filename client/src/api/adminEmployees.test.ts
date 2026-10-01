import { describe, expect, it } from 'vitest';
import { employeeAdminApi, type EmployeeCreateInput } from '@/api/adminEmployees';
import { ApiError, InputError } from '@/api/client';
import { directoryApi } from '@/api/directory';
import { getMockDb } from '@/mock/db';
import type { MockTables } from '@/mock/schema';
import { actAs, departmentIdOf, employeeIdOf, SEED_EMPLOYEE_NO } from '@/test/actors';

const read = <T,>(reader: (tables: Readonly<MockTables>) => T): T => getMockDb().read(reader);

const gradeIdOf = (code: string) => read((t) => t.jobGrade.find((g) => g.jobGradeCode === code)?.id ?? -1);
const roleIdOf = (code: string) => read((t) => t.role.find((r) => r.roleCode === code)?.id ?? -1);
const employeeRow = (id: number) => read((t) => t.employee.find((e) => e.id === id));

function newEmployee(overrides: Partial<EmployeeCreateInput> = {}): EmployeeCreateInput {
  return {
    employeeNo: '2610016',
    employeeName: '문하늘',
    departmentId: departmentIdOf('SAL'),
    jobGradeId: gradeIdOf('STAFF'),
    roleId: roleIdOf('SALES'),
    ...overrides,
  };
}

async function inputErrorOf(promise: Promise<unknown>): Promise<InputError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof InputError) return error;
    throw error;
  }
  throw new Error('입력 오류가 나지 않았어요');
}

describe('사원 등록 (REQ-AUTH-002)', () => {
  it('관리자가 사원을 등록하면 사용 중으로 만들어지고 목록에 보인다', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const saved = await employeeAdminApi.create(newEmployee());
    expect(saved).toMatchObject({ employeeNo: '2610016', employeeName: '문하늘', isActive: true });
    const list = await directoryApi.listEmployees({ keyword: '문하늘' });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ departmentName: '영업부', jobGradeName: '사원', roleCode: 'SALES', lastLoginAt: null, headDepartmentIds: [] });
  });

  it('사원 관리 사용 권한이 없으면 COM-002, 아무것도 저장하지 않는다', async () => {
    actAs(SEED_EMPLOYEE_NO.salesHead);
    const before = read((t) => t.employee.length);
    await expect(employeeAdminApi.create(newEmployee())).rejects.toMatchObject({ code: 'COM-002', detail: '사원 관리 사용 권한이 필요해요' });
    expect(read((t) => t.employee.length)).toBe(before);
  });

  it('필수값·사원번호 형식·중복은 입력칸 오류', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const empty = await inputErrorOf(employeeAdminApi.create({ employeeNo: '', employeeName: ' ', departmentId: null, jobGradeId: null, roleId: null }));
    expect(empty.fieldErrors).toEqual({
      employeeNo: '사원번호를 입력해 주세요',
      employeeName: '이름을 입력해 주세요',
      departmentId: '부서를 골라 주세요',
      jobGradeId: '직급을 골라 주세요',
      roleId: '역할을 골라 주세요',
    });
    expect((await inputErrorOf(employeeAdminApi.create(newEmployee({ employeeNo: '12345' })))).fieldErrors.employeeNo).toBe('사원번호는 숫자 7자리로 입력해 주세요');
    expect((await inputErrorOf(employeeAdminApi.create(newEmployee({ employeeNo: SEED_EMPLOYEE_NO.sales })))).fieldErrors.employeeNo).toBe('이미 등록된 사원번호예요');
    expect((await inputErrorOf(employeeAdminApi.create(newEmployee({ employeeName: '가'.repeat(51) })))).fieldErrors.employeeName).toBe('이름은 50자까지 입력할 수 있어요');
  });

  it('없는 부서·직급·역할이면 COM-003', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    await expect(employeeAdminApi.create(newEmployee({ departmentId: 999 }))).rejects.toMatchObject({ code: 'COM-003', detail: '부서' });
    await expect(employeeAdminApi.create(newEmployee({ jobGradeId: 999 }))).rejects.toMatchObject({ code: 'COM-003', detail: '직급' });
    await expect(employeeAdminApi.create(newEmployee({ roleId: 999 }))).rejects.toMatchObject({ code: 'COM-003', detail: '역할' });
  });
});

describe('사원 수정', () => {
  it('이름·부서·직급·역할을 바꾸고 사원번호는 그대로 둔다', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const id = employeeIdOf(SEED_EMPLOYEE_NO.sales);
    const before = employeeRow(id);
    await employeeAdminApi.update({
      id,
      employeeName: '박서영',
      departmentId: departmentIdOf('PUR'),
      jobGradeId: gradeIdOf('MANAGER'),
      roleId: roleIdOf('PURCHASE'),
      expectedUpdatedAt: before?.updatedAt,
    });
    expect(employeeRow(id)).toMatchObject({ employeeNo: SEED_EMPLOYEE_NO.sales, departmentId: departmentIdOf('PUR'), jobGradeId: gradeIdOf('MANAGER'), roleId: roleIdOf('PURCHASE') });
  });

  it('화면을 연 뒤 다른 곳에서 바뀌었으면 COM-001', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const id = employeeIdOf(SEED_EMPLOYEE_NO.sales);
    const input = { id, employeeName: '박서영', departmentId: departmentIdOf('SAL'), jobGradeId: gradeIdOf('STAFF'), roleId: roleIdOf('SALES') };
    await expect(employeeAdminApi.update({ ...input, expectedUpdatedAt: '2000-01-01T00:00:00.000Z' })).rejects.toMatchObject({ code: 'COM-001' });
  });

  it('없는 사원이면 COM-003', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    await expect(
      employeeAdminApi.update({ id: 999, employeeName: '없음', departmentId: departmentIdOf('SAL'), jobGradeId: gradeIdOf('STAFF'), roleId: roleIdOf('SALES') }),
    ).rejects.toMatchObject({ code: 'COM-003', detail: '사원' });
  });

  it('부서장은 다른 부서로 옮길 수 없다 (부서장 = 그 부서 사원)', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const id = employeeIdOf(SEED_EMPLOYEE_NO.salesHead);
    const error = await inputErrorOf(
      employeeAdminApi.update({ id, employeeName: '김도윤', departmentId: departmentIdOf('PUR'), jobGradeId: gradeIdOf('GENERAL_MANAGER'), roleId: roleIdOf('SALES') }),
    );
    expect(error.fieldErrors.departmentId).toContain('영업부 부서장이라');
  });

  it('조회 권한만 있으면 COM-002', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    const id = employeeIdOf(SEED_EMPLOYEE_NO.sales);
    await expect(
      employeeAdminApi.update({ id, employeeName: '박서영', departmentId: departmentIdOf('SAL'), jobGradeId: gradeIdOf('STAFF'), roleId: roleIdOf('SALES') }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe('사용 여부 (is_active, 컨벤션 7-2 퇴사 처리)', () => {
  it('사용 안 함으로 바꾸면 계정 선택에서 빠지고, 다시 사용으로 돌릴 수 있다', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const id = employeeIdOf(SEED_EMPLOYEE_NO.sales);
    await employeeAdminApi.deactivate({ id, expectedUpdatedAt: employeeRow(id)?.updatedAt });
    expect(employeeRow(id)?.isActive).toBe(false);
    expect((await directoryApi.listEmployees({ isActive: false })).map((e) => e.id)).toContain(id);
    await employeeAdminApi.activate({ id });
    expect(employeeRow(id)?.isActive).toBe(true);
  });

  it('사용 안 함 사원은 아무 변경도 할 수 없다 (COM-002)', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const id = employeeIdOf(SEED_EMPLOYEE_NO.sales);
    await employeeAdminApi.deactivate({ id });
    actAs(SEED_EMPLOYEE_NO.sales);
    await expect(employeeAdminApi.activate({ id })).rejects.toMatchObject({ code: 'COM-002', detail: null });
  });

  it('부서장은 사용 안 함으로 바꿀 수 없다', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const error = await inputErrorOf(employeeAdminApi.deactivate({ id: employeeIdOf(SEED_EMPLOYEE_NO.purchaseHead) }));
    expect(error.message).toContain('구매부 부서장이라');
  });

  it('권한이 없으면 COM-002', async () => {
    actAs(SEED_EMPLOYEE_NO.logistics);
    await expect(employeeAdminApi.deactivate({ id: employeeIdOf(SEED_EMPLOYEE_NO.sales) })).rejects.toMatchObject({ code: 'COM-002' });
  });
});
