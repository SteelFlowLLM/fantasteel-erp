// @nestjs/common·websockets는 ESM 전용이라 플래그 없는 jest에서는 대체품을 쓴다 (testing/nest-common.shim.ts)
jest.mock('@nestjs/common', () => require('./testing/nest-common.shim'));
jest.mock('../../common/realtime/realtime.gateway', () => ({ employeeChannel: (id: number) => `employee:${id}`, RealtimeGateway: class {} }));

import { createTestContext, errorCodeOf, type TestContext } from './testing/test-context';

jest.setTimeout(120_000);

describe('재고 조회·배정 (REQ-INV-001·006~009)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });

  /** 수주 1건 + 출하요청 1건(배정 전)까지 만든다. */
  async function openRequest(stockQty: number, orderedQty: number, requestQty: number) {
    const customer = await ctx.createCustomer();
    const spec = await ctx.createSpec('SLAB');
    const old = await ctx.createStock(spec, Math.ceil(stockQty / 2), { daysAgo: 9 });
    const recent = await ctx.createStock(spec, stockQty - Math.ceil(stockQty / 2), { daysAgo: 2 });
    const order = await ctx.orderOne(customer.id, spec.id, orderedQty);
    const request = await ctx.shipmentRequests.create({ customerId: customer.id, requestedShipDate: ctx.dueIn(1), items: [{ salesOrderItemId: order.items[0].id, requestQty }] }, ctx.users.sales);
    return { customer, spec, old, recent, order, request, shipmentRequestItemId: request.items[0].id };
  }

  describe('재고 조회', () => {
    it('규격별 합격·예약·가용 매수와 톤, 검사 대기·불합격 수를 준다', async () => {
      const customer = await ctx.createCustomer();
      const spec = await ctx.createSpec('SLAB');
      await ctx.createStock(spec, 6);
      await ctx.createStock(spec, 2, { lotPassed: null });
      await ctx.createStock(spec, 1, { heatPassed: null });
      await ctx.createStock(spec, 3, { lotPassed: false });
      await ctx.createStock(spec, 1, { heatPassed: false });
      await ctx.orderOne(customer.id, spec.id, 4);

      const { products, rawMaterials } = await ctx.inventories.list({ productSpecId: spec.id });
      expect(rawMaterials).toEqual([]);
      expect(products).toHaveLength(1);
      const p = products[0];
      expect([p.onHandQty, p.reservedQty, p.availableQty, p.pendingInspectionQty, p.failedQty, p.earmarkedQty]).toEqual([6, 4, 2, 3, 4, 0]);
      const unit = Number(spec.theoreticalWeightTon);
      expect([p.onHandTon, p.reservedTon, p.availableTon]).toEqual([(unit * 6).toFixed(3), (unit * 4).toFixed(3), (unit * 2).toFixed(3)]);
    });

    it('원료는 톤 잔량과 입고예정(확정 발주의 미입고량)을 준다', async () => {
      const { products, rawMaterials } = await ctx.inventories.list({ itemType: 'RAW_MATERIAL' });
      expect(products).toEqual([]);
      expect(rawMaterials.length).toBeGreaterThan(0);
      for (const r of rawMaterials) {
        expect(r.onHandTon).toMatch(/^\d+\.\d{3}$/);
        expect(r.scheduledReceiptTon).toMatch(/^\d+\.\d{3}$/);
      }
    });

    it('여재: 수주에 묶이지 않은 미배정 합격 슬래브를 히트·생산일·보유 일수와 함께 준다', async () => {
      const spec = await ctx.createSpec('SLAB');
      const stock = await ctx.createStock(spec, 3, { daysAgo: 12 });
      await ctx.createStock(spec, 2, { lotPassed: false });
      const surplus = await ctx.inventories.surplus({ productSpecId: spec.id });
      expect(surplus.lots.map((l) => [l.lotNo, l.heatNo, l.ageDays])).toEqual(stock.lotNos.map((no) => [no, stock.heatNo, 11]));
      expect(surplus.specs).toEqual([expect.objectContaining({ productSpecId: spec.id, surplusQty: 3, reservedQty: 0, availableQty: 3 })]);
    });
  });

  describe('FIFO 추천·확정', () => {
    it('생산완료일 → LOT 번호 순으로 추천하고 아무것도 저장하지 않는다', async () => {
      const { old, recent, spec, shipmentRequestItemId } = await openRequest(6, 6, 4);
      const before = await ctx.prisma.allocation.count({ where: { lot: { productSpecId: spec.id } } });
      const r = await ctx.allocations.recommend({ purpose: 'SHIPMENT', shipmentRequestItemId }, ctx.users.sales);
      expect([r.requiredQty, r.confirmedQty, r.neededQty, r.shortageQty]).toEqual([4, 0, 4, 0]);
      expect(r.recommendedLots.map((l) => l.lotNo)).toEqual([...old.lotNos, recent.lotNos[0]]);
      expect(r.candidateLots.map((l) => l.lotNo)).toEqual([...old.lotNos, ...recent.lotNos]);
      expect(await ctx.prisma.allocation.count({ where: { lot: { productSpecId: spec.id } } })).toBe(before);
    });

    it('확정하면 CONFIRMED 배정이 생기고, 요청 매수를 다 채우면 품목·요청이 ALLOCATED가 된다', async () => {
      const { old, recent, order, request, shipmentRequestItemId } = await openRequest(6, 6, 4);
      const part = await ctx.allocations.confirm({ purpose: 'SHIPMENT', shipmentRequestItemId, lotIds: old.lotIds }, ctx.users.sales);
      expect([part.shipmentRequestItemStatus, part.shipmentRequestStatus, part.neededQty, part.isRecommendationFollowed]).toEqual(['WAITING_ALLOCATION', 'REQUESTED', 1, true]);
      const rest = await ctx.allocations.confirm({ purpose: 'SHIPMENT', shipmentRequestItemId, lotIds: [recent.lotIds[0]] }, ctx.users.sales);
      expect([rest.shipmentRequestItemStatus, rest.shipmentRequestStatus, rest.neededQty]).toEqual(['ALLOCATED', 'ALLOCATED', 0]);

      const detail = await ctx.shipmentRequests.detail(request.id);
      expect(detail.items[0].allocations.map((a) => [a.lotNo, a.status])).toEqual([...old.lotNos, recent.lotNos[0]].map((no) => [no, 'CONFIRMED']));
      const events = await ctx.prisma.businessEvent.findMany({ where: { salesOrderId: order.id, eventType: { startsWith: 'ALLOCATION' } }, orderBy: { id: 'asc' } });
      expect(events.map((e) => [e.eventType, e.reasonCode])).toEqual([['ALLOCATION_CONFIRMED', 'FIFO_RECOMMENDATION'], ['ALLOCATION_CONFIRMED', 'FIFO_RECOMMENDATION']]);
      expect((events[0].afterData as { recommendedLotNos: string[] }).recommendedLotNos).toEqual([...old.lotNos, recent.lotNos[0]]);
      // 배정은 예약 매수 안에서 LOT만 정하는 것이라 재고 풀 매수는 그대로다
      const pool = await ctx.pool(order.items[0].productSpecId);
      expect([pool.onHandQty, pool.reservedQty]).toEqual([6, 6]);
    });

    it('추천과 다른 LOT을 고르면 ALLOCATION_CHANGED와 사유를 함께 남긴다', async () => {
      const { recent, order, shipmentRequestItemId } = await openRequest(6, 6, 2);
      const result = await ctx.allocations.confirm({ purpose: 'SHIPMENT', shipmentRequestItemId, lotIds: recent.lotIds.slice(0, 2), reason: '고객 지정 히트' }, ctx.users.sales);
      expect(result.isRecommendationFollowed).toBe(false);
      const events = await ctx.prisma.businessEvent.findMany({ where: { salesOrderId: order.id, eventType: { startsWith: 'ALLOCATION' } }, orderBy: { id: 'asc' } });
      expect(events.map((e) => [e.eventType, e.reasonCode, e.reason])).toEqual([
        ['ALLOCATION_CONFIRMED', 'FIFO_RECOMMENDATION', 'FIFO 추천과 다른 LOT으로 확정'],
        ['ALLOCATION_CHANGED', 'ALLOCATION_CHANGE', '고객 지정 히트'],
      ]);
    });

    it('요청 매수보다 많이·다른 규격·미합격 LOT은 확정할 수 없다', async () => {
      const { old, recent, spec, shipmentRequestItemId } = await openRequest(6, 6, 2);
      expect(await errorCodeOf(ctx.allocations.confirm({ purpose: 'SHIPMENT', shipmentRequestItemId, lotIds: [...old.lotIds, ...recent.lotIds].slice(0, 3) }, ctx.users.sales))).toBe('INV-001');
      const otherSpec = await ctx.createSpec('SLAB');
      const other = await ctx.createStock(otherSpec, 1);
      expect(await errorCodeOf(ctx.allocations.confirm({ purpose: 'SHIPMENT', shipmentRequestItemId, lotIds: other.lotIds }, ctx.users.sales))).toBe('COM-003');
      const failed = await ctx.createStock(spec, 1, { heatPassed: false });
      expect(await errorCodeOf(ctx.allocations.confirm({ purpose: 'SHIPMENT', shipmentRequestItemId, lotIds: failed.lotIds }, ctx.users.sales))).toBe('INV-002');
      expect(await ctx.prisma.allocation.count({ where: { shipmentRequestItemId } })).toBe(0);
    });

    it('출하 배정은 출하요청 권한이, 열연 배정은 열연 투입 배정 권한이 있어야 한다', async () => {
      const { old, shipmentRequestItemId } = await openRequest(2, 2, 2);
      expect(await errorCodeOf(ctx.allocations.confirm({ purpose: 'SHIPMENT', shipmentRequestItemId, lotIds: old.lotIds }, ctx.users.logistics))).toBe('COM-002');
      expect(await errorCodeOf(ctx.allocations.recommend({ purpose: 'SHIPMENT', shipmentRequestItemId }, ctx.users.production))).toBe('COM-002');
      expect(await errorCodeOf(ctx.allocations.recommend({ purpose: 'ROLLING', productionPlanId: 1 }, ctx.users.sales))).toBe('COM-002');
    });
  });

  describe('LOT당 CONFIRMED 배정 1건 (REQ-INV-009)', () => {
    it('이미 배정된 LOT을 다른 출하요청에 또 배정하면 INV-003', async () => {
      const customer = await ctx.createCustomer();
      const spec = await ctx.createSpec('SLAB');
      const stock = await ctx.createStock(spec, 4);
      const order = await ctx.orderOne(customer.id, spec.id, 4);
      const make = () => ctx.shipmentRequests.create({ customerId: customer.id, requestedShipDate: ctx.dueIn(1), items: [{ salesOrderItemId: order.items[0].id, requestQty: 2 }] }, ctx.users.sales);
      const [a, b] = [await make(), await make()];
      await ctx.allocations.confirm({ purpose: 'SHIPMENT', shipmentRequestItemId: a.items[0].id, lotIds: stock.lotIds.slice(0, 2) }, ctx.users.sales);
      // 추천은 이미 배정된 LOT을 빼고 준다
      const r = await ctx.allocations.recommend({ purpose: 'SHIPMENT', shipmentRequestItemId: b.items[0].id }, ctx.users.sales);
      expect(r.recommendedLots.map((l) => l.lotId)).toEqual(stock.lotIds.slice(2));
      const code = await errorCodeOf(ctx.allocations.confirm({ purpose: 'SHIPMENT', shipmentRequestItemId: b.items[0].id, lotIds: [stock.lotIds[1], stock.lotIds[2]], reason: '테스트' }, ctx.users.sales));
      expect(code).toBe('INV-003');
      // 실패한 확정은 전부 되돌려진다 (2번 LOT도 배정되지 않는다)
      expect(await ctx.prisma.allocation.count({ where: { lotId: { in: stock.lotIds }, status: 'CONFIRMED' } })).toBe(2);
    });

    it('같은 LOT을 두 출하요청이 동시에 확정해도 하나만 성공한다', async () => {
      const customer = await ctx.createCustomer();
      const spec = await ctx.createSpec('SLAB');
      const stock = await ctx.createStock(spec, 2);
      const order = await ctx.orderOne(customer.id, spec.id, 2);
      const make = () => ctx.shipmentRequests.create({ customerId: customer.id, requestedShipDate: ctx.dueIn(1), items: [{ salesOrderItemId: order.items[0].id, requestQty: 1 }] }, ctx.users.sales);
      const [a, b] = [await make(), await make()];
      const sameLot = [stock.lotIds[0]];
      const codes = await Promise.all([a, b].map((r) => errorCodeOf(ctx.allocations.confirm({ purpose: 'SHIPMENT', shipmentRequestItemId: r.items[0].id, lotIds: sameLot }, ctx.users.sales))));
      expect(codes.sort()).toEqual(['INV-003', null].sort());
      expect(await ctx.prisma.allocation.count({ where: { lotId: stock.lotIds[0], status: 'CONFIRMED' } })).toBe(1);
    });

    it('열연과 판매가 같은 슬래브를 고르면 CONFIRMED 배정은 하나만 생긴다', async () => {
      const customer = await ctx.createCustomer();
      const { slabSpec, coilSpec } = await ctx.createMappedSpecs();
      const slabs = await ctx.createStock(slabSpec, 3);
      const slabOrder = await ctx.orderOne(customer.id, slabSpec.id, 1);
      const coilOrder = await ctx.orderOne(customer.id, coilSpec.id, 2);
      const plan = await ctx.prisma.productionPlan.findFirstOrThrow({ where: { salesOrderItemId: coilOrder.items[0].id } });

      const rolling = await ctx.allocations.recommend({ purpose: 'ROLLING', productionPlanId: plan.id }, ctx.users.production);
      expect([rolling.productSpecId, rolling.neededQty]).toEqual([slabSpec.id, 2]);
      // 판매 예약 1매를 침범하지 않도록 가용(3 − 1 = 2)만큼만 추천한다
      expect(rolling.recommendedLots.map((l) => l.lotId)).toEqual(slabs.lotIds.slice(0, 2));
      const confirmed = await ctx.allocations.confirm({ purpose: 'ROLLING', productionPlanId: plan.id, lotIds: slabs.lotIds.slice(0, 2) }, ctx.users.production);
      expect(confirmed.allocations).toHaveLength(2);
      expect(confirmed.neededQty).toBe(0);
      // 귀속된 슬래브는 재고 풀에서 빠진다: 3 → 1 (판매 예약 1매는 그대로)
      const pool = await ctx.pool(slabSpec.id);
      expect([pool.onHandQty, pool.reservedQty]).toEqual([1, 1]);
      expect((await ctx.inventories.list({ productSpecId: slabSpec.id })).products[0].earmarkedQty).toBe(2);

      const request = await ctx.shipmentRequests.create({ customerId: customer.id, requestedShipDate: ctx.dueIn(1), items: [{ salesOrderItemId: slabOrder.items[0].id, requestQty: 1 }] }, ctx.users.sales);
      const code = await errorCodeOf(ctx.allocations.confirm({ purpose: 'SHIPMENT', shipmentRequestItemId: request.items[0].id, lotIds: [slabs.lotIds[0]], reason: '테스트' }, ctx.users.sales));
      expect(code).toBe('INV-003');
      expect(await ctx.prisma.allocation.count({ where: { lotId: slabs.lotIds[0], status: 'CONFIRMED' } })).toBe(1);
      // 남은 1매는 판매 출하에 배정된다
      const ok = await ctx.allocations.confirm({ purpose: 'SHIPMENT', shipmentRequestItemId: request.items[0].id, lotIds: [slabs.lotIds[2]] }, ctx.users.sales);
      expect(ok.shipmentRequestStatus).toBe('ALLOCATED');
      // 열연에 더 필요한 매수가 없으므로 추가 배정은 막힌다
      const extra = await ctx.createStock(slabSpec, 1);
      expect(await errorCodeOf(ctx.allocations.confirm({ purpose: 'ROLLING', productionPlanId: plan.id, lotIds: extra.lotIds }, ctx.users.production))).toBe('INV-001');
    });

    it('열연 배정이 판매 예약분까지 끌어가려 하면 INV-001', async () => {
      const customer = await ctx.createCustomer();
      const { slabSpec, coilSpec } = await ctx.createMappedSpecs();
      const slabs = await ctx.createStock(slabSpec, 2);
      await ctx.orderOne(customer.id, slabSpec.id, 2);
      const coilOrder = await ctx.orderOne(customer.id, coilSpec.id, 1);
      const plan = await ctx.prisma.productionPlan.findFirstOrThrow({ where: { salesOrderItemId: coilOrder.items[0].id } });
      const r = await ctx.allocations.recommend({ purpose: 'ROLLING', productionPlanId: plan.id }, ctx.users.production);
      expect([r.neededQty, r.recommendedLots.length, r.shortageQty]).toEqual([1, 0, 1]);
      expect(await errorCodeOf(ctx.allocations.confirm({ purpose: 'ROLLING', productionPlanId: plan.id, lotIds: [slabs.lotIds[0]], reason: '테스트' }, ctx.users.production))).toBe('INV-001');
      const pool = await ctx.pool(slabSpec.id);
      expect([pool.onHandQty, pool.reservedQty]).toEqual([2, 2]);
    });
  });

  describe('배정 변경·해제', () => {
    it('변경 = 기존 배정 해제 + 새 확정을 한 트랜잭션으로 한다', async () => {
      const { old, recent, order, request, shipmentRequestItemId } = await openRequest(4, 4, 2);
      const first = await ctx.allocations.confirm({ purpose: 'SHIPMENT', shipmentRequestItemId, lotIds: old.lotIds }, ctx.users.sales);
      const changed = await ctx.allocations.confirm(
        { purpose: 'SHIPMENT', shipmentRequestItemId, lotIds: [recent.lotIds[0]], releaseAllocationIds: [first.allocations[0].id], reason: '표면 재확인' },
        ctx.users.sales,
      );
      expect(changed.releasedAllocationIds).toEqual([first.allocations[0].id]);
      expect(changed.shipmentRequestStatus).toBe('ALLOCATED');
      const detail = await ctx.shipmentRequests.detail(request.id);
      expect(detail.items[0].allocations.map((a) => a.lotNo).sort()).toEqual([old.lotNos[1], recent.lotNos[0]].sort());
      const released = await ctx.prisma.allocation.findUniqueOrThrow({ where: { id: first.allocations[0].id } });
      expect(released.status).toBe('RELEASED');
      const last = await ctx.prisma.businessEvent.findFirstOrThrow({ where: { salesOrderId: order.id, eventType: 'ALLOCATION_CHANGED' }, orderBy: { id: 'desc' } });
      expect([last.reasonCode, last.reason]).toEqual(['ALLOCATION_CHANGE', '표면 재확인']);

      // 새 LOT이 배정 불가면 해제도 함께 되돌려진다
      const before = await ctx.shipmentRequests.detail(request.id);
      const bad = await ctx.createStock({ id: order.items[0].productSpecId, steelGradeId: (await ctx.prisma.productSpec.findUniqueOrThrow({ where: { id: order.items[0].productSpecId } })).steelGradeId }, 1, { lotPassed: false });
      const code = await errorCodeOf(ctx.allocations.confirm({ purpose: 'SHIPMENT', shipmentRequestItemId, lotIds: bad.lotIds, releaseAllocationIds: [before.items[0].allocations[0].id] }, ctx.users.sales));
      expect(code).toBe('INV-002');
      expect((await ctx.shipmentRequests.detail(request.id)).items[0].allocations.map((a) => a.id)).toEqual(before.items[0].allocations.map((a) => a.id));
    });

    it('해제하면 출하요청이 배정 대기로 돌아가고 LOT을 다시 배정할 수 있다', async () => {
      const { old, order, shipmentRequestItemId } = await openRequest(2, 2, 1);
      const confirmed = await ctx.allocations.confirm({ purpose: 'SHIPMENT', shipmentRequestItemId, lotIds: [old.lotIds[0]] }, ctx.users.sales);
      const released = await ctx.allocations.release(confirmed.allocations[0].id, { reason: '출하 보류' }, ctx.users.sales);
      expect([released.status, released.shipmentRequestItemStatus, released.shipmentRequestStatus]).toEqual(['RELEASED', 'WAITING_ALLOCATION', 'REQUESTED']);
      expect(await errorCodeOf(ctx.allocations.release(confirmed.allocations[0].id, {}, ctx.users.sales))).toBe('COM-005');
      const event = await ctx.prisma.businessEvent.findFirstOrThrow({ where: { salesOrderId: order.id, eventType: 'ALLOCATION_RELEASED' } });
      expect(event.lotIds).toEqual([old.lotIds[0]]);
      const again = await ctx.allocations.confirm({ purpose: 'SHIPMENT', shipmentRequestItemId, lotIds: [old.lotIds[0]] }, ctx.users.sales);
      expect(again.shipmentRequestStatus).toBe('ALLOCATED');
    });
  });
});
