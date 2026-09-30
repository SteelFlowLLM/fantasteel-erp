// @nestjs/common·websockets는 ESM 전용이라 플래그 없는 jest에서는 대체품을 쓴다 (inventory/testing/nest-common.shim.ts)
jest.mock('@nestjs/common', () => require('../inventory/testing/nest-common.shim'));
jest.mock('../../common/realtime/realtime.gateway', () => ({ employeeChannel: (id: number) => `employee:${id}`, RealtimeGateway: class {} }));

import { calcWeightTon } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { createTestContext, errorCodeOf, uniq, type TestContext } from '../inventory/testing/test-context';
import { daysUntil, percent, qtyTon, tonText } from './sales-order.view';

jest.setTimeout(120_000);

describe('수주 (REQ-SO-001~006, REQ-INV-009)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });

  describe('계산 (DB 없이)', () => {
    it('23.550t 규격 10매 = 235.500t (톤은 매수 × 1매 이론중량)', () => {
      expect(tonText(qtyTon(10, new Prisma.Decimal('23.550')))).toBe('235.500');
      expect(calcWeightTon(10, '23.550')).toBe('235.500');
    });
    it('진행률은 소수 1자리로 버리고 100을 넘지 않는다', () => {
      expect(percent(6, 10)).toBe(60);
      expect(percent(1, 3)).toBe(33.3);
      expect(percent(2999, 3000)).toBe(99.9);
      expect(percent(12, 10)).toBe(100);
      expect(percent(0, 0)).toBe(0);
    });
    it('납기까지 남은 일수는 Asia/Seoul 날짜 기준', () => {
      const now = new Date('2026-09-30T16:00:00.000Z'); // 서울은 이미 10월 1일
      expect(daysUntil(new Date('2026-10-04T00:00:00.000Z'), now)).toBe(3);
      expect(daysUntil(new Date('2026-09-30T00:00:00.000Z'), now)).toBe(-1);
    });
  });

  describe('수량·규격 검증', () => {
    it.each([[10.5], [0], [-1], [undefined], [null], ['10'], [Number.NaN]])('수량 %p 은 SO-002로 거부하고 아무것도 만들지 않는다', async (orderedQty) => {
      const customer = await ctx.createCustomer();
      const spec = await ctx.createSpec('SLAB');
      const code = await errorCodeOf(ctx.salesOrders.create({ customerId: customer.id, dueDate: ctx.dueIn(10), items: [{ productSpecId: spec.id, orderedQty }] }, ctx.users.sales));
      expect(code).toBe('SO-002');
      expect(await ctx.prisma.salesOrder.count({ where: { customerId: customer.id } })).toBe(0);
    });

    it('여러 품목 중 하나라도 소수면 수주 전체를 거부한다 (반올림하지 않는다)', async () => {
      const customer = await ctx.createCustomer();
      const spec = await ctx.createSpec('SLAB');
      const dto = { customerId: customer.id, dueDate: ctx.dueIn(10), items: [{ productSpecId: spec.id, orderedQty: 3 }, { productSpecId: spec.id, orderedQty: 2.0001 }] };
      expect(await errorCodeOf(ctx.salesOrders.create(dto, ctx.users.sales))).toBe('SO-002');
      expect(await ctx.prisma.salesOrder.count({ where: { customerId: customer.id } })).toBe(0);
    });

    it('등록되지 않은 규격·사용 중지 규격은 SO-001', async () => {
      const customer = await ctx.createCustomer();
      const dto = (productSpecId: unknown) => ({ customerId: customer.id, dueDate: ctx.dueIn(10), items: [{ productSpecId, orderedQty: 1 }] });
      expect(await errorCodeOf(ctx.salesOrders.create(dto(987_654_321), ctx.users.sales))).toBe('SO-001');
      expect(await errorCodeOf(ctx.salesOrders.create(dto(undefined), ctx.users.sales))).toBe('SO-001');
      const inactive = await ctx.createSpec('SLAB');
      await ctx.prisma.productSpec.update({ where: { id: inactive.id }, data: { isActive: false } });
      expect(await errorCodeOf(ctx.salesOrders.create(dto(inactive.id), ctx.users.sales))).toBe('SO-001');
    });
  });

  describe('재고 우선 예약·부족분 생산계획 (BP-SO-01)', () => {
    it('합격 재고 6매 + 수주 10매 → ACTIVE 예약 6매, 부족 4매 생산계획, 톤은 계산값', async () => {
      const customer = await ctx.createCustomer();
      const spec = await ctx.createSpec('SLAB');
      await ctx.createStock(spec, 6);

      const order = await ctx.orderOne(customer.id, spec.id, 10);
      const item = order.items[0];
      expect(order.salesOrderNo).toMatch(/^SO-\d{8}-\d{4}$/);
      expect(item.orderedQty).toBe(10);
      expect(item.orderedTon).toBe(calcWeightTon(10, spec.theoreticalWeightTon.toFixed(3)));
      expect(item.reservedQty).toBe(6);
      expect(item.unsecuredQty).toBe(4);
      expect(item.inProductionQty).toBe(4);
      expect(item.additionalPlanNeededQty).toBe(0);
      expect(item.progressRate).toBe(60);
      expect(item.salesOrderItemStatus).toBe('IN_PROGRESS');
      expect(order.salesOrderStatus).toBe('IN_PROGRESS');

      const reservations = await ctx.prisma.reservation.findMany({ where: { salesOrderItemId: item.id } });
      expect(reservations.map((r) => [r.status, r.reservedQty, r.isAutoReserved])).toEqual([['ACTIVE', 6, false]]);
      const plans = await ctx.prisma.productionPlan.findMany({ where: { salesOrderItemId: item.id } });
      expect(plans.map((p) => [p.shortageQty, p.productionPlanStatus, p.productSpecId])).toEqual([[4, 'PLANNED', spec.id]]);
      const pool = await ctx.pool(spec.id);
      expect([pool.onHandQty, pool.reservedQty]).toEqual([6, 6]);

      const events = await ctx.prisma.businessEvent.findMany({ where: { salesOrderId: order.id }, orderBy: { id: 'asc' } });
      expect(events.map((e) => e.eventType)).toEqual(['SALES_ORDER_REGISTERED', 'RESERVATION_CREATED', 'PRODUCTION_PLAN_CREATED']);
      expect(events.every((e) => e.actorType === 'USER' && e.actorEmployeeId === ctx.users.sales.employeeId)).toBe(true);
    });

    it('재고가 충분하면 전량 예약하고 생산계획을 만들지 않는다', async () => {
      const customer = await ctx.createCustomer();
      const spec = await ctx.createSpec('SLAB');
      await ctx.createStock(spec, 6);
      const order = await ctx.orderOne(customer.id, spec.id, 4);
      expect(order.items[0].reservedQty).toBe(4);
      expect(order.items[0].salesOrderItemStatus).toBe('REGISTERED');
      expect(await ctx.prisma.productionPlan.count({ where: { salesOrderItemId: order.items[0].id } })).toBe(0);
    });

    it('미합격 히트의 하위 슬래브·불합격 슬래브는 예약하지 않는다 (REQ-INV-003·007)', async () => {
      const customer = await ctx.createCustomer();
      const spec = await ctx.createSpec('SLAB');
      await ctx.createStock(spec, 3, { heatPassed: false });
      await ctx.createStock(spec, 2, { lotPassed: false });
      await ctx.createStock(spec, 2, { heatPassed: null });
      const order = await ctx.orderOne(customer.id, spec.id, 5);
      expect(order.items[0].reservedQty).toBe(0);
      expect((await ctx.prisma.productionPlan.findFirstOrThrow({ where: { salesOrderItemId: order.items[0].id } })).shortageQty).toBe(5);
    });

    it('코일·슬래브 혼합 수주: 품목마다 따로 예약하고 부족한 품목만 계획한다', async () => {
      const customer = await ctx.createCustomer();
      const { slabSpec, coilSpec } = await ctx.createMappedSpecs();
      await ctx.createStock(slabSpec, 3);
      await ctx.createStock(coilSpec, 2, { lotType: 'COIL' });
      const order = await ctx.salesOrders.create(
        { customerId: customer.id, dueDate: ctx.dueIn(20), note: '혼합', items: [{ productSpecId: coilSpec.id, orderedQty: 5 }, { productSpecId: slabSpec.id, orderedQty: 3 }] },
        ctx.users.sales,
      );
      expect(order.items.map((i) => [i.lineNo, i.itemType, i.qtyUnit, i.reservedQty, i.unsecuredQty])).toEqual([[1, 'COIL', '개', 2, 3], [2, 'SLAB', '매', 3, 0]]);
      const plans = await ctx.prisma.productionPlan.findMany({ where: { salesOrderItem: { salesOrderId: order.id } } });
      expect(plans.map((p) => [p.productSpecId, p.shortageQty])).toEqual([[coilSpec.id, 3]]);
    });

    it('수주 업무방을 만들고 담당자와 생산·품질·물류·구매 부서장을 넣는다', async () => {
      const customer = await ctx.createCustomer();
      const spec = await ctx.createSpec('SLAB');
      const order = await ctx.orderOne(customer.id, spec.id, 1);
      const room = await ctx.prisma.chatRoom.findFirstOrThrow({ where: { salesOrderId: order.id }, include: { members: true } });
      expect([room.chatRoomType, room.chatRoomName, room.id]).toEqual(['WORK', `#${order.salesOrderNo}`, order.workRoomId]);
      const heads = await ctx.prisma.department.findMany({ where: { departmentCode: { in: ['PRODUCTION', 'QUALITY', 'LOGISTICS', 'PURCHASE'] } } });
      const expected = new Set([ctx.users.sales.employeeId, ...heads.map((d) => d.headEmployeeId!)]);
      expect(new Set(room.members.map((m) => m.employeeId))).toEqual(expected);
    });
  });

  describe('동시성 (REQ-INV-009)', () => {
    it('같은 규격을 동시에 주문해도 ACTIVE 예약 합계가 가용 재고를 넘지 않는다', async () => {
      const customer = await ctx.createCustomer();
      const spec = await ctx.createSpec('SLAB');
      await ctx.createStock(spec, 6);

      const orders = await Promise.all([1, 2, 3, 4].map(() => ctx.orderOne(customer.id, spec.id, 4)));
      expect(new Set(orders.map((o) => o.salesOrderNo)).size).toBe(4);

      const itemIds = orders.map((o) => o.items[0].id);
      const active = await ctx.prisma.reservation.aggregate({ where: { salesOrderItemId: { in: itemIds }, status: 'ACTIVE' }, _sum: { reservedQty: true } });
      expect(active._sum.reservedQty).toBe(6);
      const pool = await ctx.pool(spec.id);
      expect([pool.onHandQty, pool.reservedQty]).toEqual([6, 6]);
      // 예약하지 못한 매수는 빠짐없이 생산계획으로 넘어간다: 16 − 6 = 10
      const plans = await ctx.prisma.productionPlan.aggregate({ where: { salesOrderItemId: { in: itemIds } }, _sum: { shortageQty: true } });
      expect(plans._sum.shortageQty).toBe(10);
      for (const o of orders) expect(o.items[0].reservedQty + o.items[0].unsecuredQty).toBe(4);
    });
  });

  describe('요청 고유키 (Idempotency-Key)', () => {
    it('같은 키로 다시 등록하면 처음 결과를 돌려주고 수주를 또 만들지 않는다', async () => {
      const customer = await ctx.createCustomer();
      const spec = await ctx.createSpec('SLAB');
      await ctx.createStock(spec, 6);
      const dto = { customerId: customer.id, dueDate: ctx.dueIn(10), items: [{ productSpecId: spec.id, orderedQty: 4 }] };
      const key = `test-${uniq()}`;
      const first = await ctx.salesOrders.create(dto, ctx.users.sales, key);
      const second = await ctx.salesOrders.create(dto, ctx.users.sales, key);
      expect(second).toEqual(first);
      expect(await ctx.prisma.salesOrder.count({ where: { customerId: customer.id } })).toBe(1);
      expect((await ctx.pool(spec.id)).reservedQty).toBe(4);
    });

    it('같은 키의 요청이 동시에 들어와도 한 건만 등록한다', async () => {
      const customer = await ctx.createCustomer();
      const spec = await ctx.createSpec('SLAB');
      await ctx.createStock(spec, 6);
      const dto = { customerId: customer.id, dueDate: ctx.dueIn(10), items: [{ productSpecId: spec.id, orderedQty: 2 }] };
      const key = `test-${uniq()}`;
      const results = await Promise.all([1, 2, 3].map(() => ctx.salesOrders.create(dto, ctx.users.sales, key)));
      expect(new Set(results.map((r) => r.salesOrderNo)).size).toBe(1);
      expect(await ctx.prisma.salesOrder.count({ where: { customerId: customer.id } })).toBe(1);
      expect((await ctx.pool(spec.id)).reservedQty).toBe(2);
    });

    it('실패한 요청은 키를 남기지 않아 고쳐서 다시 보낼 수 있다', async () => {
      const customer = await ctx.createCustomer();
      const spec = await ctx.createSpec('SLAB');
      const key = `test-${uniq()}`;
      const bad = { customerId: customer.id, dueDate: ctx.dueIn(10), items: [{ productSpecId: 987_654_321, orderedQty: 2 }] };
      expect(await errorCodeOf(ctx.salesOrders.create(bad, ctx.users.sales, key))).toBe('SO-001');
      const ok = await ctx.salesOrders.create({ ...bad, items: [{ productSpecId: spec.id, orderedQty: 2 }] }, ctx.users.sales, key);
      expect(ok.items[0].orderedQty).toBe(2);
    });
  });

  describe('충족 현황·목록 (REQ-SO-004·005)', () => {
    it('예약·검사합격·생산중·출하를 더해도 주문 매수를 넘지 않는다', async () => {
      const customer = await ctx.createCustomer();
      const spec = await ctx.createSpec('SLAB');
      await ctx.createStock(spec, 6);
      const order = await ctx.orderOne(customer.id, spec.id, 10);
      const itemId = order.items[0].id;
      const plan = await ctx.prisma.productionPlan.findFirstOrThrow({ where: { salesOrderItemId: itemId } });

      // 부족분 생산분 2매가 검사에 합격 → 원래 수주 품목에 자동 예약 (품질 모듈이 부르는 StockService.onLotJudged)
      const produced = await ctx.createStock(spec, 2, { lotPassed: null });
      await ctx.prisma.lot.updateMany({ where: { id: { in: produced.lotIds } }, data: { productionPlanId: plan.id, salesOrderItemId: itemId, isPassed: true } });
      await ctx.prisma.tx(async (tx) => {
        for (const lotId of produced.lotIds) await ctx.stock.onLotJudged(tx, lotId);
      });

      const f = await ctx.salesOrders.fulfillment(order.id);
      const item = f.items[0];
      expect([item.reservedQty, item.passedQty, item.inProductionQty, item.shippedQty]).toEqual([6, 2, 2, 0]);
      expect([item.unsecuredQty, item.additionalPlanNeededQty, item.progressRate]).toEqual([2, 0, 80]);
      expect(item.reservedQty + item.passedQty + item.inProductionQty + item.shippedQty).toBeLessThanOrEqual(item.orderedQty);
      expect(item.productionPlans.map((p) => [p.shortageQty, p.remainingTargetQty])).toEqual([[4, 2]]);
      expect(item.lots.map((l) => l.lotNo)).toEqual(produced.lotNos);
      expect(f.workRoomId).not.toBeNull();

      const reservations = await ctx.salesOrders.reservations(order.id);
      expect(reservations.map((r) => [r.status, r.reservedQty, r.isAutoReserved])).toEqual([['ACTIVE', 6, false], ['ACTIVE', 1, true], ['ACTIVE', 1, true]]);
    });

    it('계획이 끝났는데도 부족하면 추가 계획 필요 매수로 보여 준다', async () => {
      const customer = await ctx.createCustomer();
      const spec = await ctx.createSpec('SLAB');
      const order = await ctx.orderOne(customer.id, spec.id, 3);
      await ctx.prisma.productionPlan.updateMany({ where: { salesOrderItemId: order.items[0].id }, data: { productionPlanStatus: 'COMPLETED' } });
      const item = (await ctx.salesOrders.fulfillment(order.id)).items[0];
      expect([item.unsecuredQty, item.inProductionQty, item.additionalPlanNeededQty]).toEqual([3, 0, 3]);
    });

    it('목록: 계산한 헤더 상태·납기 위험으로 거른다', async () => {
      const customer = await ctx.createCustomer();
      const spec = await ctx.createSpec('SLAB');
      await ctx.createStock(spec, 2);
      const riskDays = (await ctx.prisma.productionSetting.findFirstOrThrow()).deliveryRiskDays;
      const urgent = await ctx.salesOrders.create({ customerId: customer.id, dueDate: ctx.dueIn(riskDays), items: [{ productSpecId: spec.id, orderedQty: 2 }] }, ctx.users.sales);
      const relaxed = await ctx.salesOrders.create({ customerId: customer.id, dueDate: ctx.dueIn(riskDays + 20), items: [{ productSpecId: spec.id, orderedQty: 2 }] }, ctx.users.sales);

      const all = await ctx.salesOrders.list({ customerId: customer.id });
      expect(all.total).toBe(2);
      expect(all.rows.map((r) => r.id)).toEqual([relaxed.id, urgent.id]);
      const risky = await ctx.salesOrders.list({ customerId: customer.id, deliveryRiskOnly: true });
      expect(risky.rows.map((r) => [r.id, r.isDeliveryRisk])).toEqual([[urgent.id, true]]);
      expect((await ctx.salesOrders.list({ customerId: customer.id, status: 'REGISTERED' })).rows.map((r) => r.id)).toEqual([urgent.id]);
      expect((await ctx.salesOrders.list({ customerId: customer.id, status: 'IN_PROGRESS' })).rows.map((r) => r.id)).toEqual([relaxed.id]);
      expect((await ctx.salesOrders.list({ keyword: urgent.salesOrderNo })).rows.map((r) => r.id)).toEqual([urgent.id]);
      expect((await ctx.salesOrders.list({ customerId: customer.id, itemType: 'COIL' })).total).toBe(0);
    });
  });

  describe('수주 취소 (BP-SO-02, REQ-SO-006)', () => {
    it('ACTIVE 예약을 해제하고 시작 전 생산계획을 취소한다', async () => {
      const customer = await ctx.createCustomer();
      const spec = await ctx.createSpec('SLAB');
      await ctx.createStock(spec, 6);
      const order = await ctx.orderOne(customer.id, spec.id, 10);

      const cancelled = await ctx.salesOrders.cancel(order.id, { reason: '고객 요청' }, ctx.users.sales);
      expect([cancelled.isCancelled, cancelled.salesOrderStatus, cancelled.cancelReason]).toEqual([true, 'CANCELLED', '고객 요청']);
      expect(cancelled.items.map((i) => [i.salesOrderItemStatus, i.reservedQty, i.cancelledQty])).toEqual([['CANCELLED', 0, 10]]);

      const reservations = await ctx.prisma.reservation.findMany({ where: { salesOrderItemId: order.items[0].id } });
      expect(reservations.map((r) => [r.status, r.reservedQty])).toEqual([['RELEASED', 6]]);
      const pool = await ctx.pool(spec.id);
      expect([pool.onHandQty, pool.reservedQty]).toEqual([6, 0]);
      const plan = await ctx.prisma.productionPlan.findFirstOrThrow({ where: { salesOrderItemId: order.items[0].id } });
      expect(plan.productionPlanStatus).toBe('CANCELLED');

      const types = (await ctx.prisma.businessEvent.findMany({ where: { salesOrderId: order.id }, orderBy: { id: 'asc' } })).map((e) => e.eventType);
      expect(types).toEqual(expect.arrayContaining(['RESERVATION_RELEASED', 'PRODUCTION_PLAN_CANCELLED', 'SALES_ORDER_CANCELLED']));
      expect(await errorCodeOf(ctx.salesOrders.cancel(order.id, {}, ctx.users.sales))).toBe('COM-005');

      // 해제된 재고는 다음 수주가 다시 예약할 수 있다
      const next = await ctx.orderOne(customer.id, spec.id, 6);
      expect(next.items[0].reservedQty).toBe(6);
    });

    it('미출고 출하요청과 확정 배정도 함께 해제한다', async () => {
      const customer = await ctx.createCustomer();
      const spec = await ctx.createSpec('SLAB');
      const stock = await ctx.createStock(spec, 4);
      const order = await ctx.orderOne(customer.id, spec.id, 4);
      const { request } = await ctx.requestAndAllocate(customer.id, order.items[0].id, 3);

      await ctx.salesOrders.cancel(order.id, {}, ctx.users.sales);
      const after = await ctx.shipmentRequests.detail(request.id);
      expect(after.shipmentRequestStatus).toBe('CANCELLED');
      const allocations = await ctx.prisma.allocation.findMany({ where: { lotId: { in: stock.lotIds } } });
      expect(allocations.map((a) => a.status)).toEqual(['RELEASED', 'RELEASED', 'RELEASED']);
      expect(await ctx.prisma.lot.count({ where: { id: { in: stock.lotIds }, lotStatus: 'IN_STOCK' } })).toBe(4);
      const pool = await ctx.pool(spec.id);
      expect([pool.onHandQty, pool.reservedQty]).toEqual([4, 0]);
    });

    it('부분 출하 뒤 취소: 출고 이력은 남기고 잔량만 취소한다', async () => {
      const customer = await ctx.createCustomer();
      const spec = await ctx.createSpec('SLAB');
      await ctx.createStock(spec, 6);
      const order = await ctx.orderOne(customer.id, spec.id, 6);
      const itemId = order.items[0].id;
      const { request } = await ctx.requestAndAllocate(customer.id, itemId, 2);
      await ctx.goodsIssues.confirm(request.id, ctx.users.logistics);

      const cancelled = await ctx.salesOrders.cancel(order.id, { reason: '잔량 취소' }, ctx.users.sales);
      const item = cancelled.items[0];
      expect([item.salesOrderItemStatus, item.orderedQty, item.shippedQty, item.cancelledQty]).toEqual(['CANCELLED', 6, 2, 4]);
      expect(cancelled.shippedQty).toBe(2);
      const reservations = await ctx.prisma.reservation.findMany({ where: { salesOrderItemId: itemId }, orderBy: { id: 'asc' } });
      expect(reservations.map((r) => [r.status, r.reservedQty]).sort()).toEqual([['CONVERTED', 2], ['RELEASED', 4]]);
      const pool = await ctx.pool(spec.id);
      expect([pool.onHandQty, pool.reservedQty]).toEqual([4, 0]);
      expect(await ctx.prisma.millSheet.count({ where: { salesOrderId: order.id } })).toBe(1);
      expect(await ctx.prisma.goodsIssueItem.count({ where: { shipmentRequestItem: { salesOrderItemId: itemId } } })).toBe(2);
    });

    it('전량 출하된 수주는 취소할 수 없다', async () => {
      const customer = await ctx.createCustomer();
      const spec = await ctx.createSpec('SLAB');
      await ctx.createStock(spec, 2);
      const order = await ctx.orderOne(customer.id, spec.id, 2);
      const { request } = await ctx.requestAndAllocate(customer.id, order.items[0].id, 2);
      await ctx.goodsIssues.confirm(request.id, ctx.users.logistics);
      expect(await errorCodeOf(ctx.salesOrders.cancel(order.id, {}, ctx.users.sales))).toBe('COM-005');
    });

    it('코일 수주 취소: 열연 배정을 해제하고 귀속 슬래브를 여재(재고 풀)로 돌린다', async () => {
      const customer = await ctx.createCustomer();
      const { slabSpec, coilSpec } = await ctx.createMappedSpecs();
      const slabs = await ctx.createStock(slabSpec, 3);
      const order = await ctx.orderOne(customer.id, coilSpec.id, 2);
      const plan = await ctx.prisma.productionPlan.findFirstOrThrow({ where: { salesOrderItemId: order.items[0].id } });
      await ctx.allocations.confirm({ purpose: 'ROLLING', productionPlanId: plan.id, lotIds: slabs.lotIds.slice(0, 2) }, ctx.users.production);
      expect((await ctx.pool(slabSpec.id)).onHandQty).toBe(1);

      await ctx.salesOrders.cancel(order.id, {}, ctx.users.sales);
      expect((await ctx.pool(slabSpec.id)).onHandQty).toBe(3);
      expect(await ctx.prisma.allocation.count({ where: { productionPlanId: plan.id, status: 'CONFIRMED' } })).toBe(0);
      expect(await ctx.prisma.lot.count({ where: { id: { in: slabs.lotIds }, salesOrderItemId: null } })).toBe(3);
      expect((await ctx.inventories.surplus({ productSpecId: slabSpec.id })).lots).toHaveLength(3);
    });
  });
});
