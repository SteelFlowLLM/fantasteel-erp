// 반려 뒤 다시 요청할 때 승인 부서 (REQ-AUTH-004 요청자 소속 부서의 부서장만 승인, 업무 프로세스 10장 REJECTED → WAITING_APPROVAL).
// 반려와 재요청 사이에 요청자가 부서를 옮기면, 알림을 받는 부서장과 승인할 수 있는 부서장이 같아야 한다(다시 요청한 시점의 소속 부서).
import { describe, expect, it } from 'vitest';
import { approvalApi } from '@/api/approvals';
import { purchaseRequisitionApi } from '@/api/purchasing';
import { getMockDb } from '@/mock/db';
import type { MockTables } from '@/mock/schema';
import { updateRow } from '@/mock/store';
import { actAs, departmentIdOf, employeeIdOf, SEED_EMPLOYEE_NO } from '@/test/actors';

const read = <T>(reader: (tables: Readonly<MockTables>) => T): T => getMockDb().read(reader);

describe('구매요청 재요청 · 요청자 부서 이동', () => {
  it('다시 요청하면 요청 부서가 지금 소속 부서로 바뀌고, 그 부서장만 알림을 받고 승인할 수 있다', async () => {
    const oreId = read((t) => t.item.find((i) => i.itemCode === 'ORE01')?.id) ?? 0;
    const values = { itemId: oreId, requestedTon: '10' };

    actAs(SEED_EMPLOYEE_NO.purchase);
    const created = await purchaseRequisitionApi.create({ desiredReceiptDate: '', requestReason: '', ...values });
    expect(created.departmentId).toBe(departmentIdOf('PUR'));
    actAs(SEED_EMPLOYEE_NO.purchaseHead);
    const rejected = await approvalApi.reject({ purchaseRequisitionId: created.id, expectedUpdatedAt: created.updatedAt, rejectReason: '수량을 다시 확인해 주세요' });

    // 반려 뒤 요청자(정다은)가 구매부 → 영업부로 옮긴다 (역할·권한은 그대로)
    const requesterId = employeeIdOf(SEED_EMPLOYEE_NO.purchase);
    getMockDb().transact((tx) => updateRow(tx, 'employee', requesterId, { departmentId: departmentIdOf('SAL') }));

    actAs(SEED_EMPLOYEE_NO.purchase);
    const resubmitted = await purchaseRequisitionApi.resubmit({ purchaseRequisitionId: created.id, expectedUpdatedAt: rejected.updatedAt, desiredReceiptDate: '', requestReason: '부서 이동 뒤 다시 요청', ...values });
    expect(resubmitted).toMatchObject({ purchaseRequisitionStatus: 'WAITING_APPROVAL', departmentId: departmentIdOf('SAL'), departmentName: '영업부' });

    // 승인 요청 알림은 영업부 부서장(김도윤)에게 간다
    const salesHeadId = employeeIdOf(SEED_EMPLOYEE_NO.salesHead);
    const purchaseHeadId = employeeIdOf(SEED_EMPLOYEE_NO.purchaseHead);
    const approvalRequests = read((t) => t.notification.filter((n) => n.notificationType === 'APPROVAL_REQUESTED' && n.linkPath === `/approvals?pr=${created.id}`));
    expect(approvalRequests.some((n) => n.recipientId === salesHeadId)).toBe(true);

    // 옛 부서장(최준혁)의 승인함·배지에는 없고 승인하면 COM-002
    actAs(SEED_EMPLOYEE_NO.purchaseHead);
    expect((await approvalApi.inbox()).some((row) => row.id === created.id)).toBe(false);
    const purchaseHeadWaiting = await approvalApi.countWaiting(purchaseHeadId);
    await expect(approvalApi.approve({ purchaseRequisitionId: created.id, expectedUpdatedAt: resubmitted.updatedAt })).rejects.toMatchObject({ code: 'COM-002' });
    expect(await approvalApi.countWaiting(purchaseHeadId)).toBe(purchaseHeadWaiting);

    // 알림을 받은 영업부 부서장의 승인함에 있고 승인할 수 있다
    actAs(SEED_EMPLOYEE_NO.salesHead);
    expect((await approvalApi.inbox()).some((row) => row.id === created.id)).toBe(true);
    expect((await purchaseRequisitionApi.detail(created.id)).canApprove).toBe(true);
    expect(await approvalApi.approve({ purchaseRequisitionId: created.id, expectedUpdatedAt: resubmitted.updatedAt })).toMatchObject({ purchaseRequisitionStatus: 'APPROVED' });
  });
});
