// 대시보드 구매 위젯 2개의 서버 모드: 원료 잔량 대비 소요는 서버 MRP, 구매 진행은 서버 구매요청·발주 목록에서 묶는다.
// 위젯 권한은 서버 로그인 사원(/auth/me)의 역할 권한으로 본다.
import type { AuthUser, MrpRequirementsView, PurchaseOrderView, PurchaseRequisitionSummary } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { dashboardApi, DASHBOARD_MRP_HORIZON_DAYS } from '@/api/dashboard';
import { ok, page, stopFakeServer, useFakeServer, type ServerCall } from '@/api/server/serverTestKit';
import { addDays } from '@/lib/salesOrderStatus';
import { toSeoulDateString } from '@/lib/seoulDate';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

const mrp: MrpRequirementsView = {
  from: '0001-01-01',
  to: '2026-11-05',
  heatCapacityTon: '250.000',
  plans: [],
  materials: [
    {
      itemId: 904,
      itemCode: 'SMN01',
      itemName: '실리코망가니즈',
      rawMaterialType: 'FERROALLOY',
      requiredTon: '5.000',
      remainingTon: '3.500',
      scheduledReceiptTon: '4.000',
      usedRemainingTon: '3.500',
      usedScheduledReceiptTon: '1.000',
      netRequirementTon: '0.500',
      firstShortageDate: '2026-10-20',
    },
  ],
  requisitionLines: [],
};

const requisition = (id: number, purchaseRequisitionStatus: PurchaseRequisitionSummary['purchaseRequisitionStatus']): PurchaseRequisitionSummary => ({
  id,
  purchaseRequisitionNo: `PR-2610-000${id}`,
  purchaseRequisitionStatus,
  itemId: 41,
  itemCode: 'SMN01',
  itemName: '실리코망가니즈',
  defaultSupplierId: 8,
  defaultSupplierName: '한국합금철',
  requestedTon: '1.000',
  desiredReceiptDate: '2026-10-20',
  requesterId: 77,
  requesterName: '정다은',
  departmentId: 55,
  departmentName: '구매부',
  approverId: null,
  approverName: null,
  approvedAt: null,
  productionPlanId: null,
  productionPlanNo: null,
  actionDraftId: null,
  purchaseOrderNo: null,
  rejectedAt: null,
  createdAt: '2026-10-06T01:00:00.000Z',
  updatedAt: '2026-10-06T01:00:00.000Z',
});

const order = (id: number, purchaseOrderStatus: PurchaseOrderView['purchaseOrderStatus'], remainingTon: string, expectedReceiptDate: string): PurchaseOrderView => ({
  id,
  purchaseOrderNo: `PO-2610-000${id}`,
  purchaseOrderStatus,
  supplierId: 8,
  supplierName: '한국합금철',
  orderedEmployeeName: '정다은',
  totalOrderedTon: '5.000',
  totalReceivedTon: '0.000',
  totalRemainingTon: remainingTon,
  createdAt: '2026-10-06T01:00:00.000Z',
  updatedAt: '2026-10-06T01:00:00.000Z',
  items: [{ purchaseOrderItemId: id * 10, purchaseRequisitionId: 1, purchaseRequisitionNo: 'PR-2610-0001', itemId: 41, itemCode: 'SMN01', itemName: '실리코망가니즈', orderedTon: '5.000', expectedReceiptDate, receivedTon: '0.000', remainingTon }],
});

/** 서버 로그인 사원. 권한만 테스트마다 다르게 준다 */
const me = (permissions: AuthUser['permissions']): AuthUser => ({
  employeeId: 900,
  employeeNo: '9999001',
  employeeName: '서버 사원',
  departmentId: 1,
  jobGradeId: 1,
  roleCode: 'PURCHASE',
  headDepartmentIds: [],
  permissions,
});
const PURCHASE_USER = me({ PURCHASE_REQUISITION_CREATE: 'USE', PURCHASE_ORDER_CONFIRM: 'USE' });

/** /auth/me는 user로, 나머지는 구매·MRP 목록으로 답한다 */
const respondAs = (user: AuthUser) => (c: ServerCall) => (c.path === '/auth/me' ? ok(user) : respond(c));

function respond(c: ServerCall) {
  if (c.path === '/mrp/requirements') return ok(mrp);
  if (c.path === '/purchase-requisitions') return ok(page([requisition(1, 'WAITING_APPROVAL'), requisition(2, 'WAITING_APPROVAL'), requisition(3, 'ORDERED')]));
  if (c.path === '/purchase-orders') return ok(page([order(1, 'CONFIRMED', '5.000', '2026-10-15'), order(2, 'RECEIVED', '0.000', '2026-10-01'), order(3, 'PARTIALLY_RECEIVED', '2.500', '2026-10-10')]));
  if (c.path === '/goods-receipts') return ok(page([]));
  return undefined;
}

afterEach(() => stopFakeServer());

describe('대시보드 구매 위젯 서버 모드', () => {
  it('원료 잔량 대비 소요: 서버 MRP를 오늘 + 30일까지 읽어 위젯 칸으로 옮긴다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, respondAs(PURCHASE_USER));
    const data = await dashboardApi.widget('RAW_MATERIAL_BALANCE');
    const to = addDays(toSeoulDateString(new Date()), DASHBOARD_MRP_HORIZON_DAYS);

    expect(calls.find((c) => c.path === '/mrp/requirements')?.query).toEqual({ from: '0001-01-01', to });
    expect(data.to).toBe(to);
    expect(data.materials[0]).toMatchObject({ itemCode: 'SMN01', onHandTon: '3.500', scheduledReceiptTon: '4.000', coveredScheduledTon: '1.000', grossTon: '5.000', netTon: '0.500', firstShortageDate: '2026-10-20' });
  });

  it('구매 진행: 구매요청 상태별 건수와 입고가 남은 발주(가장 이른 입고 예정일 순)', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.purchase, respondAs(PURCHASE_USER));
    const data = await dashboardApi.widget('PURCHASE_PROGRESS');

    expect(data.requisitionsByStatus?.find((s) => s.status === 'WAITING_APPROVAL')?.count).toBe(2);
    expect(data.requisitionsByStatus?.find((s) => s.status === 'ORDERED')?.count).toBe(1);
    expect(data.openPurchaseOrders).toMatchObject({ count: 2, scheduledReceiptTon: '7.500' });
    expect(data.openPurchaseOrders?.purchaseOrders.map((po) => [po.purchaseOrderNo, po.expectedReceiptDate])).toEqual([
      ['PO-2610-0003', '2026-10-10'],
      ['PO-2610-0001', '2026-10-15'],
    ]);
  });

  it('구매 진행: 발주 조회 권한이 없으면(생산) 발주 쪽은 null이고 발주 목록을 부르지 않는다. 둘 다 없으면 COM-002', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.productionHead, respondAs(me({ PURCHASE_REQUISITION_CREATE: 'VIEW', PRODUCTION_PLAN_CONFIRM: 'USE' })));
    const data = await dashboardApi.widget('PURCHASE_PROGRESS');

    expect(data.requisitionsByStatus).not.toBeNull();
    expect(data.openPurchaseOrders).toBeNull();
    expect(calls.some((c) => c.path === '/purchase-orders')).toBe(false);
    stopFakeServer();

    useFakeServer(SEED_EMPLOYEE_NO.logistics, respondAs(me({ GOODS_ISSUE_CONFIRM: 'USE' })));
    await expect(dashboardApi.widget('PURCHASE_PROGRESS')).rejects.toMatchObject({ code: 'COM-002' });
  });

  it('권한은 가짜 DB가 아니라 서버 역할 권한을 따른다: 서버에서 물류 역할에 구매요청 조회를 주면 보이고, 구매 역할에서 빼면 COM-002', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.logistics, respondAs(me({ PURCHASE_REQUISITION_CREATE: 'VIEW' })));
    expect((await dashboardApi.widget('RAW_MATERIAL_BALANCE')).materials).toHaveLength(1);
    stopFakeServer();

    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, respondAs(me({})));
    await expect(dashboardApi.widget('RAW_MATERIAL_BALANCE')).rejects.toMatchObject({ code: 'COM-002' });
    expect(calls.map((c) => c.path)).toEqual(['/auth/me']);
  });
});
