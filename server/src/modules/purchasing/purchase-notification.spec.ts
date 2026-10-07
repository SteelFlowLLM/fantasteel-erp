// 구매요청 승인 요청·결과 알림을 실제 DB(fs_pur)로 확인한다 ([04] 13.4, notification.md).
// 같은 묶음의 다른 테스트 파일과 DB를 함께 쓰므로 이 파일이 만든 요청의 알림(링크의 요청 id)으로만 확인한다.
import { Test, type TestingModule } from '@nestjs/testing';
import type { AuthUser } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PurchasingService } from './purchasing.service';

let moduleRef: TestingModule;
let prisma: PrismaService;
let purchasing: PurchasingService;
/** 구매 사원 정다은 */
let purchaser: AuthUser;
/** 구매부장 최준혁 */
let purchaseHead: AuthUser;
let smnId: number;

const request = (actor: AuthUser = purchaser) =>
  prisma.$transaction((tx) => purchasing.createRequisition(tx, { itemId: smnId, requestedTon: '3', desiredReceiptDate: '2026-11-25', requestReason: '알림 확인' }, actor));

/** 이 요청으로 보낸 알림 (승인 요청은 /approvals, 결과는 /purchase-requisitions로 이동) */
const notificationsOf = (id: number) =>
  prisma.notification.findMany({ where: { linkPath: { in: [`/approvals?pr=${id}`, `/purchase-requisitions?pr=${id}`] } }, orderBy: { id: 'asc' } });

const eventIdsOf = async (id: number) => (await prisma.businessEvent.findMany({ where: { targetType: 'purchase_requisition', targetId: id }, orderBy: { id: 'asc' } })).map((e) => e.id);

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
  smnId = (await prisma.item.findUniqueOrThrow({ where: { itemCode: 'SMN01' } })).id;
}, 60_000);

afterAll(async () => {
  await moduleRef?.close();
});

describe('구매요청 알림', () => {
  it('등록하면 요청자 소속 부서장에게 승인 요청, 승인하면 요청자에게 승인 결과를 보낸다 (작업 로그 id를 남긴다)', async () => {
    const created = await request();
    await purchasing.approve(purchaseHead, created.id);

    const sent = await notificationsOf(created.id);
    expect(sent.map((n) => [n.notificationType, n.recipientId, n.notificationContent, n.linkPath])).toEqual([
      ['APPROVAL_REQUESTED', purchaseHead.employeeId, `구매요청 ${created.purchaseRequisitionNo} 승인 요청 · 정다은님`, `/approvals?pr=${created.id}`],
      ['APPROVAL_RESULT', purchaser.employeeId, `구매요청 ${created.purchaseRequisitionNo} 승인됨`, `/purchase-requisitions?pr=${created.id}`],
    ]);
    expect(sent.map((n) => n.businessEventId)).toEqual(await eventIdsOf(created.id));
  });

  it('반려하면 사유를 담아 요청자에게, 재요청하면 다시 부서장에게 보낸다', async () => {
    const created = await request();
    await purchasing.reject(purchaseHead, created.id, { rejectReason: '수량 확인 필요' });
    await purchasing.resubmit(purchaser, created.id, { requestedTon: '2.5', desiredReceiptDate: '2026-11-30', requestReason: '수량 줄임' });

    const sent = await notificationsOf(created.id);
    expect(sent.map((n) => [n.notificationType, n.recipientId, n.notificationContent])).toEqual([
      ['APPROVAL_REQUESTED', purchaseHead.employeeId, `구매요청 ${created.purchaseRequisitionNo} 승인 요청 · 정다은님`],
      ['APPROVAL_RESULT', purchaser.employeeId, `구매요청 ${created.purchaseRequisitionNo} 반려됨 · 수량 확인 필요`],
      ['APPROVAL_REQUESTED', purchaseHead.employeeId, `구매요청 ${created.purchaseRequisitionNo} 승인 요청 · 정다은님`],
    ]);
  });

  it('부서장이 직접 낸 요청은 승인 요청 알림을 자기 자신에게 보내지 않는다', async () => {
    const created = await request(purchaseHead);
    expect(await notificationsOf(created.id)).toEqual([]);
  });

  it('승인이 실패해 롤백되면 결과 알림도 남지 않는다', async () => {
    const created = await request();
    await purchasing.approve(purchaseHead, created.id);
    await expect(purchasing.approve(purchaseHead, created.id)).rejects.toMatchObject({ code: 'COM-001' });
    expect((await notificationsOf(created.id)).filter((n) => n.notificationType === 'APPROVAL_RESULT')).toHaveLength(1);
  });
});
