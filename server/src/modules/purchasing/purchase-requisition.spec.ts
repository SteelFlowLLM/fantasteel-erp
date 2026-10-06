// 구매요청 등록·목록·상세를 실제 DB(fs_pur)로 확인한다.
// 같은 묶음(fs_pur)의 다른 테스트 파일과 DB를 함께 쓰므로 전체 건수 대신 이 파일이 만든 요청으로 확인한다.
import { Test, type TestingModule } from '@nestjs/testing';
import { BUSINESS_EVENT_TYPE, PURCHASE_REQUISITION_STATUS, type AuthUser } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { PurchasingService, type CreateRequisitionInput } from './purchasing.service';

let moduleRef: TestingModule;
let prisma: PrismaService;
let purchasing: PurchasingService;
/** 구매 사원 정다은 — 구매요청 등록 USE */
let purchaser: AuthUser;
/** 구매부장 최준혁 */
let purchaseHead: AuthUser;
/** 영업 사원 박서영 — 구매요청 권한 없음 (Message → ERP로 요청자가 될 수 있다) */
let salesStaff: AuthUser;
/** 영업부장 김도윤 — 구매요청 권한 없음, 영업부 부서장 */
let salesHead: AuthUser;
/** 물류 사원 권예진 — 구매요청 권한 없음, 부서장 아님 */
let logistics: AuthUser;
let oreId: number;
let coalId: number;
let slabId: number;
let seq = 0;

const DESIRED = '2026-11-20';

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof AppException) return e.code;
    throw e;
  }
  throw new Error('오류가 나지 않았습니다');
}

const input = (overrides: Partial<CreateRequisitionInput> = {}): CreateRequisitionInput => ({ itemId: oreId, requestedTon: '120.5', desiredReceiptDate: DESIRED, ...overrides });
/** Message → ERP 경로처럼 권한 검사(컨트롤러) 없이 service를 부른다 */
const createAs = (actor: AuthUser, values: Partial<CreateRequisitionInput> = {}) => prisma.$transaction((tx) => purchasing.createRequisition(tx, input(values), actor));

/** 생산계획 1건. withSalesOrder면 수주 품목에 연결한다 (테스트 DB에만 생긴다) */
async function createPlan(withSalesOrder = false): Promise<{ planId: number; salesOrderId: number | null }> {
  seq += 1;
  let salesOrderItemId: number | null = null;
  let salesOrderId: number | null = null;
  if (withSalesOrder) {
    const customer = await prisma.customer.findFirstOrThrow({ orderBy: { id: 'asc' } });
    const salesOrder = await prisma.salesOrder.create({
      data: {
        salesOrderNo: `T-SO-PUR-${seq}`,
        customerId: customer.id,
        ownerEmployeeId: salesStaff.employeeId,
        salesOrderItems: { create: [{ itemId: slabId, orderedQty: 4, dueDate: new Date('2026-12-31T00:00:00.000Z') }] },
      },
      include: { salesOrderItems: true },
    });
    salesOrderId = salesOrder.id;
    salesOrderItemId = salesOrder.salesOrderItems[0].id;
  }
  const plan = await prisma.productionPlan.create({ data: { productionPlanNo: `T-PP-PUR-${seq}`, salesOrderItemId, itemId: slabId, shortageQty: 4, heatCount: 1 } });
  return { planId: plan.id, salesOrderId };
}

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  purchasing = moduleRef.get(PurchasingService);
  const authUsers = moduleRef.get(AuthUserService);
  const load = async (employeeNo: string) => {
    const employee = await prisma.employee.findUniqueOrThrow({ where: { employeeNo } });
    const user = await authUsers.load(employee.id);
    if (!user) throw new Error(employeeNo);
    return user;
  };
  purchaser = await load('2207005');
  purchaseHead = await load('1702004');
  salesStaff = await load('2103003');
  salesHead = await load('1608002');
  logistics = await load('2304015');
  oreId = (await prisma.item.findUniqueOrThrow({ where: { itemCode: 'ORE01' } })).id;
  coalId = (await prisma.item.findUniqueOrThrow({ where: { itemCode: 'COL01' } })).id;
  slabId = (await prisma.item.findFirstOrThrow({ where: { itemType: 'SLAB' }, orderBy: { id: 'asc' } })).id;
}, 60_000);

afterAll(async () => {
  await moduleRef?.close();
});

describe('구매요청 등록 (REQ-PUR-001, BP-PUR-01)', () => {
  it('원료·톤·희망 입고일로 등록하면 바로 승인 대기, 요청자·부서는 로그인 사원에서, 톤은 소수 3자리', async () => {
    const created = await purchasing.create(purchaser, { itemId: oreId, requestedTon: '120.5', desiredReceiptDate: DESIRED, requestReason: ' 10월 MRP 부족분 ' });

    expect(created).toEqual(
      expect.objectContaining({
        purchaseRequisitionNo: expect.stringMatching(/^PR-\d{4}-\d{4}$/),
        purchaseRequisitionStatus: PURCHASE_REQUISITION_STATUS.WAITING_APPROVAL,
        itemId: oreId,
        itemCode: 'ORE01',
        requestedTon: '120.500',
        desiredReceiptDate: DESIRED,
        requesterId: purchaser.employeeId,
        requesterName: purchaser.employeeName,
        departmentId: purchaser.departmentId,
        departmentName: '구매부',
        approverId: null,
        approvedAt: null,
        requestReason: '10월 MRP 부족분',
        productionPlanId: null,
        actionDraftId: null,
        purchaseOrderNo: null,
        salesOrderId: null,
      }),
    );
  });

  it('작업 로그 PURCHASE_REQUISITION_CREATED를 같은 거래에서 남긴다', async () => {
    const created = await createAs(purchaser, { requestedTon: '30' });
    const events = await prisma.businessEvent.findMany({ where: { targetType: 'purchase_requisition', targetId: created.id } });

    expect(events).toEqual([
      expect.objectContaining({
        businessEventType: BUSINESS_EVENT_TYPE.PURCHASE_REQUISITION_CREATED,
        actorType: 'USER',
        actorEmployeeId: purchaser.employeeId,
        salesOrderId: null,
        afterData: expect.objectContaining({ purchaseRequisitionNo: created.purchaseRequisitionNo, requestedTon: '30.000', purchaseRequisitionStatus: 'WAITING_APPROVAL' }),
      }),
    ]);
  });

  it('요청자 부서에 부서장이 없으면 PUR-001, 저장하지 않는다', async () => {
    seq += 1;
    const department = await prisma.department.create({ data: { departmentCode: `T-NOHEAD-${seq}`, departmentName: `부서장 없는 부서 ${seq}` } });
    const before = await prisma.purchaseRequisition.count();

    expect(await codeOf(createAs({ ...purchaser, departmentId: department.id }))).toBe('PUR-001');
    expect(await prisma.purchaseRequisition.count()).toBe(before);
  });

  it('원료가 아닌 품목은 COM-004, 없는 품목은 COM-003', async () => {
    expect(await codeOf(createAs(purchaser, { itemId: slabId }))).toBe('COM-004');
    expect(await codeOf(createAs(purchaser, { itemId: 999_999 }))).toBe('COM-003');
  });

  it.each(['0', '0.000', '-1', '1.2345', 'abc', '', '1234567890'])('수량(톤) %p는 COM-004', async (requestedTon) => {
    expect(await codeOf(createAs(purchaser, { requestedTon }))).toBe('COM-004');
  });

  it('없는 희망 입고일은 COM-004', async () => {
    expect(await codeOf(createAs(purchaser, { desiredReceiptDate: '2026-02-30' }))).toBe('COM-004');
  });

  it('근거 계획이 수주에 연결돼 있으면 상세·작업 로그에 수주가 보인다', async () => {
    const { planId, salesOrderId } = await createPlan(true);
    const created = await createAs(purchaser, { productionPlanId: planId });

    expect(created).toEqual(expect.objectContaining({ productionPlanId: planId, productionPlanNo: `T-PP-PUR-${seq}`, salesOrderId, salesOrderNo: `T-SO-PUR-${seq}` }));
    const event = await prisma.businessEvent.findFirstOrThrow({ where: { targetType: 'purchase_requisition', targetId: created.id } });
    expect(event.salesOrderId).toBe(salesOrderId);
  });

  it('없는 생산계획은 COM-003', async () => {
    expect(await codeOf(createAs(purchaser, { productionPlanId: 999_999 }))).toBe('COM-003');
  });

  it('같은 계획·원료로 진행 중인 요청이 있으면 COM-004, 다른 원료나 반려된 요청은 막지 않는다', async () => {
    const { planId } = await createPlan();
    const first = await createAs(purchaser, { productionPlanId: planId });

    expect(await codeOf(createAs(purchaser, { productionPlanId: planId }))).toBe('COM-004');
    await expect(createAs(purchaser, { productionPlanId: planId, itemId: coalId })).resolves.toEqual(expect.objectContaining({ itemId: coalId }));

    await prisma.purchaseRequisition.update({ where: { id: first.id }, data: { purchaseRequisitionStatus: PURCHASE_REQUISITION_STATUS.REJECTED } });
    await expect(createAs(purchaser, { productionPlanId: planId })).resolves.toEqual(expect.objectContaining({ purchaseRequisitionStatus: 'WAITING_APPROVAL' }));
  });

  it('Message → ERP 초안에서 만들면 초안·메시지를 구매요청과 작업 로그에 연결한다', async () => {
    const draft = await prisma.actionDraft.create({ data: { actionType: 'PURCHASE_REQUISITION_CREATE', payload: {}, requesterId: purchaser.employeeId } });
    const created = await prisma.$transaction((tx) => purchasing.createRequisition(tx, input(), purchaser, { actionDraftId: draft.id, messageId: null }));

    expect(created.actionDraftId).toBe(draft.id);
    const event = await prisma.businessEvent.findFirstOrThrow({ where: { targetType: 'purchase_requisition', targetId: created.id } });
    expect(event.actionDraftId).toBe(draft.id);
  });
});

describe('구매요청 목록·상세 조회 범위 (REQ-PUR-001·002, REQ-AUTH-004)', () => {
  let purchaseRequisitionId: number;
  let salesRequisitionId: number;

  beforeAll(async () => {
    purchaseRequisitionId = (await createAs(purchaser)).id;
    salesRequisitionId = (await createAs(salesStaff)).id;
  });

  it('권한(VIEW)이 있으면 모든 부서의 요청이 보인다', async () => {
    const ids = (await purchasing.listRequisitions(purchaser, { size: 100 })).items.map((r) => r.id);

    expect(ids).toEqual(expect.arrayContaining([purchaseRequisitionId, salesRequisitionId]));
  });

  it('권한 없는 부서장은 자기 부서원의 요청만 본다', async () => {
    const result = await purchasing.listRequisitions(salesHead, { size: 100 });

    expect(result.items.map((r) => r.id)).toContain(salesRequisitionId);
    expect(result.items.every((r) => r.departmentId === salesHead.departmentId)).toBe(true);
    expect(result.total).toBe(result.items.length);
  });

  it('권한도 없고 부서장도 아니면 COM-002', async () => {
    expect(await codeOf(purchasing.listRequisitions(logistics, {}))).toBe('COM-002');
    expect(await codeOf(purchasing.requisitionDetail(logistics, purchaseRequisitionId))).toBe('COM-002');
  });

  it('상세는 권한(VIEW) 또는 그 요청의 승인권자만', async () => {
    await expect(purchasing.requisitionDetail(purchaseHead, salesRequisitionId)).resolves.toEqual(expect.objectContaining({ id: salesRequisitionId }));
    await expect(purchasing.requisitionDetail(salesHead, salesRequisitionId)).resolves.toEqual(expect.objectContaining({ departmentName: '영업부' }));
    expect(await codeOf(purchasing.requisitionDetail(salesHead, purchaseRequisitionId))).toBe('COM-002');
  });

  it('없는 구매요청은 COM-003', async () => {
    expect(await codeOf(purchasing.requisitionDetail(purchaser, 999_999))).toBe('COM-003');
  });

  it('approvable이면 권한과 상관없이 내가 승인할 요청만: 내 부서원의 승인 대기, 내 요청 제외', async () => {
    const ownId = (await createAs(purchaseHead)).id;
    const approvedId = (await createAs(purchaser)).id;
    await prisma.purchaseRequisition.update({ where: { id: approvedId }, data: { purchaseRequisitionStatus: PURCHASE_REQUISITION_STATUS.APPROVED } });

    const ids = (await purchasing.listRequisitions(purchaseHead, { approvable: true, size: 100 })).items.map((r) => r.id);
    expect(ids).toContain(purchaseRequisitionId);
    expect(ids).not.toContain(salesRequisitionId);
    expect(ids).not.toContain(ownId);
    expect(ids).not.toContain(approvedId);
    expect((await purchasing.listRequisitions(salesHead, { approvable: true, size: 100 })).items.map((r) => r.id)).toContain(salesRequisitionId);
    expect(await codeOf(purchasing.listRequisitions(purchaser, { approvable: true }))).toBe('COM-002');
  });

  it('상태로 거르고 최신 요청이 먼저 온다', async () => {
    await prisma.purchaseRequisition.update({ where: { id: purchaseRequisitionId }, data: { purchaseRequisitionStatus: PURCHASE_REQUISITION_STATUS.APPROVED } });
    const approved = await purchasing.listRequisitions(purchaser, { purchaseRequisitionStatus: 'APPROVED', size: 100 });
    const all = await purchasing.listRequisitions(purchaser, { size: 100 });

    expect(approved.items.map((r) => r.id)).toContain(purchaseRequisitionId);
    expect(approved.items.every((r) => r.purchaseRequisitionStatus === 'APPROVED')).toBe(true);
    const ids = all.items.map((r) => r.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
  });
});
