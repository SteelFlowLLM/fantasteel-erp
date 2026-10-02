import { describe, expect, it } from 'vitest';
import { adminOrgApi, departmentAdminApi, jobGradeAdminApi, roleAdminApi, type DepartmentUpdateInput } from '@/api/adminOrganization';
import { sessionApi } from '@/api/session';
import { InputError } from '@/api/client';
import { directoryApi } from '@/api/directory';
import { getMockDb } from '@/mock/db';
import type { MockTables } from '@/mock/schema';
import { insertRow } from '@/mock/store';
import { actAs, departmentIdOf, employeeIdOf, SEED_EMPLOYEE_NO } from '@/test/actors';

const read = <T,>(reader: (tables: Readonly<MockTables>) => T): T => getMockDb().read(reader);
const departmentRow = (id: number) => read((t) => t.department.find((d) => d.id === id));

async function inputErrorOf(promise: Promise<unknown>): Promise<InputError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof InputError) return error;
    throw error;
  }
  throw new Error('입력 오류가 나지 않았어요');
}

function updateInputOf(code: string, patch: Partial<DepartmentUpdateInput> = {}): DepartmentUpdateInput {
  const row = departmentRow(departmentIdOf(code));
  if (!row) throw new Error(code);
  return {
    id: row.id,
    departmentCode: row.departmentCode,
    departmentName: row.departmentName,
    parentId: row.parentId,
    headEmployeeId: row.headEmployeeId,
    sortOrder: row.sortOrder,
    expectedUpdatedAt: row.updatedAt,
    ...patch,
  };
}

describe('부서 (REQ-AUTH-002, REQ-ORG-001·002)', () => {
  it('하위 부서를 만들고 트리 순서로 보인다', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const saved = await departmentAdminApi.create({ departmentCode: 'prd-coke', departmentName: '코크스파트', parentId: departmentIdOf('PRD'), sortOrder: '5' });
    const list = await directoryApi.listDepartments();
    const created = list.find((d) => d.id === saved.id);
    expect(created).toMatchObject({ departmentCode: 'PRD-COKE', parentName: '생산부', depth: 1, headEmployeeId: null, sortOrder: 5 });
    expect(list.findIndex((d) => d.departmentCode === 'PRD-HR')).toBeLessThan(list.findIndex((d) => d.id === saved.id));
  });

  it('코드 형식·중복, 필수값, 정렬 순서는 입력칸 오류', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const error = await inputErrorOf(departmentAdminApi.create({ departmentCode: 'SAL', departmentName: '', parentId: null, sortOrder: '-1' }));
    expect(error.fieldErrors).toEqual({ departmentCode: '이미 쓰는 부서 코드예요', departmentName: '부서명을 입력해 주세요', sortOrder: '정렬 순서는 0 이상의 정수로 입력해 주세요' });
    expect((await inputErrorOf(departmentAdminApi.create({ departmentCode: '코크스', departmentName: '코크스', parentId: null, sortOrder: 0 }))).fieldErrors.departmentCode).toContain('영문 대문자');
  });

  it('없는 상위 부서는 COM-003, 권한이 없으면 COM-002', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    await expect(departmentAdminApi.create({ departmentCode: 'X1', departmentName: 'X', parentId: 999, sortOrder: 0 })).rejects.toMatchObject({ code: 'COM-003', detail: '상위 부서' });
    actAs(SEED_EMPLOYEE_NO.productionHead);
    await expect(departmentAdminApi.create({ departmentCode: 'X1', departmentName: 'X', parentId: null, sortOrder: 0 })).rejects.toMatchObject({
      code: 'COM-002',
      detail: '부서·권한 관리 사용 권한이 필요해요',
    });
  });

  it('자기 자신이나 하위 부서를 상위 부서로 지정할 수 없다 (순환 금지)', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const self = await inputErrorOf(departmentAdminApi.update(updateInputOf('PRD', { parentId: departmentIdOf('PRD') })));
    expect(self.fieldErrors.parentId).toBe('자기 자신이나 하위 부서는 상위 부서로 지정할 수 없어요');
    const child = await inputErrorOf(departmentAdminApi.update(updateInputOf('PRD', { parentId: departmentIdOf('PRD-STEEL') })));
    expect(child.fieldErrors.parentId).toBe('자기 자신이나 하위 부서는 상위 부서로 지정할 수 없어요');
  });

  it('부서장은 그 부서의 사용 중인 사원 1명이고, 바꾸면 승인권자가 바뀐다 (REQ-ORG-002, AUTH-004)', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const sales = employeeIdOf(SEED_EMPLOYEE_NO.sales);
    await departmentAdminApi.update(updateInputOf('SAL', { headEmployeeId: sales }));
    expect(departmentRow(departmentIdOf('SAL'))?.headEmployeeId).toBe(sales);
    expect((await sessionApi.getSessionUser(sales)).headDepartmentIds).toEqual([departmentIdOf('SAL')]);
    expect((await sessionApi.getSessionUser(employeeIdOf(SEED_EMPLOYEE_NO.salesHead))).headDepartmentIds).toEqual([]);

    const other = await inputErrorOf(departmentAdminApi.update(updateInputOf('SAL', { headEmployeeId: employeeIdOf(SEED_EMPLOYEE_NO.purchase) })));
    expect(other.fieldErrors.headEmployeeId).toBe('부서장은 이 부서의 사용 중인 사원 중에서 골라 주세요');
    await expect(departmentAdminApi.update(updateInputOf('SAL', { headEmployeeId: 999 }))).rejects.toMatchObject({ code: 'COM-003', detail: '부서장' });
  });

  it('다른 곳에서 먼저 바뀌었으면 COM-001', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    await expect(departmentAdminApi.update(updateInputOf('SAL', { expectedUpdatedAt: '2000-01-01T00:00:00.000Z' }))).rejects.toMatchObject({ code: 'COM-001' });
  });

  it('소속 사원·하위 부서·부서 알림이 있으면 지울 수 없고, 비어 있으면 지운다', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    expect((await inputErrorOf(departmentAdminApi.remove({ id: departmentIdOf('SAL') }))).message).toContain('소속 사원이 2명');
    const created = await departmentAdminApi.create({ departmentCode: 'TMP', departmentName: '임시', parentId: null, sortOrder: 9 });
    const child = await departmentAdminApi.create({ departmentCode: 'TMP-1', departmentName: '임시 하위', parentId: created.id, sortOrder: 0 });
    expect((await inputErrorOf(departmentAdminApi.remove({ id: created.id }))).message).toContain('하위 부서가 1개');
    getMockDb().transact((tx) =>
      insertRow(tx, 'notification', {
        recipientId: employeeIdOf(SEED_EMPLOYEE_NO.admin),
        departmentId: child.id,
        businessEventId: null,
        notificationType: 'MENTION',
        title: '부서 알림',
        body: null,
        linkPath: null,
        isRead: false,
        readAt: null,
      }),
    );
    expect((await inputErrorOf(departmentAdminApi.remove({ id: child.id }))).message).toBe('부서 알림에 쓰인 부서라 삭제할 수 없어요');
    getMockDb().transact((tx) => {
      tx.tables.notification.splice(0, tx.tables.notification.length);
    });
    await departmentAdminApi.remove({ id: child.id });
    await departmentAdminApi.remove({ id: created.id });
    expect(departmentRow(created.id)).toBeUndefined();
  });
});

describe('직급 (REQ-AUTH-002, TRM-036)', () => {
  it('등록·수정·삭제하고 표시 순서대로 보인다', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const saved = await jobGradeAdminApi.create({ jobGradeCode: 'senior_manager', jobGradeName: '수석', sortOrder: 15 });
    let list = await directoryApi.listJobGrades();
    expect(list.map((g) => g.jobGradeName)).toEqual(['부장', '수석', '차장', '과장', '대리', '사원']);
    const row = list.find((g) => g.id === saved.id);
    await jobGradeAdminApi.update({ id: saved.id, jobGradeCode: 'SENIOR_MANAGER', jobGradeName: '수석', sortOrder: 60, expectedUpdatedAt: row?.updatedAt });
    list = await directoryApi.listJobGrades();
    expect(list.at(-1)?.jobGradeCode).toBe('SENIOR_MANAGER');
    await jobGradeAdminApi.remove({ id: saved.id });
    expect((await directoryApi.listJobGrades()).some((g) => g.id === saved.id)).toBe(false);
  });

  it('입력 오류·사용 중 삭제 거부·권한 없음', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const error = await inputErrorOf(jobGradeAdminApi.create({ jobGradeCode: 'STAFF', jobGradeName: '', sortOrder: 'a' }));
    expect(error.fieldErrors).toEqual({ jobGradeCode: '이미 쓰는 직급 코드예요', jobGradeName: '직급명을 입력해 주세요', sortOrder: '표시 순서는 0 이상의 정수로 입력해 주세요' });
    const staff = read((t) => t.jobGrade.find((g) => g.jobGradeCode === 'STAFF'));
    expect((await inputErrorOf(jobGradeAdminApi.remove({ id: staff?.id ?? -1 }))).message).toContain('이 직급의 사원이 3명');
    await expect(jobGradeAdminApi.remove({ id: 999 })).rejects.toMatchObject({ code: 'COM-003', detail: '직급' });
    actAs(SEED_EMPLOYEE_NO.sales);
    await expect(jobGradeAdminApi.create({ jobGradeCode: 'X', jobGradeName: 'X', sortOrder: 1 })).rejects.toMatchObject({ code: 'COM-002' });
  });
});

describe('역할 권한 (REQ-AUTH-003)', () => {
  it('권한을 바꾸면 그 역할 사원의 권한이 바로 바뀐다. 없음은 행을 지운다', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const roles = await directoryApi.listRoles();
    const sales = roles.find((r) => r.roleCode === 'SALES');
    if (!sales) throw new Error('영업 역할');
    await roleAdminApi.replacePermissions({
      roleId: sales.id,
      permissions: [
        { permission: 'SALES_ORDER_CREATE', permissionLevel: 'USE' },
        { permission: 'SALES_ORDER_CANCEL', permissionLevel: 'VIEW' },
        { permission: 'MASTER_MANAGE', permissionLevel: 'VIEW' },
      ],
      expectedUpdatedAt: sales.updatedAt,
    });
    const user = await sessionApi.getSessionUser(employeeIdOf(SEED_EMPLOYEE_NO.sales));
    expect(user.permissions).toEqual({ SALES_ORDER_CREATE: 'USE', SALES_ORDER_CANCEL: 'VIEW', MASTER_MANAGE: 'VIEW' });
    expect(read((t) => t.rolePermission.filter((p) => p.roleId === sales.id).length)).toBe(3);

    // 같은 화면에서 다시 저장하면(옛 수정 시각) COM-001
    await expect(roleAdminApi.replacePermissions({ roleId: sales.id, permissions: [], expectedUpdatedAt: sales.updatedAt })).rejects.toMatchObject({ code: 'COM-001' });
  });

  it('잘못된 값은 입력 오류, 없는 역할은 COM-003, 권한이 없으면 COM-002', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const roleId = read((t) => t.role[0]?.id ?? -1);
    await expect(
      roleAdminApi.replacePermissions({
        roleId,
        permissions: [
          { permission: 'MASTER_MANAGE', permissionLevel: 'USE' },
          { permission: 'MASTER_MANAGE', permissionLevel: 'VIEW' },
        ],
      }),
    ).rejects.toBeInstanceOf(InputError);
    await expect(roleAdminApi.replacePermissions({ roleId: 999, permissions: [] })).rejects.toMatchObject({ code: 'COM-003', detail: '역할' });
    actAs(SEED_EMPLOYEE_NO.quality);
    await expect(roleAdminApi.replacePermissions({ roleId, permissions: [] })).rejects.toMatchObject({ code: 'COM-002' });
  });
});

describe('조직도 (REQ-ORG-003)', () => {
  it('부서 트리와 사용 중인 인원을 직급 표시 순서대로 보인다', async () => {
    const chart = await adminOrgApi.getOrgChart();
    expect(chart.map((d) => d.departmentCode)).toEqual(['SAL', 'PUR', 'PRD', 'QC', 'LOG', 'MGT']);
    const production = chart.find((d) => d.departmentCode === 'PRD');
    expect(production?.children.map((d) => d.departmentName)).toEqual(['제선파트', '제강파트', '연주파트', '열연파트']);
    expect(production?.totalMemberCount).toBe(6);
    const steel = production?.children.find((d) => d.departmentCode === 'PRD-STEEL');
    expect(steel?.members.map((m) => [m.employeeName, m.jobGradeName, m.isHead])).toEqual([
      ['장혜린', '과장', true],
      ['조은서', '사원', false],
    ]);
    expect(steel?.head).toEqual({ id: employeeIdOf(SEED_EMPLOYEE_NO.steelmakingHead), employeeName: '장혜린', jobGradeName: '과장' });
  });

  it('사용 안 함 사원은 빠진다', async () => {
    getMockDb().transact((tx) => {
      const row = tx.tables.employee.find((e) => e.employeeNo === SEED_EMPLOYEE_NO.steelmaking);
      if (row) row.isActive = false;
    });
    const chart = await adminOrgApi.getOrgChart();
    const steel = chart.find((d) => d.departmentCode === 'PRD')?.children.find((d) => d.departmentCode === 'PRD-STEEL');
    expect(steel?.members.map((m) => m.employeeName)).toEqual(['장혜린']);
  });
});
