// 구매 영역 api 함수 시험: MRP → 구매요청 → 승인함 → 발주 → 입고 (14.1 3단계) 와 9.3 에러 코드 (PUR-001~003, COM-001~003).
// 시드(2026년 9월 거래)를 쓰고, 큰 수주 하나를 core 서비스로 만들어 원료가 모자라게 한다.
import { describe, expect, it } from 'vitest';
import { approvalApi } from '@/api/approvals';
import { InputError } from '@/api/client';
import { goodsReceiptApi } from '@/api/goodsReceipts';
import { mrpApi } from '@/api/mrp';
import { purchaseOrderApi, purchaseRequisitionApi } from '@/api/purchasing';
import { defaultMrpPeriod } from '@/features/purchasing/lib/purchasingView';
import { todayStr } from '@/lib/format';
import { getMockDb } from '@/mock/db';
import type { MockTables } from '@/mock/schema';
import { createSalesOrder, userActor } from '@/mock/services';
import { actAs, employeeIdOf, SEED_EMPLOYEE_NO } from '@/test/actors';

const read = <T>(reader: (tables: Readonly<MockTables>) => T): T => getMockDb().read(reader);
const itemIdOf = (itemCode: string): number => {
  const id = read((t) => t.item.find((i) => i.itemCode === itemCode)?.id);
  if (id === undefined) throw new Error(`품목 없음 ${itemCode}`);
  return id;
};
const requisitionIdOf = (no: string): number => {
  const id = read((t) => t.purchaseRequisition.find((p) => p.purchaseRequisitionNo === no)?.id);
  if (id === undefined) throw new Error(`구매요청 없음 ${no}`);
  return id;
};

/** 날짜 문자열 + n일 */
const plusDays = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** SS275 슬래브 66매 수주 (재고 6 + 부족 60 → 6히트, 철광석 2,666.667t) → 시드 철광석 잔량 2,333.330t로는 모자란다 */
function createBigSalesOrder(dueDate: string): number {
  const salesId = employeeIdOf(SEED_EMPLOYEE_NO.sales);
  const customerId = read((t) => t.customer.find((c) => c.customerCode === 'CUS-01')?.id) ?? 0;
  const result = getMockDb().transact((tx) =>
    createSalesOrder(tx, userActor(salesId), { customerId, items: [{ itemId: itemIdOf('SL-SS275-250x1200x10000'), orderedQty: 66, dueDate }] }),
  );
  const plan = result.productionPlans[0];
  if (!plan) throw new Error('생산계획이 없어요');
  return plan.id;
}

describe('MRP api', () => {
  it('기간 안 계획의 순소요를 바로 계산하고, 구매요청 만들 줄을 준다 (저장하지 않음)', async () => {
    const today = todayStr();
    const dueDate = plusDays(today, 10);
    const planId = createBigSalesOrder(dueDate);
    actAs(SEED_EMPLOYEE_NO.purchase);
    const period = { from: today, to: plusDays(today, 30) };
    const mrp = await mrpApi.requirements(period);
    const plan = mrp.plans.find((p) => p.productionPlanId === planId);
    expect(plan).toMatchObject({ remainingHeatCount: 6, heatTon: '1500.000', needDate: dueDate });
    expect(plan?.expectedSurplusSlabQty).toBeGreaterThanOrEqual(0);
    const ore = mrp.materials.find((m) => m.itemCode === 'ORE01');
    expect(ore && Number(ore.netTon)).toBeGreaterThan(0);
    expect(mrp.requisitionLines).toEqual(expect.arrayContaining([expect.objectContaining({ productionPlanId: planId, itemCode: 'ORE01', existingPurchaseRequisitionNo: null })]));
    // 결과를 저장하지 않는다: 이벤트·테이블 변화 없음
    const before = read((t) => t.businessEvent.length);
    await mrpApi.requirements(period);
    expect(read((t) => t.businessEvent.length)).toBe(before);
  });

  it('기간 밖 계획은 빠지고, 생산(조회 권한)도 볼 수 있다', async () => {
    const today = todayStr();
    const planId = createBigSalesOrder(plusDays(today, 60));
    actAs(SEED_EMPLOYEE_NO.productionHead);
    const mrp = await mrpApi.requirements({ from: today, to: plusDays(today, 30) });
    expect(mrp.plans.some((p) => p.productionPlanId === planId)).toBe(false);
  });

  it('조회 권한이 없으면 COM-002, 기간이 거꾸로면 입력 오류', async () => {
    actAs(SEED_EMPLOYEE_NO.logistics);
    await expect(mrpApi.requirements(defaultMrpPeriod('2026-10-01'))).rejects.toMatchObject({ code: 'COM-002' });
    actAs(SEED_EMPLOYEE_NO.purchase);
    const error = await mrpApi.requirements({ from: '2026-10-31', to: '2026-10-01' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InputError);
    expect(Object.keys((error as InputError).fieldErrors)).toContain('to');
    await expect(mrpApi.requirements({ from: '2026-10', to: '2026-10-31' })).rejects.toBeInstanceOf(InputError);
  });
});

describe('구매요청 api', () => {
  it('톤 입력은 decimal(12,3) 모양(소수 3자리)으로 저장하고(core), 형식이 틀리면 입력 오류', async () => {
    actAs(SEED_EMPLOYEE_NO.purchase);
    const view = await purchaseRequisitionApi.create({ desiredReceiptDate: '2026-10-20', requestReason: '', items: [{ itemId: itemIdOf('COL01'), requiredTon: ' 1,200 ' }] });
    expect(read((t) => t.purchaseRequisitionItem.filter((i) => i.purchaseRequisitionId === view.id).map((i) => i.requiredTon))).toEqual(['1200.000']);
    for (const requiredTon of ['1.2345', '3매']) {
      await expect(purchaseRequisitionApi.create({ desiredReceiptDate: '2026-10-20', requestReason: '', items: [{ itemId: itemIdOf('COL01'), requiredTon }] })).rejects.toBeInstanceOf(InputError);
    }
  });

  it('등록 = 바로 승인 대기, 출처 직접, 부서장에게 승인 요청 알림·작업 로그', async () => {
    const purchaseId = actAs(SEED_EMPLOYEE_NO.purchase);
    const headId = employeeIdOf(SEED_EMPLOYEE_NO.purchaseHead);
    const view = await purchaseRequisitionApi.create({ desiredReceiptDate: '2026-10-20', requestReason: '  석탄 보충  ', items: [{ itemId: itemIdOf('COL01'), requiredTon: '120.5' }] });
    expect(view).toMatchObject({ purchaseRequisitionStatus: 'WAITING_APPROVAL', source: 'DIRECT', requesterId: purchaseId, requestReason: '석탄 보충', totalTon: '120.500' });
    expect(view.purchaseRequisitionNo).toMatch(/^PR-\d{4}-\d{4}$/);
    const notice = read((t) => t.notification.find((n) => n.recipientId === headId && n.notificationType === 'APPROVAL_REQUESTED' && n.title.includes(view.purchaseRequisitionNo)));
    expect(notice?.linkPath).toBe(`/approvals?pr=${view.id}`);
    expect(read((t) => t.businessEvent.some((e) => e.businessEventType === 'PURCHASE_REQUISITION_CREATED' && e.targetId === view.id))).toBe(true);

    const list = await purchaseRequisitionApi.list();
    expect(list[0].id).toBe(view.id);
    const context = await purchaseRequisitionApi.formContext();
    expect(context).toMatchObject({ requesterName: '정다은', headName: '최준혁' });
  });

  it('MRP 줄로 만들면 근거 생산계획이 연결되고 출처가 MRP 계획, 같은 계획·원료는 두 번 못 만든다', async () => {
    const today = todayStr();
    const planId = createBigSalesOrder(plusDays(today, 10));
    actAs(SEED_EMPLOYEE_NO.purchase);
    const period = { from: today, to: plusDays(today, 30) };
    const line = (await mrpApi.requirements(period)).requisitionLines.find((l) => l.productionPlanId === planId && l.itemCode === 'ORE01');
    if (!line) throw new Error('MRP 줄 없음');
    const view = await purchaseRequisitionApi.create({ desiredReceiptDate: '', requestReason: '', items: [{ itemId: line.itemId, requiredTon: line.netTon, productionPlanId: planId }] });
    expect(view.source).toBe('MRP');
    expect(view.items[0]).toMatchObject({ productionPlanId: planId, requiredTon: line.netTon });
    const again = (await mrpApi.requirements(period)).requisitionLines.find((l) => l.productionPlanId === planId && l.itemCode === 'ORE01');
    expect(again?.existingPurchaseRequisitionNo).toBe(view.purchaseRequisitionNo);
    await expect(purchaseRequisitionApi.create({ desiredReceiptDate: '', requestReason: '', items: [{ itemId: line.itemId, requiredTon: '1', productionPlanId: planId }] })).rejects.toBeInstanceOf(InputError);
  });

  it('입력 확인: 원료만, 톤 > 0 (소수 3자리), 같은 원료 두 줄 금지, 없는 품목 COM-003', async () => {
    actAs(SEED_EMPLOYEE_NO.purchase);
    const base = { desiredReceiptDate: '', requestReason: '' };
    const fieldsOf = async (promise: Promise<unknown>) => {
      const error = await promise.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InputError);
      return Object.keys((error as InputError).fieldErrors);
    };
    expect(await fieldsOf(purchaseRequisitionApi.create({ ...base, items: [{ itemId: itemIdOf('COL01'), requiredTon: '0' }] }))).toContain('items.0.requiredTon');
    expect(await fieldsOf(purchaseRequisitionApi.create({ ...base, items: [{ itemId: itemIdOf('COL01'), requiredTon: '1.2345' }] }))).toContain('items.0.requiredTon');
    expect(await fieldsOf(purchaseRequisitionApi.create({ ...base, items: [{ itemId: itemIdOf('SL-SS275-250x1200x10000'), requiredTon: '1' }] }))).toContain('items.0.itemId');
    expect(
      await fieldsOf(
        purchaseRequisitionApi.create({
          ...base,
          items: [
            { itemId: itemIdOf('COL01'), requiredTon: '1' },
            { itemId: itemIdOf('COL01'), requiredTon: '2' },
          ],
        }),
      ),
    ).toContain('items.1.itemId');
    expect(await fieldsOf(purchaseRequisitionApi.create({ ...base, desiredReceiptDate: '2026-13-01', items: [{ itemId: itemIdOf('COL01'), requiredTon: '1' }] }))).toContain('desiredReceiptDate');
    await expect(purchaseRequisitionApi.create({ ...base, items: [{ itemId: 99999, requiredTon: '1' }] })).rejects.toMatchObject({ code: 'COM-003' });
  });

  it('사용 권한이 없으면 COM-002 (영업·조회만 가진 생산), 부서장 없는 부서는 PUR-001', async () => {
    const input = { desiredReceiptDate: '', requestReason: '', items: [{ itemId: itemIdOf('COL01'), requiredTon: '1' }] };
    actAs(SEED_EMPLOYEE_NO.sales);
    await expect(purchaseRequisitionApi.create(input)).rejects.toMatchObject({ code: 'COM-002' });
    actAs(SEED_EMPLOYEE_NO.productionHead);
    await expect(purchaseRequisitionApi.create(input)).rejects.toMatchObject({ code: 'COM-002' });

    const purchaseId = actAs(SEED_EMPLOYEE_NO.purchase);
    getMockDb().transact((tx) => {
      const departmentId = tx.tables.employee.find((e) => e.id === purchaseId)?.departmentId;
      const department = tx.tables.department.find((d) => d.id === departmentId);
      if (department) department.headEmployeeId = null;
    });
    await expect(purchaseRequisitionApi.create(input)).rejects.toMatchObject({ code: 'PUR-001' });
    expect((await purchaseRequisitionApi.formContext()).headName).toBeNull();
  });

  it('상세: 요청자·승인권자·조회 권한자는 보고, 그 밖은 COM-002, 없는 번호는 COM-003', async () => {
    const id = requisitionIdOf('PR-2609-0004');
    actAs(SEED_EMPLOYEE_NO.purchaseHead);
    expect(await purchaseRequisitionApi.detail(id)).toMatchObject({ canApprove: true, isRequester: false, departmentHeadName: '최준혁', purchaseRequisitionStatus: 'WAITING_APPROVAL' });
    actAs(SEED_EMPLOYEE_NO.purchase);
    expect(await purchaseRequisitionApi.detail(id)).toMatchObject({ canApprove: false, isRequester: true });
    actAs(SEED_EMPLOYEE_NO.logistics);
    await expect(purchaseRequisitionApi.detail(id)).rejects.toMatchObject({ code: 'COM-002' });
    await expect(purchaseRequisitionApi.list()).rejects.toMatchObject({ code: 'COM-002' });
    actAs(SEED_EMPLOYEE_NO.purchase);
    await expect(purchaseRequisitionApi.detail(99999)).rejects.toMatchObject({ code: 'COM-003' });
  });
});

describe('승인함 api', () => {
  it('부서장의 승인 대기만 보이고, 부서장이 아니면 COM-002', async () => {
    actAs(SEED_EMPLOYEE_NO.purchaseHead);
    const inbox = await approvalApi.inbox();
    expect(inbox.map((purchaseRequisition) => purchaseRequisition.purchaseRequisitionNo)).toContain('PR-2609-0004');
    expect(inbox.every((purchaseRequisition) => purchaseRequisition.purchaseRequisitionStatus === 'WAITING_APPROVAL')).toBe(true);
    actAs(SEED_EMPLOYEE_NO.salesHead);
    expect(await approvalApi.inbox()).toEqual([]);
    actAs(SEED_EMPLOYEE_NO.purchase);
    await expect(approvalApi.inbox()).rejects.toMatchObject({ code: 'COM-002' });
  });

  it('승인: 요청 부서 부서장만(다른 부서장 COM-002), 그사이 바뀌면 COM-001, 요청자에게 결과 알림', async () => {
    const id = requisitionIdOf('PR-2609-0004');
    const requesterId = employeeIdOf(SEED_EMPLOYEE_NO.purchase);
    actAs(SEED_EMPLOYEE_NO.purchaseHead);
    const opened = await purchaseRequisitionApi.detail(id);
    actAs(SEED_EMPLOYEE_NO.salesHead);
    await expect(approvalApi.approve({ purchaseRequisitionId: id, expectedUpdatedAt: opened.updatedAt })).rejects.toMatchObject({ code: 'COM-002' });
    actAs(SEED_EMPLOYEE_NO.purchaseHead);
    await expect(approvalApi.approve({ purchaseRequisitionId: id, expectedUpdatedAt: '2000-01-01T00:00:00.000Z' })).rejects.toMatchObject({ code: 'COM-001' });
    const approved = await approvalApi.approve({ purchaseRequisitionId: id, expectedUpdatedAt: opened.updatedAt });
    expect(approved).toMatchObject({ purchaseRequisitionStatus: 'APPROVED', approverName: '최준혁' });
    const result = read((t) => t.notification.find((n) => n.recipientId === requesterId && n.notificationType === 'APPROVAL_RESULT' && n.title.includes('PR-2609-0004')));
    expect(result?.linkPath).toBe(`/purchase-requisitions?pr=${id}`);
    expect(read((t) => t.businessEvent.some((e) => e.businessEventType === 'PURCHASE_REQUISITION_APPROVED' && e.targetId === id))).toBe(true);
    expect((await approvalApi.inbox()).some((purchaseRequisition) => purchaseRequisition.id === id)).toBe(false);
  });

  it('반려(사유 필수) → 요청자가 고쳐 다시 요청 → 다시 승인 대기 (요청자만, COM-002)', async () => {
    const id = requisitionIdOf('PR-2609-0004');
    actAs(SEED_EMPLOYEE_NO.purchaseHead);
    const opened = await purchaseRequisitionApi.detail(id);
    await expect(approvalApi.reject({ purchaseRequisitionId: id, rejectReason: '   ', expectedUpdatedAt: opened.updatedAt })).rejects.toBeInstanceOf(InputError);
    const rejected = await approvalApi.reject({ purchaseRequisitionId: id, rejectReason: '수량을 60톤으로 줄여 주세요', expectedUpdatedAt: opened.updatedAt });
    expect(rejected).toMatchObject({ purchaseRequisitionStatus: 'REJECTED', rejectReason: '수량을 60톤으로 줄여 주세요' });
    expect(read((t) => t.businessEvent.some((e) => e.businessEventType === 'PURCHASE_REQUISITION_REJECTED' && e.targetId === id))).toBe(true);

    const items = [{ itemId: itemIdOf('LIM01'), requiredTon: '60' }];
    // 부서장(구매 역할)도 요청자가 아니면 고칠 수 없다
    await expect(purchaseRequisitionApi.resubmit({ purchaseRequisitionId: id, expectedUpdatedAt: rejected.updatedAt, desiredReceiptDate: '', requestReason: '', items })).rejects.toMatchObject({
      code: 'COM-002',
    });
    actAs(SEED_EMPLOYEE_NO.purchase);
    const detail = await purchaseRequisitionApi.detail(id);
    expect(detail).toMatchObject({ isRequester: true, purchaseRequisitionStatus: 'REJECTED' });
    const resubmitted = await purchaseRequisitionApi.resubmit({ purchaseRequisitionId: id, expectedUpdatedAt: detail.updatedAt, desiredReceiptDate: '2026-10-25', requestReason: '60톤으로 줄임', items });
    expect(resubmitted).toMatchObject({ purchaseRequisitionStatus: 'WAITING_APPROVAL', rejectReason: null, totalTon: '60.000', desiredReceiptDate: '2026-10-25' });
    // 승인 대기 요청은 다시 요청할 수 없다
    await expect(purchaseRequisitionApi.resubmit({ purchaseRequisitionId: id, expectedUpdatedAt: resubmitted.updatedAt, desiredReceiptDate: '', requestReason: '', items })).rejects.toBeInstanceOf(InputError);
    actAs(SEED_EMPLOYEE_NO.purchaseHead);
    expect((await approvalApi.inbox()).some((purchaseRequisition) => purchaseRequisition.id === id)).toBe(true);
  });
});

describe('발주 api', () => {
  it('승인 전이면 PUR-002, 승인 뒤에는 기본 공급업체별 발주 1건씩, 모든 품목을 발주하면 발주 완료', async () => {
    actAs(SEED_EMPLOYEE_NO.purchase);
    const created = await purchaseRequisitionApi.create({
      desiredReceiptDate: '2026-10-22',
      requestReason: '',
      items: [
        { itemId: itemIdOf('COL01'), requiredTon: '100' },
        { itemId: itemIdOf('SMN01'), requiredTon: '2.5' },
      ],
    });
    const lineIds = created.items.map((i) => i.id);
    await expect(purchaseOrderApi.create({ purchaseRequisitionItemIds: lineIds, dueDate: '' })).rejects.toMatchObject({ code: 'PUR-002' });

    actAs(SEED_EMPLOYEE_NO.purchaseHead);
    const opened = await purchaseRequisitionApi.detail(created.id);
    await approvalApi.approve({ purchaseRequisitionId: created.id, expectedUpdatedAt: opened.updatedAt });

    actAs(SEED_EMPLOYEE_NO.productionHead);
    await expect(purchaseOrderApi.create({ purchaseRequisitionItemIds: lineIds, dueDate: '' })).rejects.toMatchObject({ code: 'COM-002' });

    actAs(SEED_EMPLOYEE_NO.purchase);
    const candidates = await purchaseOrderApi.candidateItems();
    expect(candidates.filter((i) => i.purchaseRequisitionId === created.id).map((i) => i.supplierName)).toHaveLength(2);
    expect(candidates.some((i) => i.purchaseRequisitionNo === 'PR-2609-0003')).toBe(true);
    const purchaseOrders = await purchaseOrderApi.create({ purchaseRequisitionItemIds: lineIds, dueDate: '' });
    expect(purchaseOrders).toHaveLength(2);
    expect(new Set(purchaseOrders.map((po) => po.supplierId)).size).toBe(2);
    expect(purchaseOrders.every((po) => po.purchaseOrderStatus === 'CONFIRMED' && po.dueDate === '2026-10-22')).toBe(true);
    expect(purchaseOrders.flatMap((po) => po.items.map((i) => i.scheduledReceiptTon)).sort()).toEqual(['100.000', '2.500']);
    expect((await purchaseRequisitionApi.detail(created.id)).purchaseRequisitionStatus).toBe('ORDERED');
    expect((await purchaseRequisitionApi.detail(created.id)).purchaseOrderLines).toHaveLength(2);
    // 이미 발주한 줄은 다시 발주하지 않는다
    await expect(purchaseOrderApi.create({ purchaseRequisitionItemIds: lineIds, dueDate: '' })).rejects.toBeInstanceOf(InputError);
    expect(read((t) => t.businessEvent.filter((e) => e.businessEventType === 'PURCHASE_ORDER_CREATED' && purchaseOrders.some((po) => po.id === e.targetId)).length)).toBe(2);
    expect((await purchaseOrderApi.list()).slice(0, 2).map((po) => po.id).sort()).toEqual(purchaseOrders.map((po) => po.id).sort());
  });
});

describe('입고 api', () => {
  it('부분 입고 = 확정: 원료 LOT(RM-…) 생성, 기본 야드 자동, 입고예정 감소, 넘치면 PUR-003', async () => {
    actAs(SEED_EMPLOYEE_NO.purchase);
    const lines = await goodsReceiptApi.lines();
    const smn = lines.find((l) => l.itemCode === 'SMN01' && !l.isFullyReceived);
    if (!smn) throw new Error('입고예정 합금철 줄 없음');
    expect(smn).toMatchObject({ purchaseOrderStatus: 'PARTIALLY_RECEIVED', scheduledReceiptTon: '3.500' });
    expect(lines.findIndex((l) => l.isFullyReceived)).toBeGreaterThan(lines.findIndex((l) => !l.isFullyReceived));

    await expect(goodsReceiptApi.receive({ purchaseOrderItemId: smn.purchaseOrderItemId, receivedTon: '3.501', receiptDate: '2026-10-02' })).rejects.toMatchObject({ code: 'PUR-003' });
    const fieldsOf = async (promise: Promise<unknown>) => Object.keys(((await promise.catch((e: unknown) => e)) as InputError).fieldErrors);
    expect(await fieldsOf(goodsReceiptApi.receive({ purchaseOrderItemId: smn.purchaseOrderItemId, receivedTon: '0', receiptDate: '2026-10-02' }))).toContain('receivedTon');
    expect(await fieldsOf(goodsReceiptApi.receive({ purchaseOrderItemId: smn.purchaseOrderItemId, receivedTon: '1', receiptDate: '' }))).toContain('receiptDate');

    const first = await goodsReceiptApi.receive({ purchaseOrderItemId: smn.purchaseOrderItemId, receivedTon: ' 1.5 ', receiptDate: '2026-10-02' });
    expect(first).toMatchObject({ receivedTon: '1.500', purchaseOrderStatus: 'PARTIALLY_RECEIVED', lineReceivedTon: '6.000', lineScheduledReceiptTon: '2.000', yardName: smn.defaultYardName });
    expect(first.lotNo).toBe('RM-SMN01-261002-001');
    expect(first.goodsReceiptNo).toMatch(/^GR-\d{4}-\d{4}$/);
    const lot = read((t) => t.lot.find((l) => l.id === first.lotId));
    expect(lot).toMatchObject({ lotType: 'RAW_MATERIAL', remainingTon: '1.500', lotStatus: 'AVAILABLE', producedDate: '2026-10-02' });
    const event = read((t) => t.businessEvent.find((e) => e.businessEventType === 'GOODS_RECEIPT_CONFIRMED' && e.targetId === first.goodsReceiptId));
    expect(event).toBeDefined();
    expect(read((t) => t.businessEventLot.some((l) => l.businessEventId === event?.id && l.lotId === first.lotId))).toBe(true);

    const second = await goodsReceiptApi.receive({ purchaseOrderItemId: smn.purchaseOrderItemId, receivedTon: '2', receiptDate: '2026-10-02' });
    expect(second).toMatchObject({ lotNo: 'RM-SMN01-261002-002', purchaseOrderStatus: 'RECEIVED', lineScheduledReceiptTon: '0.000' });
    const history = await goodsReceiptApi.list();
    expect(history[0]).toMatchObject({ goodsReceiptNo: second.goodsReceiptNo, purchaseOrderItemId: smn.purchaseOrderItemId, lotId: second.lotId });
    expect((await goodsReceiptApi.lines()).find((l) => l.purchaseOrderItemId === smn.purchaseOrderItemId)?.isFullyReceived).toBe(true);
  });

  it('입고 확정 권한이 없으면 COM-002, 조회 권한도 없으면 목록도 COM-002', async () => {
    actAs(SEED_EMPLOYEE_NO.purchase);
    const [line] = (await goodsReceiptApi.lines()).filter((l) => !l.isFullyReceived);
    actAs(SEED_EMPLOYEE_NO.sales);
    await expect(goodsReceiptApi.receive({ purchaseOrderItemId: line.purchaseOrderItemId, receivedTon: '1', receiptDate: '2026-10-02' })).rejects.toMatchObject({ code: 'COM-002' });
    await expect(goodsReceiptApi.lines()).rejects.toMatchObject({ code: 'COM-002' });
    actAs(SEED_EMPLOYEE_NO.admin);
    await expect(goodsReceiptApi.receive({ purchaseOrderItemId: line.purchaseOrderItemId, receivedTon: '1', receiptDate: '2026-10-02' })).rejects.toMatchObject({ code: 'COM-002' });
    expect((await goodsReceiptApi.list()).length).toBeGreaterThan(0);
  });
});
