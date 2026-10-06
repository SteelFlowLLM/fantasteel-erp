// 구매요청·승인 서버 어댑터: 서버 응답 → 화면 모양(출처 계산, 원료·사원·부서 id 맞춤), 승인함 쿼리, 등록 시 원료·계획 id 바꾸기.
import type { ItemView, PurchaseRequisitionDetail, PurchaseRequisitionSummary } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { approvalApi } from '@/api/approvals';
import { purchaseRequisitionApi } from '@/api/purchasing';
import { resetMasterIdCacheForTest } from '@/api/server/masterIds';
import { fail, ok, page, stopFakeServer, useFakeServer } from '@/api/server/serverTestKit';
import { getMockDb } from '@/mock/db';
import type { MockTables } from '@/mock/schema';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

const read = <T>(reader: (tables: Readonly<MockTables>) => T): T => getMockDb().read(reader);
const mockEmployee = (employeeNo: string) => read((t) => t.employee.find((e) => e.employeeNo === employeeNo));
const mockItemId = (itemCode: string) => read((t) => t.item.find((i) => i.itemCode === itemCode)?.id);

const summary: PurchaseRequisitionSummary = {
  id: 901,
  purchaseRequisitionNo: 'PR-2610-0001',
  purchaseRequisitionStatus: 'WAITING_APPROVAL',
  itemId: 41,
  itemCode: 'SMN01',
  itemName: '실리코망가니즈',
  defaultSupplierId: 8,
  defaultSupplierName: '한국합금철',
  requestedTon: '2.500',
  desiredReceiptDate: '2026-10-20',
  requesterId: 77,
  requesterName: '정다은',
  departmentId: 55,
  departmentName: '구매부',
  approverId: null,
  approverName: null,
  approvedAt: null,
  productionPlanId: 300,
  productionPlanNo: 'PP-2610-0001',
  actionDraftId: null,
  purchaseOrderNo: null,
  createdAt: '2026-10-06T01:00:00.000Z',
  updatedAt: '2026-10-06T01:00:00.000Z',
};
const detail: PurchaseRequisitionDetail = { ...summary, requestReason: 'MRP 부족분', rejectReason: null, salesOrderId: null, salesOrderNo: null };

afterEach(() => {
  stopFakeServer();
  resetMasterIdCacheForTest();
});

describe('구매요청·승인 서버 어댑터 (api/server/purchaseRequisitions.ts)', () => {
  it('목록: 출처를 계산하고 원료·요청자·부서 id를 화면 id로 맞추며 발주번호를 그대로 둔다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.purchase, (c) => (c.path === '/purchase-requisitions' ? ok(page([{ ...summary, purchaseOrderNo: 'PO-2610-0001' }, { ...summary, id: 902, productionPlanId: null, actionDraftId: 5 }])) : undefined));
    const rows = await purchaseRequisitionApi.list();

    expect(rows.map((r) => r.source)).toEqual(['MRP', 'MESSAGE']);
    expect(rows[0]).toMatchObject({
      id: 901,
      itemId: mockItemId('SMN01'),
      requesterId: mockEmployee(SEED_EMPLOYEE_NO.purchase)?.id,
      departmentId: mockEmployee(SEED_EMPLOYEE_NO.purchase)?.departmentId,
      purchaseOrderNo: 'PO-2610-0001',
      rejectedAt: null,
    });
  });

  it('상세: 요청자 본인이면 isRequester, 승인권자(구매부장)가 보면 canApprove', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.purchase, (c) => (c.path === '/purchase-requisitions/901' ? ok(detail) : undefined));
    expect(await purchaseRequisitionApi.detail(901)).toMatchObject({ isRequester: true, canApprove: false, requestReason: 'MRP 부족분', departmentHeadName: '최준혁', purchaseOrderLines: [], sourceDraft: null });
    stopFakeServer();

    useFakeServer(SEED_EMPLOYEE_NO.purchaseHead, (c) => (c.path === '/purchase-requisitions/901' ? ok(detail) : undefined));
    expect(await purchaseRequisitionApi.detail(901)).toMatchObject({ isRequester: false, canApprove: true });
  });

  it('승인함은 approvable=true로 묻고 먼저 온 것부터, 배지는 total을 쓰며 부서장이 아니면 0', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchaseHead, (c) => (c.path === '/purchase-requisitions' ? ok(page([{ ...summary, id: 905 }, summary], c.query.size === '1' ? 7 : 2)) : undefined));
    expect((await approvalApi.inbox()).map((r) => r.id)).toEqual([901, 905]);
    expect(await approvalApi.countWaiting(0)).toBe(7);
    expect(calls.every((c) => c.query.approvable === 'true')).toBe(true);
    stopFakeServer();

    useFakeServer(SEED_EMPLOYEE_NO.purchase, () => fail(403, 'COM-002', '권한이 없어요'));
    expect(await approvalApi.countWaiting(0)).toBe(0);
  });

  it('등록: 원료 id는 서버 id로, 근거 계획은 계획 번호로 서버 id를 찾아 보낸다. 서버에 없는 계획이면 입력 오류', async () => {
    const plan = read((t) => t.productionPlan[0]);
    const items: Partial<ItemView>[] = [{ id: 41, itemCode: 'SMN01' }];
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, (c) => {
      if (c.path === '/items') return ok(items);
      if (c.path === '/production-plans') return ok(page([{ id: 300, productionPlanNo: plan?.productionPlanNo }]));
      if (c.path === '/purchase-requisitions' && c.method === 'POST') return ok(detail);
      return undefined;
    });
    const input = { itemId: mockItemId('SMN01') ?? 0, requestedTon: '2.5', desiredReceiptDate: '2026-10-20', requestReason: '  ', productionPlanId: plan?.id };
    await purchaseRequisitionApi.create(input);
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ itemId: 41, productionPlanId: 300, requestedTon: '2.5', desiredReceiptDate: '2026-10-20', requestReason: null });
    stopFakeServer();

    useFakeServer(SEED_EMPLOYEE_NO.purchase, (c) => (c.path === '/items' ? ok(items) : c.path === '/production-plans' ? ok(page([])) : undefined));
    await expect(purchaseRequisitionApi.create(input)).rejects.toMatchObject({ fieldErrors: { productionPlanId: expect.any(String) } });
  });

  it('승인·반려·재요청은 해당 경로로 보내고 expectedUpdatedAt은 보내지 않는다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchaseHead, () => ok(detail));
    await approvalApi.approve({ purchaseRequisitionId: 901, expectedUpdatedAt: 'x' });
    await approvalApi.reject({ purchaseRequisitionId: 901, expectedUpdatedAt: 'x', rejectReason: '수량 확인' });
    await purchaseRequisitionApi.resubmit({ purchaseRequisitionId: 901, expectedUpdatedAt: 'x', itemId: 1, requestedTon: '3', desiredReceiptDate: '2026-10-21', requestReason: '' });

    expect(calls.map((c) => [c.path, c.body])).toEqual([
      ['/purchase-requisitions/901/approve', undefined],
      ['/purchase-requisitions/901/reject', { rejectReason: '수량 확인' }],
      ['/purchase-requisitions/901/resubmit', { requestedTon: '3', desiredReceiptDate: '2026-10-21', requestReason: null }],
    ]);
  });
});
