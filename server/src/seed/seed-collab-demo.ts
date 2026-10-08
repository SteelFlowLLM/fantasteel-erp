// 구매·업무·알림 화면 시연용 거래 시드. 생산 거래 시드(seed-production-demo.ts) 다음에 `npm run seed:demo`가 이어서 실행한다.
// 화면 가짜 DB 시드(client/src/mock/seeds/core.ts 구매 이야기, collab.ts 업무)를 서버로 옮긴 것이다. 메신저 대화방은 넣지 않는다.
// 실제 서비스(구매요청·승인·반려·발주·입고, 업무 등록·완료)를 불러 만들어 번호·작업 로그·알림이 화면에서 하는 것과 같다.
// 날짜는 오늘(Asia/Seoul) 기준 상대값이다. 모든 값은 시연용 가정값이다 (docs/backend/seed.md).
import 'dotenv/config';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NOTIFICATION_TYPE, type AuthUser } from '@fantasteel/shared';
import { AppModule } from '../app.module';
import { AuthUserService } from '../common/auth/auth-user.service';
import { seoulToday } from '../common/time/seoul-date';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../modules/notification/notification.service';
import { TaskService } from '../modules/notification/task.service';
import { PurchasingService } from '../modules/purchasing/purchasing.service';

const logger = new Logger('SeedCollabDemo');
const DAY = 86_400_000;
const SEED_REASON = '시연용 시드 (구매 화면)';

/** 오늘 + n일 (YYYY-MM-DD, 서울 날짜) */
const dayOf = (days: number): string => new Date(Date.parse(`${seoulToday()}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** 업무 6건 (가짜 DB 시드 collab.ts와 같은 제목·담당자·등록자·연결 화면). 마감일은 오늘 기준 상대값 */
const TASKS: { title: string; description: string | null; assignee: string; creator: string; dueInDays: number; linkPath: string | null; done?: boolean; noticeRead?: boolean }[] = [
  { title: '10월 첫째 주 철광석 입고 일정 확인', description: '공급업체와 입고예정 일자를 확인하고 발주에 반영해 주세요.', assignee: '2207005', creator: '1702004', dueInDays: 1, linkPath: '/purchase-orders' },
  { title: '고객사 납기 협의 결과 정리', description: '이번 주 협의한 납기 변경 요청을 수주별로 정리해 주세요.', assignee: '2103003', creator: '1608002', dueInDays: -1, linkPath: '/sales-orders', noticeRead: true },
  { title: 'SM355A 열연 검사 기준 확인', description: '두께 구간별 항복·인장·연신율 값이 KS와 같은지 확인해 주세요.', assignee: '2205013', creator: '1802012', dueInDays: 0, linkPath: '/quality/standards' },
  { title: '코일 야드 적재 위치 점검', description: null, assignee: '2304015', creator: '1610014', dueInDays: -1, linkPath: '/inventories', done: true, noticeRead: true },
  { title: '신규 입사자 사원 등록', description: '10월 입사자 2명의 사원번호를 만들고 역할을 지정해 주세요.', assignee: '1503001', creator: '1503001', dueInDays: 4, linkPath: '/admin/employees' },
  { title: '출하요청 서류 양식 공유', description: null, assignee: '1610014', creator: '2103003', dueInDays: 7, linkPath: null },
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    if ((await prisma.task.count()) > 0 || (await prisma.purchaseRequisition.count({ where: { requestReason: SEED_REASON } })) > 0) {
      logger.warn('이미 업무나 이 시드의 구매요청이 있어 건너뜁니다. 처음부터 넣으려면 npm run db:reset 후 다시 실행하세요');
      return;
    }
    const users = app.get(AuthUserService);
    const cache = new Map<string, AuthUser>();
    const userOf = async (employeeNo: string): Promise<AuthUser> => {
      const cached = cache.get(employeeNo);
      if (cached) return cached;
      const employee = await prisma.employee.findUniqueOrThrow({ where: { employeeNo } });
      const user = await users.load(employee.id);
      if (!user) throw new Error(`사원 ${employeeNo}을 불러올 수 없습니다`);
      cache.set(employeeNo, user);
      return user;
    };
    await seedPurchasing(app.get(PurchasingService), prisma, await userOf('2207005'), await userOf('1702004'));
    await seedTasks(app.get(TaskService), app.get(NotificationService), prisma, userOf);
  } finally {
    await app.close();
  }
}

/**
 * 구매 화면의 상태별 예시 (정다은 요청 → 최준혁 승인·반려). 생산 시드의 원료 입고(모두 발주·입고 완료)와 겹치지 않게 만든다.
 * 승인 대기 2(승인함), 승인됨·미발주 1(발주 후보), 반려 1(다시 요청), 발주 → 부분 입고 1(입고 화면 미입고량)
 */
async function seedPurchasing(purchasing: PurchasingService, prisma: PrismaService, requester: AuthUser, head: AuthUser) {
  const itemId = async (itemCode: string) => (await prisma.item.findUniqueOrThrow({ where: { itemCode } })).id;
  const request = (itemCode: string, requestedTon: string, desiredInDays: number) =>
    itemId(itemCode).then((id) => purchasing.create(requester, { itemId: id, requestedTon, desiredReceiptDate: dayOf(desiredInDays), requestReason: SEED_REASON }));

  await request('LIM01', '120.000', 10);
  await request('COL01', '300.000', 12);
  const approved = await request('ORE01', '800.000', 9);
  await purchasing.approve(head, approved.id);
  const rejected = await request('SMN01', '50.000', 8);
  await purchasing.reject(head, rejected.id, { rejectReason: '이번 달 합금철 재고가 충분해요. 수량을 줄여 다시 요청해 주세요' });

  const ordered = await request('SMN01', '8.000', 5);
  await purchasing.approve(head, ordered.id);
  const supplierId = (await prisma.item.findUniqueOrThrow({ where: { id: ordered.itemId }, select: { defaultSupplierId: true } })).defaultSupplierId;
  if (supplierId === null) throw new Error('SMN01 기본 공급업체가 없습니다');
  const po = await purchasing.createPurchaseOrder(requester, { supplierId, items: [{ purchaseRequisitionId: ordered.id, orderedTon: ordered.requestedTon }] });
  await purchasing.confirmGoodsReceipt(requester, { purchaseOrderItemId: po.items[0].purchaseOrderItemId, receivedTon: '5.000', receivedDate: seoulToday() });
  logger.log(`구매: 승인 대기 2, 승인됨 1, 반려 1, 발주 ${po.purchaseOrderNo} 부분 입고(8t 중 5t)`);
}

/** 업무 6건과 업무 지정 알림 (등록자 ≠ 담당자면 서비스가 알림을 보낸다). 일부는 그 업무 지정 알림만 담당자가 읽은 상태로 둔다 */
async function seedTasks(tasks: TaskService, notifications: NotificationService, prisma: PrismaService, userOf: (employeeNo: string) => Promise<AuthUser>) {
  for (const seed of TASKS) {
    const assignee = await userOf(seed.assignee);
    const task = await tasks.create(await userOf(seed.creator), {
      taskTitle: seed.title,
      taskDescription: seed.description,
      assigneeId: assignee.employeeId,
      dueDate: dayOf(seed.dueInDays),
      linkPath: seed.linkPath,
    });
    if (seed.done) await tasks.complete(assignee, task.id);
    if (seed.noticeRead) {
      const notice = await prisma.notification.findFirstOrThrow({
        where: { recipientId: assignee.employeeId, notificationType: NOTIFICATION_TYPE.TASK_ASSIGNED },
        orderBy: { id: 'desc' },
        select: { id: true },
      });
      await notifications.read(assignee, notice.id);
    }
  }
  logger.log(`업무 ${TASKS.length}건 (완료 ${TASKS.filter((t) => t.done).length}건)과 업무 지정 알림`);
}

main().catch((e: unknown) => {
  logger.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exitCode = 1;
});
