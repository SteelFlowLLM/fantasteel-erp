// 테스트 전용: 전용 테스트 DB에 시험용 조직·원료·메시지를 만들고, 서비스들을 직접 조립한다. 운영 코드에서 쓰지 않는다.
// 스펙 맨 위에 아래 두 줄이 있어야 한다 (@nestjs/common·websockets가 ESM 전용이라 jest에서 못 읽는다):
//   jest.mock('@nestjs/common', () => require('<상대경로>/nest-common.shim'));
//   jest.mock('../../common/realtime/realtime.gateway', () => ({ employeeChannel: (id: number) => `employee:${id}`, RealtimeGateway: class {} }));
import type { AuthUser } from '@fantasteel/shared';
import { AuthUserService } from '../../../common/auth/auth-user.service';
import { NumberingService } from '../../../common/numbering/numbering.service';
import type { RealtimeGateway } from '../../../common/realtime/realtime.gateway';
import { RealtimeService } from '../../../common/realtime/realtime.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { BusinessEventRecorder } from '../../business-event/business-event.recorder';
import { StockService } from '../../inventory/stock.service';
import { ActionDraftRepository } from '../../message-action/action-draft.repository';
import { ActionDraftService } from '../../message-action/action-draft.service';
import { ActionRegistry } from '../../message-action/action-registry';
import { PurchaseRequisitionCreateDefinition } from '../../message-action/definitions/purchase-requisition-create.definition';
import { MrpRepository } from '../../mrp/mrp.repository';
import { MrpService } from '../../mrp/mrp.service';
import { NotificationSender } from '../../notification/notification.sender';
import { YieldCalculator } from '../../production/yield.calculator';
import { ApproverPolicy } from '../approver.policy';
import { GoodsReceiptRepository } from '../goods-receipt.repository';
import { GoodsReceiptService } from '../goods-receipt.service';
import { PurchaseOrderRepository } from '../purchase-order.repository';
import { PurchaseOrderService } from '../purchase-order.service';
import { PurchaseRequisitionActionHandler } from '../purchase-requisition-action.handler';
import { PurchaseRequisitionRepository } from '../purchase-requisition.repository';
import { PurchaseRequisitionService } from '../purchase-requisition.service';

export interface TestContext {
  prisma: PrismaService;
  authUsers: AuthUserService;
  policy: ApproverPolicy;
  requisitions: PurchaseRequisitionService;
  purchaseOrders: PurchaseOrderService;
  goodsReceipts: GoodsReceiptService;
  actionDrafts: ActionDraftService;
  mrp: MrpService;
  /** 이 실행에서 만든 데이터에 붙는 꼬리표 (코드·이름이 겹치지 않게) */
  tag: string;
  seq: number;
  employeeIds: number[];
  itemIds: number[];
}

const newTag = (): string => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.toUpperCase();

/** 실수로 개발용 기본 DB(fantasteel)에 시험 데이터를 넣지 않게 막는다. */
function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL ?? '';
  if (!url || /\/fantasteel(\?|$)/.test(url)) {
    throw new Error('테스트는 전용 DB로 실행하세요. 예: DATABASE_URL=postgresql://postgres:postgres@localhost:54322/fs_pur npx jest src/modules/purchasing');
  }
}

/** Nest 모듈(app.module)과 같은 의존 관계로 서비스를 직접 만든다. 실시간 발송만 서버 없는 gateway로 대신한다. */
export async function createTestContext(): Promise<TestContext> {
  assertTestDatabase();
  const prisma = new PrismaService();
  await prisma.$connect();
  const realtime = new RealtimeService({ server: undefined } as unknown as RealtimeGateway);
  const numbering = new NumberingService();
  const events = new BusinessEventRecorder(realtime);
  const notifications = new NotificationSender(realtime);
  const stock = new StockService(events, realtime);
  const policy = new ApproverPolicy();
  const requisitions = new PurchaseRequisitionService(prisma, new PurchaseRequisitionRepository(), policy, numbering, events, notifications, realtime);
  const purchaseOrders = new PurchaseOrderService(prisma, new PurchaseOrderRepository(), numbering, events, notifications, realtime);
  const goodsReceipts = new GoodsReceiptService(prisma, new GoodsReceiptRepository(), numbering, stock, events, realtime);
  const registry = new ActionRegistry([new PurchaseRequisitionCreateDefinition(new PurchaseRequisitionActionHandler(requisitions))]);
  const actionDrafts = new ActionDraftService(prisma, new ActionDraftRepository(), registry, events, notifications, realtime);
  const mrp = new MrpService(prisma, new MrpRepository(), new YieldCalculator(), numbering, events, realtime);
  return {
    prisma, authUsers: new AuthUserService(prisma), policy, requisitions, purchaseOrders, goodsReceipts, actionDrafts, mrp,
    tag: newTag(), seq: 0, employeeIds: [], itemIds: [],
  };
}

/** 시험용 사원·원료는 지우지 않고 사용 중지로 돌려 놓는다 (작업 로그·알림이 참조한다). */
export async function closeTestContext(ctx: TestContext): Promise<void> {
  // 미발주로 남은 시험 구매요청은 반려로 닫아 발주 후보·승인 대기 목록에 남지 않게 한다
  await ctx.prisma.purchaseRequisition.updateMany({
    where: { requesterId: { in: ctx.employeeIds }, purchaseRequisitionStatus: { in: ['DRAFT', 'WAITING_APPROVAL', 'APPROVED'] } },
    data: { purchaseRequisitionStatus: 'REJECTED', rejectReason: '시험 데이터 정리' },
  });
  await ctx.prisma.employee.updateMany({ where: { id: { in: ctx.employeeIds } }, data: { employeeStatus: 'INACTIVE' } });
  await ctx.prisma.item.updateMany({ where: { id: { in: ctx.itemIds } }, data: { isActive: false } });
  await ctx.prisma.$disconnect();
}

export async function createDepartment(ctx: TestContext, parentId: number | null = null) {
  const n = ++ctx.seq;
  return ctx.prisma.department.create({ data: { departmentCode: `T-${ctx.tag}-${n}`, departmentName: `시험부서 ${ctx.tag}-${n}`, parentId } });
}

export async function createEmployee(ctx: TestContext, departmentId: number, roleCode = 'PURCHASE'): Promise<AuthUser> {
  const n = ++ctx.seq;
  const role = await ctx.prisma.role.findUniqueOrThrow({ where: { roleCode } });
  const row = await ctx.prisma.employee.create({
    data: { employeeNo: `T${ctx.tag}${n}`, employeeName: `시험사원${n}`, passwordHash: '-', departmentId, roleId: role.id, jobGrade: '사원' },
  });
  ctx.employeeIds.push(row.id);
  return authOf(ctx, row.id);
}

export async function setHead(ctx: TestContext, departmentId: number, headEmployeeId: number | null): Promise<void> {
  await ctx.prisma.department.update({ where: { id: departmentId }, data: { headEmployeeId } });
}

/** 로그인한 것과 같은 인증 컨텍스트 (부서장 지정을 바꾼 뒤에는 다시 불러야 한다). */
export async function authOf(ctx: TestContext, employeeId: number): Promise<AuthUser> {
  const user = await ctx.authUsers.load(employeeId);
  if (!user) throw new Error(`사원 ${employeeId}을 불러올 수 없습니다`);
  return user;
}

export async function createSupplier(ctx: TestContext) {
  const n = ++ctx.seq;
  return ctx.prisma.supplier.create({ data: { supplierCode: `T-${ctx.tag}-${n}`, supplierName: `시험공급 ${n}` } });
}

/** 배합 원단위가 없는 시험용 원료: MRP 계산에 섞이지 않는다. */
export async function createRawMaterial(ctx: TestContext, defaultSupplierId: number | null = null) {
  const n = ++ctx.seq;
  const yard = await ctx.prisma.yard.findFirstOrThrow({ where: { yardType: 'RAW_MATERIAL' } });
  const item = await ctx.prisma.item.create({
    data: { itemCode: `T-${ctx.tag}-${n}`, itemName: `시험원료${n}`, itemType: 'RAW_MATERIAL', unitType: 'TON', defaultSupplierId },
  });
  ctx.itemIds.push(item.id);
  return ctx.prisma.rawMaterial.create({ data: { itemId: item.id, materialCode: `T${ctx.tag}${n}`, rawMaterialType: 'IRON_ORE', yardId: yard.id } });
}

/** 메신저 모듈 없이 채팅방·멤버·메시지를 직접 만든다. */
export async function createMessage(ctx: TestContext, senderId: number, memberIds: number[], content: string) {
  const room = await ctx.prisma.chatRoom.create({
    data: {
      chatRoomType: 'GROUP', chatRoomName: `시험방 ${ctx.tag}-${++ctx.seq}`, createdEmployeeId: senderId,
      members: { create: [...new Set([senderId, ...memberIds])].map((employeeId) => ({ employeeId })) },
    },
  });
  return ctx.prisma.message.create({ data: { chatRoomId: room.id, senderId, messageType: 'TEXT', content } });
}

/** N일 뒤 날짜 (Asia/Seoul) `YYYY-MM-DD` */
export function kstDate(offsetDays = 0): string {
  return new Date(Date.now() + 9 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
}
