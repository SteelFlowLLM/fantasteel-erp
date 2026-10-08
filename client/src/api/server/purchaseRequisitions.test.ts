// 구매요청·승인 서버 어댑터: 서버 응답 → 화면 모양(출처 계산, 원료 id 맞춤, 사원·부서는 서버 id), 승인 판단·등록 창은 로그인 사원과 조직도, 승인함 쿼리, 등록 시 원료 id 바꾸기.
import type { AuthUser, DepartmentNode, ItemView, PurchaseRequisitionDetail, PurchaseRequisitionSummary } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { approvalApi } from '@/api/approvals';
import { purchaseRequisitionApi } from '@/api/purchasing';
import { fail, ok, page, stopFakeServer, useFakeServer, type ServerCall } from '@/api/server/serverTestKit';
import { SEED_EMPLOYEE_NO } from '@/test/actors';


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
  rejectedAt: null,
  createdAt: '2026-10-06T01:00:00.000Z',
  updatedAt: '2026-10-06T01:00:00.000Z',
};
const detail: PurchaseRequisitionDetail = { ...summary, requestReason: 'MRP 부족분', rejectReason: null, salesOrderId: null, salesOrderNo: null };

// 서버 id: 구매부(55)의 부서장 최준혁(70), 요청자 정다은(77)
const AT = '2026-10-07T00:00:00.000Z';
const member = (id: number, employeeName: string, jobGradeName: string, isHead = false) => ({ id, employeeNo: `90${id}`, employeeName, jobGradeId: 1, jobGradeName, isHead });
const tree: DepartmentNode[] = [
  {
    id: 55,
    departmentCode: 'PUR',
    departmentName: '구매부',
    parentId: null,
    headEmployeeId: 70,
    headEmployeeName: '최준혁',
    members: [member(70, '최준혁', '부장', true), member(77, '정다은', '사원')],
    children: [],
    createdAt: AT,
    updatedAt: AT,
  },
];
const authUser = (employeeId: number, headDepartmentIds: number[]): AuthUser => ({
  employeeId,
  employeeNo: `90${employeeId}`,
  employeeName: employeeId === 70 ? '최준혁' : '정다은',
  roleCode: 'PURCHASE',
  departmentId: 55,
  jobGradeId: 1,
  headDepartmentIds,
  permissions: {},
});
/** 로그인 사원(/auth/me)·조직도(/departments) 응답을 붙인다 */
const withOrg = (user: AuthUser, respond: (c: ServerCall) => Response | undefined) => (c: ServerCall) =>
  c.path === '/auth/me' ? ok(user) : c.path === '/departments' ? ok(tree) : respond(c);

afterEach(() => {
  stopFakeServer();
});

describe('구매요청·승인 서버 어댑터 (api/server/purchaseRequisitions.ts)', () => {
  it('목록: 출처를 계산하고 원료·요청자·부서 id와 발주번호·반려 일시는 그대로 둔다', async () => {
    const rejected = { ...summary, id: 902, purchaseRequisitionStatus: 'REJECTED' as const, productionPlanId: null, actionDraftId: 5, rejectedAt: '2026-10-06T02:00:00.000Z' };
    useFakeServer(SEED_EMPLOYEE_NO.purchase, (c) => (c.path === '/purchase-requisitions' ? ok(page([{ ...summary, purchaseOrderNo: 'PO-2610-0001' }, rejected])) : undefined));
    const rows = await purchaseRequisitionApi.list();

    expect(rows.map((r) => r.source)).toEqual(['MRP', 'MESSAGE']);
    expect(rows[0]).toMatchObject({
      id: 901,
      itemId: 41,
      requesterId: 77,
      departmentId: 55,
      purchaseOrderNo: 'PO-2610-0001',
      rejectedAt: null,
    });
    expect(rows[1].rejectedAt).toBe('2026-10-06T02:00:00.000Z');
  });

  it('상세: 요청자 본인이면 isRequester, 요청자 소속 부서의 부서장이 보면 canApprove. 직급·부서장 이름은 조직도에서', async () => {
    const one = (c: ServerCall) => (c.path === '/purchase-requisitions/901' ? ok(detail) : undefined);
    useFakeServer(SEED_EMPLOYEE_NO.purchase, withOrg(authUser(77, []), one));
    expect(await purchaseRequisitionApi.detail(901)).toMatchObject({
      isRequester: true,
      canApprove: false,
      requesterJobGradeName: '사원',
      requestReason: 'MRP 부족분',
      departmentHeadName: '최준혁',
      purchaseOrderLines: [],
      sourceDraft: null,
    });
    stopFakeServer();

    useFakeServer(SEED_EMPLOYEE_NO.purchaseHead, withOrg(authUser(70, [55]), one));
    expect(await purchaseRequisitionApi.detail(901)).toMatchObject({ isRequester: false, canApprove: true });
    stopFakeServer();

    useFakeServer(SEED_EMPLOYEE_NO.purchaseHead, withOrg(authUser(70, [55]), (c) => (c.path === '/purchase-requisitions/901' ? ok({ ...detail, purchaseRequisitionStatus: 'APPROVED' }) : undefined)));
    expect(await purchaseRequisitionApi.detail(901)).toMatchObject({ canApprove: false });
  });

  it('등록 창: 요청자·소속 부서·부서장 이름은 로그인 사원과 조직도에서 읽는다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.purchase, withOrg(authUser(77, []), () => undefined));
    expect(await purchaseRequisitionApi.formContext()).toEqual({ requesterName: '정다은', departmentName: '구매부', headName: '최준혁' });
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

  it('등록: 원료·근거 계획 id는 서버 모드 선택 목록·MRP가 준 서버 id라 그대로 보내고, 규격 목록을 읽지 않는다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, (c) => {
      if (c.path === '/purchase-requisitions' && c.method === 'POST') return ok(detail);
      return undefined;
    });
    await purchaseRequisitionApi.create({ itemId: 41, requestedTon: '2.5', desiredReceiptDate: '2026-10-20', requestReason: '  ', productionPlanId: 300 });
    await purchaseRequisitionApi.create({ itemId: 41, requestedTon: '1', desiredReceiptDate: '2026-10-20', requestReason: '' });

    expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([
      { itemId: 41, productionPlanId: 300, requestedTon: '2.5', desiredReceiptDate: '2026-10-20', requestReason: null },
      { itemId: 41, productionPlanId: null, requestedTon: '1', desiredReceiptDate: '2026-10-20', requestReason: null },
    ]);
    expect(calls.some((c) => c.path === '/production-plans' || c.path === '/items')).toBe(false);
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
