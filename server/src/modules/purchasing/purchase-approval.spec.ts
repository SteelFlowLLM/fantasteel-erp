// 구매요청 승인·반려·재요청을 실제 DB(fs_pur)로 확인한다.
// 같은 묶음(fs_pur)의 다른 테스트 파일과 DB를 함께 쓰므로 이 파일이 만든 요청으로만 확인한다.
import { Test, type TestingModule } from '@nestjs/testing';
import { BUSINESS_EVENT_TYPE, PURCHASE_REQUISITION_STATUS, type AuthUser } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { PurchasingRepository } from './purchasing.repository';
import { PurchasingService } from './purchasing.service';

let moduleRef: TestingModule;
let prisma: PrismaService;
let purchasing: PurchasingService;
/** 구매 사원 정다은 */
let purchaser: AuthUser;
/** 구매부장 최준혁 */
let purchaseHead: AuthUser;
/** 영업부장 김도윤 — 다른 부서의 부서장 */
let salesHead: AuthUser;
let oreId: number;
let seq = 0;

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof AppException) return e.code;
    throw e;
  }
  throw new Error('오류가 나지 않았습니다');
}

const request = (actor: AuthUser = purchaser) =>
  prisma.$transaction((tx) => purchasing.createRequisition(tx, { itemId: oreId, requestedTon: '100', desiredReceiptDate: '2026-11-20', requestReason: '처음 요청' }, actor));
const eventsOf = (id: number) => prisma.businessEvent.findMany({ where: { targetType: 'purchase_requisition', targetId: id }, orderBy: { id: 'asc' } });
const RESUBMIT = { requestedTon: '80.25', desiredReceiptDate: '2026-12-05', requestReason: '수량 줄여 재요청' };

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
  salesHead = await load('1608002');
  oreId = (await prisma.item.findUniqueOrThrow({ where: { itemCode: 'ORE01' } })).id;
}, 60_000);

afterAll(async () => {
  await moduleRef?.close();
});

describe('구매요청 승인·반려 (REQ-PUR-002, REQ-AUTH-004)', () => {
  it('요청자 소속 부서장이 승인하면 APPROVED, 승인자·승인 시각과 작업 로그(전후 상태)를 남긴다', async () => {
    const { id } = await request();
    const approved = await purchasing.approve(purchaseHead, id);

    expect(approved).toEqual(expect.objectContaining({ purchaseRequisitionStatus: 'APPROVED', approverId: purchaseHead.employeeId, approverName: purchaseHead.employeeName, approvedAt: expect.any(String) }));
    expect((await eventsOf(id)).at(-1)).toEqual(
      expect.objectContaining({
        businessEventType: BUSINESS_EVENT_TYPE.PURCHASE_REQUISITION_APPROVED,
        actorEmployeeId: purchaseHead.employeeId,
        beforeData: expect.objectContaining({ purchaseRequisitionStatus: 'WAITING_APPROVAL' }),
        afterData: expect.objectContaining({ purchaseRequisitionStatus: 'APPROVED', approverId: purchaseHead.employeeId }),
      }),
    );
  });

  it('반려하면 REJECTED, 반려 사유를 요청과 작업 로그에 남긴다', async () => {
    const { id } = await request();
    const rejected = await purchasing.reject(purchaseHead, id, { rejectReason: ' 수량 과다 ' });

    expect(rejected).toEqual(expect.objectContaining({ purchaseRequisitionStatus: 'REJECTED', approverId: purchaseHead.employeeId, approvedAt: null, rejectReason: '수량 과다' }));
    expect((await eventsOf(id)).at(-1)).toEqual(expect.objectContaining({ businessEventType: BUSINESS_EVENT_TYPE.PURCHASE_REQUISITION_REJECTED, reason: '수량 과다' }));
  });

  it('반려 사유가 비어 있으면 COM-004', async () => {
    const { id } = await request();
    expect(await codeOf(purchasing.reject(purchaseHead, id, { rejectReason: '  ' }))).toBe('COM-004');
  });

  it('부서장이 아니거나 다른 부서의 부서장이면 COM-002 (권한 코드가 아니라 부서장 지정으로 판단)', async () => {
    const { id } = await request();

    expect(await codeOf(purchasing.approve(purchaser, id))).toBe('COM-002');
    expect(await codeOf(purchasing.approve(salesHead, id))).toBe('COM-002');
    expect(await codeOf(purchasing.reject(salesHead, id, { rejectReason: '사유' }))).toBe('COM-002');
  });

  it('부서장 본인 요청은 승인·반려할 수 없다 (경로 TBD, 자동 승인 금지)', async () => {
    const { id } = await request(purchaseHead);

    expect(await codeOf(purchasing.approve(purchaseHead, id))).toBe('COM-002');
    expect(await codeOf(purchasing.reject(purchaseHead, id, { rejectReason: '사유' }))).toBe('COM-002');
  });

  it('승인 대기가 아니면 COM-001 (이미 승인·반려된 요청)', async () => {
    const { id } = await request();
    await purchasing.approve(purchaseHead, id);

    expect(await codeOf(purchasing.approve(purchaseHead, id))).toBe('COM-001');
    expect(await codeOf(purchasing.reject(purchaseHead, id, { rejectReason: '사유' }))).toBe('COM-001');
  });

  it('요청자 부서에 부서장이 없으면 PUR-001', async () => {
    seq += 1;
    const base = await prisma.employee.findUniqueOrThrow({ where: { id: purchaser.employeeId } });
    const department = await prisma.department.create({ data: { departmentCode: `T-APV-${seq}`, departmentName: `승인 테스트 부서 ${seq}`, headEmployeeId: purchaseHead.employeeId } });
    const employee = await prisma.employee.create({
      data: { employeeNo: `T-APV-${seq}`, employeeName: '테스트 사원', passwordHash: base.passwordHash, departmentId: department.id, jobGradeId: base.jobGradeId, roleId: base.roleId },
    });
    const { id } = await request({ ...purchaser, employeeId: employee.id, departmentId: department.id });
    await prisma.department.update({ where: { id: department.id }, data: { headEmployeeId: null } });

    expect(await codeOf(purchasing.approve(purchaseHead, id))).toBe('PUR-001');
  });

  it('조건부 UPDATE: 상태가 이미 바뀌었으면 0건', async () => {
    const { id } = await request();
    await purchasing.approve(purchaseHead, id);
    const repository = moduleRef.get(PurchasingRepository);

    expect(await repository.updateRequisitionIfStatus(prisma, id, PURCHASE_REQUISITION_STATUS.WAITING_APPROVAL, { purchaseRequisitionStatus: 'REJECTED' })).toBe(0);
  });
});

describe('구매요청 수정·재요청 (REQ-PUR-002)', () => {
  it('요청자가 반려된 요청을 고치면 승인 대기로, 승인자·반려 사유는 비우고 이전 반려는 작업 로그 before에 남는다', async () => {
    const { id } = await request();
    await purchasing.reject(purchaseHead, id, { rejectReason: '수량 과다' });
    const resubmitted = await purchasing.resubmit(purchaser, id, RESUBMIT);

    expect(resubmitted).toEqual(
      expect.objectContaining({ purchaseRequisitionStatus: 'WAITING_APPROVAL', itemId: oreId, requestedTon: '80.250', desiredReceiptDate: '2026-12-05', requestReason: '수량 줄여 재요청', approverId: null, rejectReason: null }),
    );
    expect((await eventsOf(id)).at(-1)).toEqual(
      expect.objectContaining({
        businessEventType: BUSINESS_EVENT_TYPE.PURCHASE_REQUISITION_CREATED,
        reason: '반려 후 재요청',
        beforeData: expect.objectContaining({ purchaseRequisitionStatus: 'REJECTED', rejectReason: '수량 과다', requestedTon: '100.000' }),
        afterData: expect.objectContaining({ purchaseRequisitionStatus: 'WAITING_APPROVAL', rejectReason: null, requestedTon: '80.250' }),
      }),
    );
    await expect(purchasing.approve(purchaseHead, id)).resolves.toEqual(expect.objectContaining({ purchaseRequisitionStatus: 'APPROVED' }));
  });

  it('요청자 본인이 아니면 COM-002', async () => {
    const { id } = await request();
    await purchasing.reject(purchaseHead, id, { rejectReason: '사유' });

    expect(await codeOf(purchasing.resubmit(purchaseHead, id, RESUBMIT))).toBe('COM-002');
  });

  it('반려 상태가 아니면 COM-001', async () => {
    const { id } = await request();
    expect(await codeOf(purchasing.resubmit(purchaser, id, RESUBMIT))).toBe('COM-001');
  });

  it('고친 수량이 0 이하면 COM-004, 저장하지 않는다', async () => {
    const { id } = await request();
    await purchasing.reject(purchaseHead, id, { rejectReason: '사유' });

    expect(await codeOf(purchasing.resubmit(purchaser, id, { ...RESUBMIT, requestedTon: '0' }))).toBe('COM-004');
    expect((await prisma.purchaseRequisition.findUniqueOrThrow({ where: { id } })).purchaseRequisitionStatus).toBe('REJECTED');
  });
});
