// @nestjs/common·websockets는 ESM 전용이라 플래그 없는 jest에서는 대체품을 쓴다 (testing/nest-common.shim.ts)
jest.mock('@nestjs/common', () => require('./testing/nest-common.shim'));
jest.mock('../../common/realtime/realtime.gateway', () => ({ employeeChannel: (id: number) => `employee:${id}`, RealtimeGateway: class {} }));

import type { AuthUser } from '@fantasteel/shared';
import type { ApproverPolicy } from './approver.policy';
import type { GoodsReceiptService } from './goods-receipt.service';
import type { PurchaseOrderService } from './purchase-order.service';
import type { PurchaseRequisitionService } from './purchase-requisition.service';
import {
  closeTestContext, createDepartment, createEmployee, createRawMaterial, createSupplier, createTestContext, kstDate, setHead, type TestContext,
} from './testing/test-context';

/**
 * 구매요청 → 부서장 승인 → 발주 → 부분 입고 → 원료 LOT (REQ-PUR-001~004, REQ-AUTH-004).
 * 전용 테스트 DB에서 실제 Prisma로 돌린다. 테스트마다 자기 부서·사원·원료를 만든다.
 */
describe('구매 모듈', () => {
  let ctx: TestContext;
  let policy: ApproverPolicy;
  let requisitions: PurchaseRequisitionService;
  let purchaseOrders: PurchaseOrderService;
  let goodsReceipts: GoodsReceiptService;

  // 조직: 본부(본부장) ─ 부(부장, 담당) ─ 파트(파트장, 파트원)
  let headOffice: { id: number };
  let division: { id: number };
  let part: { id: number };
  let officeHead: AuthUser;
  let divisionHead: AuthUser;
  let staff: AuthUser;
  let partHead: AuthUser;
  let partMember: AuthUser;
  let buyer: AuthUser;

  beforeAll(async () => {
    ctx = await createTestContext();
    ({ policy, requisitions, purchaseOrders, goodsReceipts } = ctx);

    headOffice = await createDepartment(ctx);
    division = await createDepartment(ctx, headOffice.id);
    part = await createDepartment(ctx, division.id);
    officeHead = await createEmployee(ctx, headOffice.id);
    divisionHead = await createEmployee(ctx, division.id);
    staff = await createEmployee(ctx, division.id);
    partHead = await createEmployee(ctx, part.id, 'PRODUCTION');
    partMember = await createEmployee(ctx, part.id, 'PRODUCTION');
    buyer = await createEmployee(ctx, division.id);
    await setHead(ctx, headOffice.id, officeHead.employeeId);
    await setHead(ctx, division.id, divisionHead.employeeId);
    await setHead(ctx, part.id, partHead.employeeId);
  });

  afterAll(async () => {
    await closeTestContext(ctx);
  });

  const expectCode = (promise: Promise<unknown>, code: string) => expect(promise).rejects.toMatchObject({ code });

  /** 승인까지 끝난 구매요청 1건 (품목 1개) */
  async function approvedRequisition(rawMaterialId: number, requiredTon: string) {
    const created = await requisitions.create({ items: [{ rawMaterialId, requiredTon }], desiredReceiptDate: kstDate(7), submit: true }, staff);
    return requisitions.approve(created.id, divisionHead);
  }

  describe('승인권자 결정', () => {
    it('부서원이 요청하면 소속 부서의 부서장', async () => {
      expect(await policy.resolveApprover(ctx.prisma, partMember.employeeId)).toEqual({ approverId: partHead.employeeId, departmentId: part.id });
      expect(await policy.resolveApprover(ctx.prisma, staff.employeeId)).toEqual({ approverId: divisionHead.employeeId, departmentId: division.id });
    });

    it('부서장이 직접 요청하면 상위 부서의 부서장', async () => {
      expect(await policy.resolveApprover(ctx.prisma, partHead.employeeId)).toEqual({ approverId: divisionHead.employeeId, departmentId: part.id });
    });

    it('요청자가 상위 부서의 부서장도 겸하면 그 위로 올라간다 (요청자 자신은 승인권자가 아니다)', async () => {
      const upper = await createDepartment(ctx, headOffice.id);
      const lower = await createDepartment(ctx, upper.id);
      const both = await createEmployee(ctx, lower.id);
      await setHead(ctx, upper.id, both.employeeId);
      await setHead(ctx, lower.id, both.employeeId);
      expect(await policy.resolveApprover(ctx.prisma, both.employeeId)).toEqual({ approverId: officeHead.employeeId, departmentId: lower.id });
    });

    it('부서장이 없는 부서·최상위 부서장·사용 중지된 부서장은 승인권자 없음', async () => {
      const orphan = await createDepartment(ctx, headOffice.id);
      const orphanMember = await createEmployee(ctx, orphan.id);
      expect(await policy.resolveApprover(ctx.prisma, orphanMember.employeeId)).toBeNull();
      expect(await policy.resolveApprover(ctx.prisma, officeHead.employeeId)).toBeNull();

      const retiredHead = await createEmployee(ctx, orphan.id);
      await setHead(ctx, orphan.id, retiredHead.employeeId);
      await ctx.prisma.employee.update({ where: { id: retiredHead.employeeId }, data: { employeeStatus: 'INACTIVE' } });
      expect(await policy.resolveApprover(ctx.prisma, orphanMember.employeeId)).toBeNull();
    });
  });

  describe('구매요청 등록·제출·승인', () => {
    it('submit=false면 작성 중(DRAFT), 제출하면 승인 대기 + 승인권자 지정 + 알림 + 작업 로그', async () => {
      const rm = await createRawMaterial(ctx);
      const draft = await requisitions.create({ items: [{ rawMaterialId: rm.id, requiredTon: '120.5' }], desiredReceiptDate: kstDate(10), requestReason: '시험', submit: false }, partMember);
      expect(draft.purchaseRequisitionNo).toMatch(/^PR-\d{8}-\d{4}$/);
      expect(draft.purchaseRequisitionStatus).toBe('DRAFT');
      expect(draft.approver).toBeNull();
      expect(draft.sourceType).toBe('DIRECT');
      expect(draft.items[0].requiredTon.toFixed(3)).toBe('120.500');

      const submitted = await requisitions.submit(draft.id, partMember);
      expect(submitted.purchaseRequisitionStatus).toBe('WAITING_APPROVAL');
      expect(submitted.approver?.id).toBe(partHead.employeeId);
      expect(submitted.department.id).toBe(part.id);

      const notice = await ctx.prisma.notification.findFirst({ where: { recipientId: partHead.employeeId, linkPath: `/purchase-requisitions/${draft.id}` } });
      expect(notice?.notificationType).toBe('APPROVAL_REQUEST');
      const event = await ctx.prisma.businessEvent.findFirst({ where: { targetType: 'PURCHASE_REQUISITION', targetId: draft.id, eventType: 'PURCHASE_REQUISITION_CONFIRMED' } });
      expect(event?.actorEmployeeId).toBe(partMember.employeeId);

      const mine = await requisitions.approvals(partHead);
      expect(mine.purchaseRequisitions.map((r) => r.id)).toContain(draft.id);
      expect(mine.counts.purchaseRequisition).toBe(mine.purchaseRequisitions.length);
      expect((await requisitions.approvals(partMember)).purchaseRequisitions).toHaveLength(0);
    });

    it('부서장이 직접 요청하면 상위 부서장이 승인권자이고, 자기 요청은 자기가 승인할 수 없다', async () => {
      const rm = await createRawMaterial(ctx);
      const pr = await requisitions.create({ items: [{ rawMaterialId: rm.id, requiredTon: '10' }], desiredReceiptDate: kstDate(5), submit: true }, partHead);
      expect(pr.approver?.id).toBe(divisionHead.employeeId);
      expect(pr.approver?.department.id).toBe(division.id);
      expect(pr.department.id).toBe(part.id);
      await expectCode(requisitions.approve(pr.id, partHead), 'COM-002');

      // 데이터가 잘못되어 승인권자에 요청자가 들어가 있어도 막는다
      await ctx.prisma.purchaseRequisition.update({ where: { id: pr.id }, data: { approverId: partHead.employeeId } });
      await expectCode(requisitions.approve(pr.id, partHead), 'COM-002');
      await expectCode(requisitions.reject(pr.id, '사유', partHead), 'COM-002');
      expect((await ctx.prisma.purchaseRequisition.findUniqueOrThrow({ where: { id: pr.id } })).purchaseRequisitionStatus).toBe('WAITING_APPROVAL');
    });

    it('지정된 승인권자가 아니면 부서장이어도 승인할 수 없다', async () => {
      const rm = await createRawMaterial(ctx);
      const pr = await requisitions.create({ items: [{ rawMaterialId: rm.id, requiredTon: '10' }], desiredReceiptDate: kstDate(5), submit: true }, staff);
      await expectCode(requisitions.approve(pr.id, partHead), 'COM-002');
      await expectCode(requisitions.approve(pr.id, officeHead), 'COM-002');
      const approved = await requisitions.approve(pr.id, divisionHead);
      expect(approved.purchaseRequisitionStatus).toBe('APPROVED');
      // 이미 승인된 것을 다시 승인할 수 없다
      await expectCode(requisitions.approve(pr.id, divisionHead), 'COM-005');
    });

    it('승인권자(부서장)가 없으면 제출 시 PUR-001, 구매요청은 작성 중으로 남는다', async () => {
      const orphan = await createDepartment(ctx, headOffice.id);
      const orphanMember = await createEmployee(ctx, orphan.id);
      const rm = await createRawMaterial(ctx);
      await expectCode(requisitions.create({ items: [{ rawMaterialId: rm.id, requiredTon: '1' }], desiredReceiptDate: kstDate(3), submit: true }, orphanMember), 'PUR-001');
      // 한 tx라 구매요청도 남지 않는다
      expect(await ctx.prisma.purchaseRequisition.count({ where: { requesterId: orphanMember.employeeId } })).toBe(0);

      const draft = await requisitions.create({ items: [{ rawMaterialId: rm.id, requiredTon: '1' }], desiredReceiptDate: kstDate(3) }, orphanMember);
      await expectCode(requisitions.submit(draft.id, orphanMember), 'PUR-001');
      expect((await ctx.prisma.purchaseRequisition.findUniqueOrThrow({ where: { id: draft.id } })).purchaseRequisitionStatus).toBe('DRAFT');
    });

    it('반려는 사유가 필요하고, 요청자가 고쳐서 다시 제출할 수 있다', async () => {
      const rm = await createRawMaterial(ctx);
      const pr = await requisitions.create({ items: [{ rawMaterialId: rm.id, requiredTon: '50' }], desiredReceiptDate: kstDate(5), submit: true }, staff);
      // 승인 대기 중에는 수정할 수 없다
      await expectCode(requisitions.update(pr.id, { requestReason: '수정' }, staff), 'COM-005');
      await expectCode(requisitions.reject(pr.id, '   ', divisionHead), 'COM-003');

      const rejected = await requisitions.reject(pr.id, '수량 과다', divisionHead);
      expect(rejected.purchaseRequisitionStatus).toBe('REJECTED');
      expect(rejected.rejectReason).toBe('수량 과다');
      const result = await ctx.prisma.notification.findFirst({ where: { recipientId: staff.employeeId, notificationType: 'APPROVAL_RESULT', linkPath: `/purchase-requisitions/${pr.id}` } });
      expect(result?.title).toContain('반려');

      // 요청자가 아닌 사람은 수정할 수 없다
      await expectCode(requisitions.update(pr.id, { requestReason: 'x' }, buyer), 'COM-002');
      const edited = await requisitions.update(pr.id, { items: [{ rawMaterialId: rm.id, requiredTon: '30.25' }] }, staff);
      expect(edited.items).toHaveLength(1);
      expect(edited.items[0].requiredTon.toFixed(3)).toBe('30.250');

      const resubmitted = await requisitions.submit(pr.id, staff);
      expect(resubmitted.purchaseRequisitionStatus).toBe('WAITING_APPROVAL');
      expect(resubmitted.rejectReason).toBeNull();

      const approved = await requisitions.approve(pr.id, divisionHead);
      expect(approved.purchaseRequisitionStatus).toBe('APPROVED');
      const types = (await ctx.prisma.businessEvent.findMany({ where: { targetType: 'PURCHASE_REQUISITION', targetId: pr.id }, orderBy: { id: 'asc' } })).map((e) => e.eventType);
      expect(types).toEqual(['PURCHASE_REQUISITION_CONFIRMED', 'PURCHASE_REQUISITION_REJECTED', 'PURCHASE_REQUISITION_CONFIRMED', 'PURCHASE_REQUISITION_APPROVED']);
      // 승인되면 구매 역할에게 발주하라고 알린다
      expect(await ctx.prisma.notification.count({ where: { dedupeKey: `PR_ORDER_NEEDED:${pr.id}`, recipientId: buyer.employeeId } })).toBe(1);
    });

    it('수량 0 이하·같은 원료 중복·지난 희망 입고일은 거부한다', async () => {
      const rm = await createRawMaterial(ctx);
      await expectCode(requisitions.create({ items: [{ rawMaterialId: rm.id, requiredTon: '0' }], desiredReceiptDate: kstDate(1) }, staff), 'COM-003');
      await expectCode(requisitions.create({ items: [{ rawMaterialId: rm.id, requiredTon: '1' }, { rawMaterialId: rm.id, requiredTon: '2' }], desiredReceiptDate: kstDate(1) }, staff), 'COM-003');
      await expectCode(requisitions.create({ items: [{ rawMaterialId: rm.id, requiredTon: '1' }], desiredReceiptDate: kstDate(-1) }, staff), 'COM-003');
    });
  });

  describe('발주', () => {
    it('승인 전 구매요청으로는 발주할 수 없다 (PUR-002)', async () => {
      const supplier = await createSupplier(ctx);
      const rm = await createRawMaterial(ctx, supplier.id);
      const waiting = await requisitions.create({ items: [{ rawMaterialId: rm.id, requiredTon: '10' }], desiredReceiptDate: kstDate(7), submit: true }, staff);
      const draft = await requisitions.create({ items: [{ rawMaterialId: rm.id, requiredTon: '10' }], desiredReceiptDate: kstDate(7) }, staff);
      for (const pr of [waiting, draft]) {
        await expectCode(purchaseOrders.create({ supplierId: supplier.id, dueDate: kstDate(7), items: [{ purchaseRequisitionItemId: pr.items[0].id, orderedTon: '10' }] }, buyer), 'PUR-002');
      }
      const rejected = await requisitions.reject(waiting.id, '보류', divisionHead);
      await expectCode(purchaseOrders.create({ supplierId: supplier.id, dueDate: kstDate(7), items: [{ purchaseRequisitionItemId: rejected.items[0].id, orderedTon: '10' }] }, buyer), 'PUR-002');
      expect(await ctx.prisma.purchaseOrderItem.count({ where: { rawMaterialId: rm.id } })).toBe(0);
    });

    it('공급업체 1곳에 여러 구매요청 품목을 묶고, 남은 양 안에서 나눠 발주하면 다 찼을 때 발주 완료가 된다', async () => {
      const supplier = await createSupplier(ctx);
      const rmA = await createRawMaterial(ctx, supplier.id);
      const rmB = await createRawMaterial(ctx, supplier.id);
      const prA = await approvedRequisition(rmA.id, '100');
      const prB = await approvedRequisition(rmB.id, '40.5');

      const orderable = await purchaseOrders.orderable();
      const group = orderable.find((g) => g.supplier?.id === supplier.id);
      expect(group?.items.map((i) => i.purchaseRequisitionItemId).sort()).toEqual([prA.items[0].id, prB.items[0].id].sort());
      expect(group?.totalUnorderedTon.toFixed(3)).toBe('140.500');

      const po1 = await purchaseOrders.create({
        supplierId: supplier.id, dueDate: kstDate(7),
        items: [{ purchaseRequisitionItemId: prA.items[0].id, orderedTon: '60' }, { purchaseRequisitionItemId: prB.items[0].id, orderedTon: '40.5' }],
      }, buyer);
      expect(po1.purchaseOrderNo).toMatch(/^PO-\d{8}-\d{4}$/);
      expect(po1.purchaseOrderStatus).toBe('CONFIRMED');
      expect(po1.items).toHaveLength(2);
      expect(po1.totalOutstandingTon.toFixed(3)).toBe('100.500');

      const afterA = await requisitions.detail(prA.id, staff);
      expect(afterA.purchaseRequisitionStatus).toBe('APPROVED');
      expect(afterA.items[0].orderedTon.toFixed(3)).toBe('60.000');
      expect(afterA.items[0].unorderedTon.toFixed(3)).toBe('40.000');
      expect(afterA.items[0].purchaseOrderItems.map((p) => p.purchaseOrderNo)).toEqual([po1.purchaseOrderNo]);
      expect((await requisitions.detail(prB.id, staff)).purchaseRequisitionStatus).toBe('ORDERED');

      // 남은 40t를 넘는 발주는 막는다
      await expectCode(purchaseOrders.create({ supplierId: supplier.id, dueDate: kstDate(7), items: [{ purchaseRequisitionItemId: prA.items[0].id, orderedTon: '40.001' }] }, buyer), 'COM-003');
      const po2 = await purchaseOrders.create({ supplierId: supplier.id, dueDate: kstDate(9), items: [{ purchaseRequisitionItemId: prA.items[0].id, orderedTon: '40' }] }, buyer);
      const doneA = await requisitions.detail(prA.id, staff);
      expect(doneA.purchaseRequisitionStatus).toBe('ORDERED');
      expect(doneA.items[0].purchaseOrderItems.map((p) => p.purchaseOrderNo)).toEqual([po1.purchaseOrderNo, po2.purchaseOrderNo]);
      // 전량 발주한 품목은 더 발주할 수 없다
      await expectCode(purchaseOrders.create({ supplierId: supplier.id, dueDate: kstDate(9), items: [{ purchaseRequisitionItemId: prA.items[0].id, orderedTon: '1' }] }, buyer), 'COM-003');

      const event = await ctx.prisma.businessEvent.findFirst({ where: { targetType: 'PURCHASE_ORDER', targetId: po1.id, eventType: 'PURCHASE_ORDER_CONFIRMED' } });
      expect(event?.targetNo).toBe(po1.purchaseOrderNo);
    });

    it('원료의 기본 공급업체가 아닌 곳으로는 발주할 수 없다', async () => {
      const supplier = await createSupplier(ctx);
      const other = await createSupplier(ctx);
      const rm = await createRawMaterial(ctx, supplier.id);
      const pr = await approvedRequisition(rm.id, '10');
      await expectCode(purchaseOrders.create({ supplierId: other.id, dueDate: kstDate(7), items: [{ purchaseRequisitionItemId: pr.items[0].id, orderedTon: '10' }] }, buyer), 'COM-003');
    });
  });

  describe('입고', () => {
    async function orderedItem(orderedTon: string) {
      const supplier = await createSupplier(ctx);
      const rm = await createRawMaterial(ctx, supplier.id);
      const pr = await approvedRequisition(rm.id, orderedTon);
      const po = await purchaseOrders.create({ supplierId: supplier.id, dueDate: kstDate(7), items: [{ purchaseRequisitionItemId: pr.items[0].id, orderedTon }] }, buyer);
      return { supplier, rm, po, purchaseOrderItemId: po.items[0].id };
    }
    const onHandTon = async (rawMaterialId: number) => (await ctx.prisma.inventory.findUnique({ where: { rawMaterialId } }))?.onHandTon.toFixed(3) ?? '0.000';

    it('부분 입고: 미입고량·원료 LOT·원료 재고 톤이 정확하고 전량 입고되면 입고 완료가 된다', async () => {
      const { supplier, rm, po, purchaseOrderItemId } = await orderedItem('100');
      const yymmdd = kstDate().slice(2).replace(/-/g, '');

      const draft1 = await goodsReceipts.create({ purchaseOrderItemId, receivedTon: '40.125', receiptDate: kstDate() });
      expect(draft1.goodsReceiptNo).toMatch(/^RCV-\d{8}-\d{4}$/);
      expect(draft1.goodsReceiptStatus).toBe('DRAFT');
      // 초안만으로는 재고·LOT이 바뀌지 않는다
      expect(await ctx.prisma.lot.count({ where: { rawMaterialId: rm.id } })).toBe(0);
      expect(await onHandTon(rm.id)).toBe('0.000');

      const receipt1 = await goodsReceipts.confirm(draft1.id, buyer);
      expect(receipt1.goodsReceiptStatus).toBe('CONFIRMED');
      expect(receipt1.lot?.lotNo).toBe(`RM-${rm.materialCode}-${yymmdd}-001`);
      expect(receipt1.purchaseOrderItem.receivedTon.toFixed(3)).toBe('40.125');
      expect(receipt1.purchaseOrderItem.outstandingTon.toFixed(3)).toBe('59.875');
      expect(receipt1.purchaseOrder.purchaseOrderStatus).toBe('PARTIALLY_RECEIVED');
      expect(await onHandTon(rm.id)).toBe('40.125');

      const lot1 = await ctx.prisma.lot.findUniqueOrThrow({ where: { goodsReceiptId: draft1.id } });
      expect(lot1).toMatchObject({ lotType: 'RAW_MATERIAL', rawMaterialId: rm.id, supplierId: supplier.id, lotStatus: 'IN_STOCK', yardId: rm.yardId });
      expect(lot1.initialTon?.toFixed(3)).toBe('40.125');
      expect(lot1.remainingTon?.toFixed(3)).toBe('40.125');

      // 남은 59.875t를 넘으면 초안부터 막는다
      await expectCode(goodsReceipts.create({ purchaseOrderItemId, receivedTon: '59.876', receiptDate: kstDate() }), 'PUR-003');
      await expectCode(goodsReceipts.create({ purchaseOrderItemId, receivedTon: '0', receiptDate: kstDate() }), 'COM-003');

      const draft2 = await goodsReceipts.create({ purchaseOrderItemId, receivedTon: '59.875', receiptDate: kstDate() });
      const receipt2 = await goodsReceipts.confirm(draft2.id, buyer);
      expect(receipt2.lot?.lotNo).toBe(`RM-${rm.materialCode}-${yymmdd}-002`);
      expect(receipt2.purchaseOrderItem.outstandingTon.toFixed(3)).toBe('0.000');
      expect(receipt2.purchaseOrder.purchaseOrderStatus).toBe('RECEIVED');
      expect(await onHandTon(rm.id)).toBe('100.000');

      const detail = await purchaseOrders.detail(po.id);
      expect(detail.purchaseOrderStatus).toBe('RECEIVED');
      expect(detail.items[0].goodsReceipts.map((g) => g.lot?.lotNo)).toEqual([receipt1.lot?.lotNo, receipt2.lot?.lotNo]);

      const event = await ctx.prisma.businessEvent.findFirstOrThrow({ where: { targetType: 'GOODS_RECEIPT', targetId: draft1.id, eventType: 'GOODS_RECEIPT_CONFIRMED' } });
      expect(event.lotIds).toEqual([lot1.id]);
    });

    it('초안을 여러 개 만들어 두어도 확정할 때 미입고량을 다시 확인한다 (PUR-003)', async () => {
      const { rm, purchaseOrderItemId } = await orderedItem('100');
      const a = await goodsReceipts.create({ purchaseOrderItemId, receivedTon: '60', receiptDate: kstDate() });
      const b = await goodsReceipts.create({ purchaseOrderItemId, receivedTon: '60', receiptDate: kstDate() });
      await goodsReceipts.confirm(a.id, buyer);
      await expectCode(goodsReceipts.confirm(b.id, buyer), 'PUR-003');
      expect((await ctx.prisma.goodsReceipt.findUniqueOrThrow({ where: { id: b.id } })).goodsReceiptStatus).toBe('DRAFT');
      expect(await ctx.prisma.lot.count({ where: { rawMaterialId: rm.id } })).toBe(1);
      expect(await onHandTon(rm.id)).toBe('60.000');
      expect((await ctx.prisma.purchaseOrderItem.findUniqueOrThrow({ where: { id: purchaseOrderItemId } })).receivedTon.toFixed(3)).toBe('60.000');
    });

    it('같은 입고를 두 번 확정해도 원료 LOT은 1개, 재고는 한 번만 늘어난다', async () => {
      const { rm, purchaseOrderItemId } = await orderedItem('30');
      const draft = await goodsReceipts.create({ purchaseOrderItemId, receivedTon: '12.5', receiptDate: kstDate() });
      const first = await goodsReceipts.confirm(draft.id, buyer);
      const second = await goodsReceipts.confirm(draft.id, buyer);
      expect(second.lot?.id).toBe(first.lot?.id);
      expect(await ctx.prisma.lot.count({ where: { rawMaterialId: rm.id } })).toBe(1);
      expect(await onHandTon(rm.id)).toBe('12.500');
      expect(await ctx.prisma.businessEvent.count({ where: { targetType: 'GOODS_RECEIPT', targetId: draft.id } })).toBe(1);
    });

    it('동시에 두 번 확정해도 원료 LOT은 1개다', async () => {
      const { rm, purchaseOrderItemId } = await orderedItem('30');
      const draft = await goodsReceipts.create({ purchaseOrderItemId, receivedTon: '7', receiptDate: kstDate() });
      const results = await Promise.all([goodsReceipts.confirm(draft.id, buyer), goodsReceipts.confirm(draft.id, buyer), goodsReceipts.confirm(draft.id, buyer)]);
      expect(new Set(results.map((r) => r.lot?.id)).size).toBe(1);
      expect(await ctx.prisma.lot.count({ where: { rawMaterialId: rm.id } })).toBe(1);
      expect(await onHandTon(rm.id)).toBe('7.000');
      expect((await ctx.prisma.purchaseOrderItem.findUniqueOrThrow({ where: { id: purchaseOrderItemId } })).receivedTon.toFixed(3)).toBe('7.000');
    });
  });
});
