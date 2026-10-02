import { describe, expect, it } from 'vitest';
import { PERMISSION } from '@/codes';
import { requireActor, requireDepartmentHead, setActingEmployeeForTest } from '@/api/actor';
import { ApiError, mockMutation, mockQuery } from '@/api/client';
import { getMockDb } from '@/mock/db';
import { updateRow } from '@/mock/store';
import { actAs, SEED_EMPLOYEE_NO } from '@/test/actors';

/** ApiError의 코드와 덧붙임 */
async function errorOf(promise: Promise<unknown>): Promise<{ code: string; detail: string | null }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return { code: error.code, detail: error.detail };
    throw error;
  }
  throw new Error('오류가 나지 않았어요');
}

describe('requireActor (BP-AUTH-01 각 API에서 권한 재확인)', () => {
  it('계정 선택이 없으면 COM-002', async () => {
    setActingEmployeeForTest(null);
    expect(await errorOf(mockQuery((tables) => requireActor(tables)))).toEqual({ code: 'COM-002', detail: null });
  });

  it('사용(USE) 권한이 있으면 통과하고, 없으면 COM-002와 필요한 권한 이름을 알려 준다', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const actor = await mockQuery((tables) => requireActor(tables, { use: [PERMISSION.MASTER_MANAGE] }));
    expect(actor.employee.employeeNo).toBe(SEED_EMPLOYEE_NO.admin);

    actAs(SEED_EMPLOYEE_NO.sales);
    expect(await errorOf(mockQuery((tables) => requireActor(tables, { use: [PERMISSION.MASTER_MANAGE] })))).toEqual({
      code: 'COM-002',
      detail: '기준정보 관리 사용 권한이 필요해요',
    });
  });

  it('조회(VIEW)만 있으면 조회 규칙은 통과하고 사용 규칙은 막힌다 (관리자 → 수주 등록 조회)', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    await expect(mockQuery((tables) => requireActor(tables, { view: [PERMISSION.SALES_ORDER_CREATE] }))).resolves.toBeDefined();
    expect((await errorOf(mockQuery((tables) => requireActor(tables, { use: [PERMISSION.SALES_ORDER_CREATE] })))).code).toBe('COM-002');
  });

  it('여러 권한 중 하나만 있어도 된다', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    await expect(mockQuery((tables) => requireActor(tables, { use: [PERMISSION.MASTER_MANAGE, PERMISSION.INSPECTION_STANDARD_MANAGE] }))).resolves.toBeDefined();
  });

  it('사용 안 함(is_active = false) 사원은 아무것도 할 수 없다', async () => {
    const id = actAs(SEED_EMPLOYEE_NO.sales);
    getMockDb().transact((tx) => updateRow(tx, 'employee', id, { isActive: false }));
    expect((await errorOf(mockQuery((tables) => requireActor(tables)))).code).toBe('COM-002');
  });

  it('권한이 없어 거부된 변경은 아무것도 저장하지 않는다', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    const before = getMockDb().read((tables) => tables.customer.length);
    await expect(
      mockMutation((tx) => {
        tx.tables.customer.push({ id: 99, customerCode: 'X', customerName: 'X', createdAt: tx.nowIso, updatedAt: tx.nowIso });
        requireActor(tx.tables, { use: [PERMISSION.MASTER_MANAGE] });
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(getMockDb().read((tables) => tables.customer.length)).toBe(before);
  });
});

describe('requireDepartmentHead (REQ-AUTH-004)', () => {
  it('부서장은 통과, 부서장이 아니면 COM-002', async () => {
    actAs(SEED_EMPLOYEE_NO.purchaseHead);
    const head = await mockQuery((tables) => requireDepartmentHead(tables));
    expect(head.headDepartmentIds).toHaveLength(1);

    actAs(SEED_EMPLOYEE_NO.purchase);
    expect(await errorOf(mockQuery((tables) => requireDepartmentHead(tables)))).toEqual({ code: 'COM-002', detail: '부서장만 할 수 있어요' });
  });
});
