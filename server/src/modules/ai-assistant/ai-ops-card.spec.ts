// AI 어시스턴트 수주 등록 실행 카드(REQ-AST-005)를 실제 DB(fs_collab)로 확인한다: 이름 → id 맞추기, 권한 확인, 기존 수주 등록 service 실행.
import { Test, type TestingModule } from '@nestjs/testing';
import { ITEM_TYPE, type AuthUser } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { AppException } from '../../common/errors/app.exception';
import { seoulToday } from '../../common/time/seoul-date';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesOrderService } from '../sales-order/sales-order.service';
import { AiOpsCardService } from './ai-ops-card.service';
import type { ExecuteAiActionCardDto } from './dto/ai-assistant.dto';
import { ToolArgumentError } from './tools/assistant-tool';

let moduleRef: TestingModule;
let prisma: PrismaService;
let service: AiOpsCardService;
/** 박서영 (영업: 수주 등록 권한 있음) */
let sales: AuthUser;
/** 정다은 (구매: 수주 등록 권한 없음) */
let purchaser: AuthUser;
let customer: { id: number; customerName: string };
let product: { id: number; itemCode: string };

const plusDays = (days: number): string => new Date(Date.parse(`${seoulToday()}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof AppException) return e.code;
    throw e;
  }
  throw new Error('오류가 나지 않았습니다');
}

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  service = moduleRef.get(AiOpsCardService);
  const authUsers = moduleRef.get(AuthUserService);
  const load = async (employeeNo: string) => {
    const employee = await prisma.employee.findUniqueOrThrow({ where: { employeeNo } });
    const user = await authUsers.load(employee.id);
    if (!user) throw new Error(employeeNo);
    return user;
  };
  sales = await load('2103003');
  purchaser = await load('2207005');
  customer = await prisma.customer.findFirstOrThrow({ orderBy: { id: 'asc' }, select: { id: true, customerName: true } });
  product = await prisma.item.findFirstOrThrow({ where: { itemType: ITEM_TYPE.COIL, theoreticalWeightTon: { not: null } }, orderBy: { id: 'asc' }, select: { id: true, itemCode: true } });
}, 60_000);

afterAll(async () => {
  await moduleRef?.close();
});

describe('수주 등록 카드 (실제 DB)', () => {
  it('고객사·규격 이름을 실제 id로 맞춘다', async () => {
    const card = await service.proposeSalesOrder(sales, { customerName: customer.customerName, lines: [{ itemName: product.itemCode, orderedQty: 3, dueDate: plusDays(30) }] });
    expect(card).toMatchObject({ kind: 'SALES_ORDER', customerId: customer.id, lines: [{ itemId: product.id, orderedQty: 3, dueDate: plusDays(30) }], issues: [] });
  });

  it('수주 등록 권한이 없는 역할에는 카드를 만들지 않고, 실행도 COM-002로 막는다', async () => {
    await expect(service.proposeSalesOrder(purchaser, { lines: [] })).rejects.toThrow(ToolArgumentError);
    const dto = { kind: 'SALES_ORDER', customerId: customer.id, lines: [{ itemId: product.id, orderedQty: 3, dueDate: plusDays(30) }] } as ExecuteAiActionCardDto;
    const before = await prisma.salesOrder.count();
    expect(await codeOf(service.execute(purchaser, dto))).toBe('COM-002');
    expect(await prisma.salesOrder.count()).toBe(before);
  });

  it('실행하면 기존 수주 등록이 수주·품목을 만들고 작업 로그를 남긴다 (매수가 정수가 아니면 SO-002)', async () => {
    const dto = (orderedQty: number) => ({ kind: 'SALES_ORDER', customerId: customer.id, lines: [{ itemId: product.id, orderedQty, dueDate: plusDays(30) }] }) as ExecuteAiActionCardDto;
    expect(await codeOf(service.execute(sales, dto(1.5)))).toBe('SO-002');
    const result = await service.execute(sales, dto(2));
    expect(result.registered.type).toBe('sales_order');
    const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: result.registered.id }, include: { salesOrderItems: true } });
    expect(order).toMatchObject({ salesOrderNo: result.registered.no, customerId: customer.id, ownerEmployeeId: sales.employeeId });
    expect(order.salesOrderItems.map((i) => [i.itemId, i.orderedQty])).toEqual([[product.id, 2]]);
    const events = await prisma.businessEvent.findMany({ where: { salesOrderId: order.id } });
    expect(events.length).toBeGreaterThan(0);
    // 카드로 실행한 수주 등록의 작업 로그는 모두 AI 경유로 남는다 (REQ-AST-010)
    expect(events.every((e) => e.isAiAssisted)).toBe(true);
  });

  it('카드 밖의 같은 수주 등록은 AI 경유가 아니다 (표시가 다른 요청으로 번지지 않는다)', async () => {
    const order = await moduleRef.get(SalesOrderService).create(sales, { customerId: customer.id, items: [{ itemId: product.id, orderedQty: 1, dueDate: plusDays(30) }] });
    const events = await prisma.businessEvent.findMany({ where: { salesOrderId: order.salesOrderId } });
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.isAiAssisted)).toBe(false);
  });
});
