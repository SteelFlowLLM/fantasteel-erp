// @nestjs/common·websockets는 ESM 전용이라 플래그 없는 jest에서는 대체품을 쓴다 (inventory/testing/nest-common.shim.ts)
jest.mock('@nestjs/common', () => require('../inventory/testing/nest-common.shim'));
jest.mock('../../common/realtime/realtime.gateway', () => ({ employeeChannel: (id: number) => `employee:${id}`, RealtimeGateway: class {} }));

import { createTestContext, errorCodeOf, uniq, type TestContext } from '../inventory/testing/test-context';
import type { MillSheetSnapshot } from './mill-sheet.snapshot';

jest.setTimeout(120_000);

describe('출하요청·출고 확정·밀시트 (REQ-SHP-001~004, REQ-INV-005)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });

  const reservationsOf = async (salesOrderItemId: number) =>
    (await ctx.prisma.reservation.findMany({ where: { salesOrderItemId }, orderBy: { id: 'asc' } })).map((r) => `${r.status}:${r.reservedQty}`).sort();

  describe('출하요청', () => {
    it('요청 매수는 ACTIVE 예약 − 다른 미출고 출하요청 매수를 넘을 수 없다', async () => {
      const customer = await ctx.createCustomer();
      const spec = await ctx.createSpec('SLAB');
      await ctx.createStock(spec, 6);
      const order = await ctx.orderOne(customer.id, spec.id, 10); // 예약 6, 부족 4
      const itemId = order.items[0].id;
      const request = (requestQty: number) => ctx.shipmentRequests.create({ customerId: customer.id, requestedShipDate: ctx.dueIn(1), items: [{ salesOrderItemId: itemId, requestQty }] }, ctx.users.sales);

      expect((await ctx.shipmentRequests.shippable({ salesOrderId: order.id })).map((s) => [s.reservedQty, s.requestedQty, s.shippableQty])).toEqual([[6, 0, 6]]);
      expect(await errorCodeOf(request(7))).toBe('INV-001');
      const first = await request(4);
      expect([first.shipmentRequestNo.slice(0, 4), first.shipmentRequestStatus, first.items[0].shipmentRequestItemStatus]).toEqual(['SHP-', 'REQUESTED', 'WAITING_ALLOCATION']);
      expect((await ctx.shipmentRequests.shippable({ salesOrderId: order.id })).map((s) => s.shippableQty)).toEqual([2]);
      expect(await errorCodeOf(request(3))).toBe('INV-001');
      await request(2);
      expect(await ctx.shipmentRequests.shippable({ salesOrderId: order.id })).toEqual([]);

      // 취소하면 그 매수만큼 다시 요청할 수 있다
      await ctx.shipmentRequests.cancel(first.id, { reason: '일정 변경' }, ctx.users.sales);
      expect((await ctx.shipmentRequests.shippable({ salesOrderId: order.id })).map((s) => s.shippableQty)).toEqual([4]);
      expect(await errorCodeOf(ctx.shipmentRequests.cancel(first.id, {}, ctx.users.sales))).toBe('COM-005');
    });

    it('다른 고객사의 수주 품목은 묶을 수 없다', async () => {
      const [a, b] = [await ctx.createCustomer(), await ctx.createCustomer()];
      const spec = await ctx.createSpec('SLAB');
      await ctx.createStock(spec, 4);
      const orderA = await ctx.orderOne(a.id, spec.id, 2);
      const orderB = await ctx.orderOne(b.id, spec.id, 2);
      const dto = { customerId: a.id, requestedShipDate: ctx.dueIn(1), items: [{ salesOrderItemId: orderA.items[0].id, requestQty: 1 }, { salesOrderItemId: orderB.items[0].id, requestQty: 1 }] };
      expect(await errorCodeOf(ctx.shipmentRequests.create(dto, ctx.users.sales))).toBe('COM-003');
      expect(await ctx.prisma.shipmentRequest.count({ where: { customerId: a.id } })).toBe(0);
    });

    it('동시에 들어온 출하요청도 예약 매수를 넘지 않는다', async () => {
      const customer = await ctx.createCustomer();
      const spec = await ctx.createSpec('SLAB');
      await ctx.createStock(spec, 3);
      const order = await ctx.orderOne(customer.id, spec.id, 3);
      const dto = { customerId: customer.id, requestedShipDate: ctx.dueIn(1), items: [{ salesOrderItemId: order.items[0].id, requestQty: 2 }] };
      const codes = await Promise.all([1, 2, 3].map(() => errorCodeOf(ctx.shipmentRequests.create(dto, ctx.users.sales))));
      expect(codes.sort()).toEqual(['INV-001', 'INV-001', null].sort());
    });
  });

  describe('출고 확정 (업무 프로세스 정의서 13.3)', () => {
    it('부분 출고는 예약을 나눈다: ACTIVE 10 → 4 출고 → ACTIVE 6 + CONVERTED 4 → 나머지 6 출고 → 출하완료', async () => {
      const customer = await ctx.createCustomer();
      const spec = await ctx.createSpec('SLAB');
      const stock = await ctx.createStock(spec, 10);
      const order = await ctx.orderOne(customer.id, spec.id, 10);
      const itemId = order.items[0].id;
      expect(await reservationsOf(itemId)).toEqual(['ACTIVE:10']);

      const first = await ctx.requestAndAllocate(customer.id, itemId, 4);
      const issue1 = await ctx.goodsIssues.confirm(first.request.id, ctx.users.logistics);
      expect(issue1.goodsIssueNo).toMatch(/^GI-\d{8}-\d{4}$/);
      expect([issue1.issuedQty, issue1.items[0].shippedQty, issue1.items[0].salesOrderItemStatus]).toEqual([4, 4, 'PARTIALLY_SHIPPED']);
      expect(issue1.items[0].lots.map((l) => l.lotNo)).toEqual(stock.lotNos.slice(0, 4));
      expect(await reservationsOf(itemId)).toEqual(['ACTIVE:6', 'CONVERTED:4']);
      let pool = await ctx.pool(spec.id);
      expect([pool.onHandQty, pool.reservedQty]).toEqual([6, 6]);
      expect((await ctx.salesOrders.detail(order.id)).salesOrderStatus).toBe('PARTIALLY_SHIPPED');
      expect(await ctx.prisma.lot.count({ where: { id: { in: stock.lotIds }, lotStatus: 'SHIPPED' } })).toBe(4);
      expect(await ctx.prisma.allocation.count({ where: { lotId: { in: stock.lotIds }, status: 'CONSUMED' } })).toBe(4);
      expect((await ctx.shipmentRequests.detail(first.request.id)).shipmentRequestStatus).toBe('ISSUED');

      const second = await ctx.requestAndAllocate(customer.id, itemId, 6);
      const issue2 = await ctx.goodsIssues.confirm(second.request.id, ctx.users.logistics);
      expect([issue2.issuedQty, issue2.items[0].shippedQty, issue2.items[0].salesOrderItemStatus]).toEqual([6, 10, 'SHIPPED']);
      expect(await reservationsOf(itemId)).toEqual(['CONVERTED:4', 'CONVERTED:6']);
      pool = await ctx.pool(spec.id);
      expect([pool.onHandQty, pool.reservedQty]).toEqual([0, 0]);
      const detail = await ctx.salesOrders.detail(order.id);
      expect([detail.salesOrderStatus, detail.progressRate, detail.shippedQty]).toEqual(['SHIPPED', 100, 10]);

      const events = (await ctx.prisma.businessEvent.findMany({ where: { salesOrderId: order.id }, orderBy: { id: 'asc' } })).map((e) => e.eventType);
      expect(events.filter((t) => ['RESERVATION_CONVERTED', 'GOODS_ISSUE_CONFIRMED', 'MILL_SHEET_ISSUED'].includes(t))).toEqual([
        'RESERVATION_CONVERTED', 'MILL_SHEET_ISSUED', 'GOODS_ISSUE_CONFIRMED', 'RESERVATION_CONVERTED', 'MILL_SHEET_ISSUED', 'GOODS_ISSUE_CONFIRMED',
      ]);
      expect((await ctx.goodsIssues.list({ salesOrderId: order.id })).map((g) => g.goodsIssueNo)).toEqual([issue2.goodsIssueNo, issue1.goodsIssueNo]);
    });

    it('배정이 끝나지 않은 출하요청은 출고할 수 없다', async () => {
      const customer = await ctx.createCustomer();
      const spec = await ctx.createSpec('SLAB');
      const stock = await ctx.createStock(spec, 3);
      const order = await ctx.orderOne(customer.id, spec.id, 3);
      const request = await ctx.shipmentRequests.create({ customerId: customer.id, requestedShipDate: ctx.dueIn(1), items: [{ salesOrderItemId: order.items[0].id, requestQty: 3 }] }, ctx.users.sales);
      await ctx.allocations.confirm({ purpose: 'SHIPMENT', shipmentRequestItemId: request.items[0].id, lotIds: stock.lotIds.slice(0, 2) }, ctx.users.sales);
      expect(await errorCodeOf(ctx.goodsIssues.confirm(request.id, ctx.users.logistics))).toBe('COM-005');
      expect(await ctx.prisma.goodsIssue.count({ where: { shipmentRequestId: request.id } })).toBe(0);
    });

    it.each([['LOT 검사 불합격', 'lot'], ['상위 히트 성분 불합격', 'heat']])('배정 뒤 미합격이 된 LOT은 출고를 막는다 (INV-002): %s', async (_name, target) => {
      const customer = await ctx.createCustomer();
      const spec = await ctx.createSpec('SLAB');
      const stock = await ctx.createStock(spec, 3);
      const order = await ctx.orderOne(customer.id, spec.id, 3);
      const { request } = await ctx.requestAndAllocate(customer.id, order.items[0].id, 3);
      if (target === 'lot') await ctx.prisma.lot.update({ where: { id: stock.lotIds[2] }, data: { isPassed: false } });
      else await ctx.prisma.lot.update({ where: { id: stock.heatId }, data: { isPassed: false } });

      expect(await errorCodeOf(ctx.goodsIssues.confirm(request.id, ctx.users.logistics))).toBe('INV-002');
      // 막힌 출고는 아무것도 바꾸지 않는다
      expect(await ctx.prisma.goodsIssue.count({ where: { shipmentRequestId: request.id } })).toBe(0);
      expect(await ctx.prisma.lot.count({ where: { id: { in: stock.lotIds }, lotStatus: 'IN_STOCK' } })).toBe(3);
      expect(await ctx.prisma.allocation.count({ where: { lotId: { in: stock.lotIds }, status: 'CONFIRMED' } })).toBe(3);
      expect(await reservationsOf(order.items[0].id)).toEqual(['ACTIVE:3']);
      expect((await ctx.prisma.salesOrderItem.findUniqueOrThrow({ where: { id: order.items[0].id } })).shippedQty).toBe(0);
      expect((await ctx.shipmentRequests.detail(request.id)).shipmentRequestStatus).toBe('ALLOCATED');
      expect(await ctx.prisma.millSheet.count({ where: { salesOrderId: order.id } })).toBe(0);
    });

    it('출고 확정을 다시 불러도 두 번 출고되지 않는다 (상태 확인 + 요청 고유키)', async () => {
      const customer = await ctx.createCustomer();
      const spec = await ctx.createSpec('SLAB');
      await ctx.createStock(spec, 4);
      const order = await ctx.orderOne(customer.id, spec.id, 4);
      const { request } = await ctx.requestAndAllocate(customer.id, order.items[0].id, 2);
      const key = `gi-${uniq()}`;

      const first = await ctx.goodsIssues.confirm(request.id, ctx.users.logistics, key);
      const retry = await ctx.goodsIssues.confirm(request.id, ctx.users.logistics, key);
      expect(retry).toEqual(first);
      expect(await errorCodeOf(ctx.goodsIssues.confirm(request.id, ctx.users.logistics))).toBe('COM-005');
      expect(await errorCodeOf(ctx.goodsIssues.confirm(request.id, ctx.users.logistics, `gi-${uniq()}`))).toBe('COM-005');

      expect(await ctx.prisma.goodsIssue.count({ where: { shipmentRequestId: request.id } })).toBe(1);
      expect(await ctx.prisma.goodsIssueItem.count({ where: { goodsIssueId: first.id } })).toBe(2);
      expect(await ctx.prisma.millSheet.count({ where: { goodsIssueId: first.id } })).toBe(1);
      expect((await ctx.prisma.salesOrderItem.findUniqueOrThrow({ where: { id: order.items[0].id } })).shippedQty).toBe(2);
      expect(await reservationsOf(order.items[0].id)).toEqual(['ACTIVE:2', 'CONVERTED:2']);
      const pool = await ctx.pool(spec.id);
      expect([pool.onHandQty, pool.reservedQty]).toEqual([2, 2]);
    });

    it('같은 출하요청의 출고 확정이 동시에 들어와도 한 번만 출고된다', async () => {
      const customer = await ctx.createCustomer();
      const spec = await ctx.createSpec('SLAB');
      await ctx.createStock(spec, 2);
      const order = await ctx.orderOne(customer.id, spec.id, 2);
      const { request } = await ctx.requestAndAllocate(customer.id, order.items[0].id, 2);
      const codes = await Promise.all([1, 2, 3].map(() => errorCodeOf(ctx.goodsIssues.confirm(request.id, ctx.users.logistics))));
      expect(codes.sort()).toEqual(['COM-005', 'COM-005', null].sort());
      expect(await ctx.prisma.goodsIssue.count({ where: { shipmentRequestId: request.id } })).toBe(1);
      expect((await ctx.prisma.salesOrderItem.findUniqueOrThrow({ where: { id: order.items[0].id } })).shippedQty).toBe(2);
    });

    it('여러 수주의 품목을 묶은 출하요청: 품목마다 예약을 전환하고 밀시트를 1장씩 만든다', async () => {
      const customer = await ctx.createCustomer();
      const { slabSpec, coilSpec } = await ctx.createMappedSpecs();
      await ctx.createStock(slabSpec, 2);
      const coils = await ctx.createStock(coilSpec, 3, { lotType: 'COIL' });
      const slabOrder = await ctx.orderOne(customer.id, slabSpec.id, 2);
      const coilOrder = await ctx.orderOne(customer.id, coilSpec.id, 3);
      const request = await ctx.shipmentRequests.create(
        { customerId: customer.id, requestedShipDate: ctx.dueIn(1), items: [{ salesOrderItemId: slabOrder.items[0].id, requestQty: 2 }, { salesOrderItemId: coilOrder.items[0].id, requestQty: 1 }] },
        ctx.users.sales,
      );
      for (const item of request.items) {
        const r = await ctx.allocations.recommend({ purpose: 'SHIPMENT', shipmentRequestItemId: item.id }, ctx.users.sales);
        await ctx.allocations.confirm({ purpose: 'SHIPMENT', shipmentRequestItemId: item.id, lotIds: r.recommendedLots.map((l) => l.lotId) }, ctx.users.sales);
      }
      const issue = await ctx.goodsIssues.confirm(request.id, ctx.users.logistics);
      expect(issue.items.map((i) => [i.salesOrderNo, i.itemType, i.issuedQty, i.salesOrderItemStatus])).toEqual([
        [slabOrder.salesOrderNo, 'SLAB', 2, 'SHIPPED'],
        [coilOrder.salesOrderNo, 'COIL', 1, 'PARTIALLY_SHIPPED'],
      ]);
      expect(issue.millSheets.map((m) => m.salesOrderId)).toEqual([slabOrder.id, coilOrder.id]);
      expect(await reservationsOf(coilOrder.items[0].id)).toEqual(['ACTIVE:2', 'CONVERTED:1']);
      expect(issue.items[1].lots.map((l) => l.lotNo)).toEqual([coils.lotNos[0]]);
    });
  });

  describe('밀시트 (REQ-SHP-003·004)', () => {
    async function issueOne(qty = 2) {
      const customer = await ctx.createCustomer();
      const spec = await ctx.createSpec('SLAB');
      const oldHeat = await ctx.createStock(spec, 1, { daysAgo: 9 });
      const newHeat = await ctx.createStock(spec, qty - 1, { daysAgo: 2 });
      const order = await ctx.orderOne(customer.id, spec.id, qty);
      const { request } = await ctx.requestAndAllocate(customer.id, order.items[0].id, qty);
      const issue = await ctx.goodsIssues.confirm(request.id, ctx.users.logistics);
      return { customer, spec, oldHeat, newHeat, order, request, issue, millSheetId: issue.millSheets[0].id };
    }

    it('스냅샷에 고객사·수주·규격·LOT·히트 성분·검사값을 복사하고, 히트가 다르면 히트별로 담는다', async () => {
      const { customer, spec, oldHeat, newHeat, order, issue, millSheetId } = await issueOne(3);
      const sheet = await ctx.millSheets.detail(millSheetId);
      const s = sheet.snapshot;
      expect(sheet.millSheetNo).toMatch(/^MS-\d{8}-\d{4}$/);
      expect([sheet.pdfStatus, sheet.pdfUrl]).toEqual(['PENDING', null]);
      expect(s.customer).toEqual({ customerCode: customer.customerCode, customerName: customer.customerName });
      expect([s.salesOrder.salesOrderNo, s.salesOrder.lineNo, s.shipment.goodsIssueNo]).toEqual([order.salesOrderNo, 1, issue.goodsIssueNo]);
      expect([s.productSpec.specCode, s.productSpec.steelGradeCode, s.productSpec.theoreticalWeightTon]).toEqual([spec.specCode, 'SS275', spec.theoreticalWeightTon.toFixed(3)]);
      expect([s.qty, s.qtyUnit, s.weightTon]).toEqual([3, '매', spec.theoreticalWeightTon.mul(3).toFixed(3)]);
      expect(s.heats.map((h) => h.heatNo)).toEqual([oldHeat.heatNo, newHeat.heatNo]);
      expect(s.heats[0].composition?.values.map((v) => v.inspectionItemCode)).toEqual(expect.arrayContaining(['C', 'Si', 'Mn', 'P', 'S']));
      expect(s.lots.map((l) => [l.lotNo, l.heatNo])).toEqual([[oldHeat.lotNos[0], oldHeat.heatNo], ...newHeat.lotNos.map((no) => [no, newHeat.heatNo])]);
      expect(s.lots[0].inspection).toEqual(expect.objectContaining({ processCode: 'CASTING', inspectionResult: 'PASS' }));
      expect(s.lots[0].inspection?.values[0]).toEqual(expect.objectContaining({ inspectionItemCode: 'SURFACE_DEFECT_COUNT', measuredValue: '1', maxValue: '2', isPassed: true }));
      expect((await ctx.millSheets.list({ salesOrderId: order.id })).map((m) => [m.id, m.customerName, m.qty, m.heatNos])).toEqual([[millSheetId, customer.customerName, 3, [oldHeat.heatNo, newHeat.heatNo]]]);
    });

    it('발행 뒤 원본이 바뀌어도 밀시트 값은 그대로다', async () => {
      const { customer, oldHeat, millSheetId } = await issueOne(2);
      const before = (await ctx.millSheets.detail(millSheetId)).snapshot;
      await ctx.prisma.customer.update({ where: { id: customer.id }, data: { customerName: '이름이 바뀐 고객사' } });
      await ctx.prisma.qualityInspectionValue.updateMany({ where: { qualityInspection: { lotId: oldHeat.heatId } }, data: { measuredValue: 9.9999 } });
      const after = (await ctx.millSheets.detail(millSheetId)).snapshot;
      expect(after).toEqual(before);
      expect(after.customer.customerName).toBe(customer.customerName);
    });

    it('코일 밀시트에는 코일 검사와 압연 전 슬래브의 검사를 함께 담는다', async () => {
      const customer = await ctx.createCustomer();
      const { slabSpec, coilSpec } = await ctx.createMappedSpecs();
      const coils = await ctx.createStock(coilSpec, 1, { lotType: 'COIL' });
      // 코일의 모재 슬래브(압연으로 소진)를 같은 히트에 만들어 계보로 잇는다
      const slab = await ctx.prisma.lot.create({
        data: { lotNo: `${coils.heatNo}-S1`, lotType: 'SLAB', productSpecId: slabSpec.id, steelGradeId: slabSpec.steelGradeId, heatLotId: coils.heatId, isPassed: true, lotStatus: 'CONSUMED' },
      });
      await ctx.prisma.qualityInspection.create({
        data: {
          qualityInspectionNo: `QI-T-${uniq()}`, lotId: slab.id, processCode: 'CASTING', inspectionResult: 'PASS', inspectedAt: new Date(),
          values: { create: [{ inspectionItemCode: 'SURFACE_DEFECT_COUNT', inspectionItemName: '표면 결함 수', measuredValue: 0, maxValue: 2, isPassed: true }] },
        },
      });
      await ctx.prisma.lotRelation.create({ data: { parentLotId: slab.id, childLotId: coils.lotIds[0], relationType: 'SLAB_TO_COIL', evidenceType: 'DIRECT' } });
      const order = await ctx.orderOne(customer.id, coilSpec.id, 1);
      const { request } = await ctx.requestAndAllocate(customer.id, order.items[0].id, 1);
      const issue = await ctx.goodsIssues.confirm(request.id, ctx.users.logistics);
      const s: MillSheetSnapshot = (await ctx.millSheets.detail(issue.millSheets[0].id)).snapshot;
      expect([s.productSpec.itemType, s.qtyUnit]).toEqual(['COIL', '개']);
      expect(s.lots[0].inspection?.processCode).toBe('HOT_ROLLING');
      expect(s.lots[0].parentSlab).toEqual({ lotNo: slab.lotNo, inspection: expect.objectContaining({ processCode: 'CASTING', inspectionResult: 'PASS' }) });
    });

    it('PDF는 저장된 스냅샷으로 만들고, 실패해도 같은 스냅샷으로 다시 만들 수 있다 (SHP-001)', async () => {
      const { millSheetId, request, order } = await issueOne(2);
      const saved = process.env.MILL_SHEET_FONT_PATH;
      try {
        process.env.MILL_SHEET_FONT_PATH = '/nonexistent/font.ttf';
        expect(await errorCodeOf(ctx.millSheets.generatePdf(millSheetId))).toBe('SHP-001');
        const failed = await ctx.millSheets.detail(millSheetId);
        expect([failed.pdfStatus, failed.pdfUrl]).toEqual(['FAILED', null]);
        expect(failed.snapshot.qty).toBe(2);
        expect(await errorCodeOf(ctx.millSheets.readPdf(millSheetId))).toBe('COM-005');
      } finally {
        if (saved === undefined) delete process.env.MILL_SHEET_FONT_PATH;
        else process.env.MILL_SHEET_FONT_PATH = saved;
      }

      const ready = await ctx.millSheets.generatePdf(millSheetId);
      expect([ready.pdfStatus, ready.pdfUrl]).toEqual(['READY', `/api/v1/mill-sheets/${millSheetId}/pdf`]);
      const { stream, fileName } = await ctx.millSheets.readPdf(millSheetId);
      const chunks: Buffer[] = [];
      for await (const c of stream) chunks.push(c as Buffer);
      const pdf = Buffer.concat(chunks);
      expect(fileName).toBe(`${ready.millSheetNo}.pdf`);
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.length).toBeGreaterThan(3000);
      // 한글 글꼴이 파일 안에 들어가 있어야 다른 PC에서도 한글이 보인다
      expect(pdf.includes(Buffer.from('/FontFile2'))).toBe(true);

      // 다시 눌러도 출고·밀시트는 늘지 않는다
      await ctx.millSheets.generatePdf(millSheetId);
      expect(await ctx.prisma.goodsIssue.count({ where: { shipmentRequestId: request.id } })).toBe(1);
      expect(await ctx.prisma.millSheet.count({ where: { salesOrderId: order.id } })).toBe(1);
    });
  });
});
