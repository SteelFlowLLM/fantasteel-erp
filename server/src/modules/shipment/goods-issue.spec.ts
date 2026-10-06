import { Test } from '@nestjs/testing';
import {
  ALLOCATION_PURPOSE,
  ALLOCATION_STATUS,
  BUSINESS_EVENT_TYPE,
  INSPECTION_RESULT,
  LOT_RELATION_EVIDENCE,
  LOT_STATUS,
  LOT_TYPE,
  PROCESS_TYPE,
  RESERVATION_STATUS,
  SALES_ORDER_ITEM_STATUS,
  SHIPMENT_REQUEST_STATUS,
  type AuthUser,
} from '@fantasteel/shared';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { CommonModule } from '../../common/common.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { ShipmentModule } from './shipment.module';
import { ShipmentService } from './shipment.service';

// 실제 DB(fs_sales)에 수주·예약·합격 LOT·배정을 직접 넣고 출고 확정을 부른다 (업무 프로세스 13.3, shipment.md 7장).
// 출고 확정은 재고·예약·LOT·수주 상태를 함께 바꾸므로 서버 단위 테스트가 필수다 (컨벤션 11장).
describe('ShipmentService 출고 확정 (REQ-SHP-002·003, REQ-INV-005, REQ-SO-005)', () => {
  let prisma: PrismaService;
  let service: ShipmentService;
  let sales: AuthUser;
  let logistics: AuthUser;
  let customerId: number;
  let item: { id: number; steelGradeId: number };
  let steelmakingStandard: { id: number; items: { id: number; inspectionItemCode: string }[] };
  let castingStandard: { id: number; items: { id: number; inspectionItemCode: string }[] };
  let steelmaking: number;
  let casting: number;
  let seq = 0;

  const loadUser = async (authUsers: AuthUserService, employeeNo: string) => {
    const e = await prisma.employee.findUniqueOrThrow({ where: { employeeNo } });
    const user = await authUsers.load(e.id);
    if (!user) throw new Error(`사원 ${employeeNo} 없음`);
    return user;
  };

  const inspect = async (lotId: number, standard: typeof steelmakingStandard, result: string, measured: string) => {
    const inspection = await prisma.qualityInspection.create({
      data: { lotId, inspectionStandardId: standard.id, inspectionResult: result, inspectorEmployeeId: logistics.employeeId, inspectedAt: new Date('2026-10-02T03:00:00.000Z') },
    });
    await prisma.qualityInspectionValue.createMany({
      data: standard.items.slice(0, 2).map((i) => ({ qualityInspectionId: inspection.id, inspectionStandardItemId: i.id, measuredValue: measured })),
    });
  };

  /** 출고할 수 있는 슬래브 LOT: 슬래브 PASS + 상위 히트 PASS(옵션으로 FAIL) */
  const slabLot = async (opts: { heatResult?: string } = {}) => {
    seq += 1;
    const heat = await prisma.lot.create({
      data: { lotNo: `HT-GI-${seq}`, lotType: LOT_TYPE.HEAT, steelGradeId: item.steelGradeId, productionResultId: steelmaking },
    });
    const slab = await prisma.lot.create({
      data: { lotNo: `SL-GI-${seq}`, lotType: LOT_TYPE.SLAB, itemId: item.id, productionResultId: casting, producedDate: new Date('2026-10-02T00:00:00.000Z') },
    });
    await prisma.lotRelation.create({ data: { parentLotId: heat.id, childLotId: slab.id, lotRelationEvidence: LOT_RELATION_EVIDENCE.ACTUAL_INPUT } });
    await inspect(heat.id, steelmakingStandard, opts.heatResult ?? INSPECTION_RESULT.PASS, '0.1000');
    await inspect(slab.id, castingStandard, INSPECTION_RESULT.PASS, '1.0000');
    return { heatId: heat.id, slabId: slab.id, slabNo: slab.lotNo, heatNo: heat.lotNo };
  };

  /** 수주 1건(품목 1개, 수주 매수 orderedQty) + ACTIVE 예약 + 재고 반영 */
  const salesOrder = async (orderedQty: number, customer = customerId) => {
    seq += 1;
    const created = await prisma.salesOrder.create({
      data: {
        salesOrderNo: `SO-GI-${String(seq).padStart(3, '0')}`,
        customerId: customer,
        ownerEmployeeId: sales.employeeId,
        salesOrderItems: { create: { itemId: item.id, orderedQty, dueDate: new Date('2026-12-31T00:00:00.000Z') } },
      },
      select: { id: true, salesOrderNo: true, salesOrderItems: { select: { id: true } } },
    });
    const salesOrderItemId = created.salesOrderItems[0].id;
    await prisma.reservation.create({ data: { salesOrderItemId, itemId: item.id, reservedQty: orderedQty } });
    // 합격 재고 = 예약 매수 (재고 on_hand·reserved_qty는 ACTIVE 예약 합계와 같아야 한다)
    await prisma.inventory.upsert({
      where: { itemId: item.id },
      create: { itemId: item.id, onHandQty: orderedQty, reservedQty: orderedQty },
      update: { onHandQty: { increment: orderedQty }, reservedQty: { increment: orderedQty } },
    });
    return { salesOrderId: created.id, salesOrderNo: created.salesOrderNo, salesOrderItemId };
  };

  /** 출하요청 + 배정 확정(lotCount개). lotCount가 requestQty보다 적으면 배정 대기가 남는다 */
  const shipmentRequest = async (lines: { salesOrderItemId: number; requestQty: number; lotCount?: number }[], customer = customerId) => {
    const created = await service.create(sales, { customerId: customer, items: lines.map((l) => ({ salesOrderItemId: l.salesOrderItemId, requestQty: l.requestQty })) });
    const lotsByLine: { slabId: number; heatId: number; slabNo: string; heatNo: string }[][] = [];
    for (const [index, line] of lines.entries()) {
      const lots = [];
      for (let n = 0; n < (line.lotCount ?? line.requestQty); n += 1) {
        const lot = await slabLot();
        lots.push(lot);
        await prisma.allocation.create({
          data: { lotId: lot.slabId, allocationPurpose: ALLOCATION_PURPOSE.SHIPMENT, shipmentRequestItemId: created.items[index].id, allocationStatus: ALLOCATION_STATUS.CONFIRMED },
        });
      }
      lotsByLine.push(lots);
    }
    return { id: created.id, shipmentRequestNo: created.shipmentRequestNo, lotsByLine };
  };

  const inventoryOf = () => prisma.inventory.findUniqueOrThrow({ where: { itemId: item.id } });
  const reservationQty = async (salesOrderItemId: number, status: string) =>
    (await prisma.reservation.findMany({ where: { salesOrderItemId, reservationStatus: status } })).reduce((sum, r) => sum + r.reservedQty, 0);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PrismaModule, CommonModule, ShipmentModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(ShipmentService);
    const authUsers = moduleRef.get(AuthUserService);
    sales = await loadUser(authUsers, '2103003');
    logistics = await loadUser(authUsers, '2304015');
    customerId = (await prisma.customer.findUniqueOrThrow({ where: { customerCode: 'CUS-01' } })).id;
    const slabItem = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'SL-SM355A-250x1500x10000' } });
    item = { id: slabItem.id, steelGradeId: slabItem.steelGradeId! };
    const standardOf = async (inspectionStandardCode: string) => {
      const s = await prisma.inspectionStandard.findFirstOrThrow({
        where: { inspectionStandardCode },
        orderBy: { versionNo: 'desc' },
        select: { id: true, inspectionStandardItems: { orderBy: { id: 'asc' }, select: { id: true, inspectionItemCode: true } } },
      });
      return { id: s.id, items: s.inspectionStandardItems };
    };
    steelmakingStandard = await standardOf('QS-SM355A-ST');
    castingStandard = await standardOf('QS-SM355A-CC');
    steelmaking = (await prisma.productionResult.create({ data: { processType: PROCESS_TYPE.STEELMAKING, converterCode: 'BOF1', startedAt: new Date(), completedAt: new Date('2026-10-02T01:00:00.000Z') } })).id;
    casting = (await prisma.productionResult.create({ data: { processType: PROCESS_TYPE.CONTINUOUS_CASTING, startedAt: new Date(), completedAt: new Date() } })).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('부분 출고 4매: 예약 ACTIVE 10 → ACTIVE 6 + CONVERTED 4, 재고·LOT·배정·수주 품목·출하요청·밀시트·작업 로그가 함께 바뀐다', async () => {
    const so = await salesOrder(10);
    const before = await inventoryOf();
    const request = await shipmentRequest([{ salesOrderItemId: so.salesOrderItemId, requestQty: 4 }]);
    const lotIds = request.lotsByLine[0].map((l) => l.slabId);

    const issued = await service.issue(logistics, request.id);

    expect(issued).toMatchObject({ shipmentRequestStatus: SHIPMENT_REQUEST_STATUS.ISSUED, issuedEmployeeId: logistics.employeeId });
    expect(issued.issuedAt).not.toBeNull();
    expect(await reservationQty(so.salesOrderItemId, RESERVATION_STATUS.CONVERTED)).toBe(4);
    expect(await reservationQty(so.salesOrderItemId, RESERVATION_STATUS.ACTIVE)).toBe(6);
    const after = await inventoryOf();
    expect([after.onHandQty, after.reservedQty]).toEqual([before.onHandQty - 4, before.reservedQty - 4]);
    expect((await prisma.lot.findMany({ where: { id: { in: lotIds } } })).every((l) => l.lotStatus === LOT_STATUS.SHIPPED)).toBe(true);
    expect((await prisma.allocation.findMany({ where: { lotId: { in: lotIds } } })).every((a) => a.allocationStatus === ALLOCATION_STATUS.CONSUMED)).toBe(true);
    expect((await prisma.salesOrderItem.findUniqueOrThrow({ where: { id: so.salesOrderItemId } })).salesOrderItemStatus).toBe(SALES_ORDER_ITEM_STATUS.PARTIALLY_SHIPPED);

    const events = await prisma.businessEvent.findMany({ where: { salesOrderId: so.salesOrderId }, orderBy: { id: 'asc' }, include: { businessEventLots: true } });
    expect(events.map((e) => e.businessEventType)).toEqual(
      expect.arrayContaining([BUSINESS_EVENT_TYPE.SHIPMENT_REQUEST_CREATED, BUSINESS_EVENT_TYPE.GOODS_ISSUE_CONFIRMED, BUSINESS_EVENT_TYPE.RESERVATION_CONVERTED, BUSINESS_EVENT_TYPE.MILL_SHEET_ISSUED]),
    );
    const issueEvent = events.find((e) => e.businessEventType === BUSINESS_EVENT_TYPE.GOODS_ISSUE_CONFIRMED)!;
    expect(issueEvent.actorEmployeeId).toBe(logistics.employeeId);
    expect(issueEvent.businessEventLots.map((l) => l.lotId).sort()).toEqual([...lotIds].sort());
  });

  it('나머지 6매까지 출고하면 전량 CONVERTED이고 수주 품목은 SHIPPED (출하완료)', async () => {
    const so = await salesOrder(10);
    const first = await shipmentRequest([{ salesOrderItemId: so.salesOrderItemId, requestQty: 4 }]);
    await service.issue(logistics, first.id);
    const second = await shipmentRequest([{ salesOrderItemId: so.salesOrderItemId, requestQty: 6 }]);
    await service.issue(logistics, second.id);

    expect(await reservationQty(so.salesOrderItemId, RESERVATION_STATUS.CONVERTED)).toBe(10);
    expect(await reservationQty(so.salesOrderItemId, RESERVATION_STATUS.ACTIVE)).toBe(0);
    expect((await prisma.salesOrderItem.findUniqueOrThrow({ where: { id: so.salesOrderItemId } })).salesOrderItemStatus).toBe(SALES_ORDER_ITEM_STATUS.SHIPPED);
  });

  it('이미 출고 확정한 요청을 다시 확정하면 COM-001이고 출고·밀시트가 중복되지 않는다', async () => {
    const so = await salesOrder(3);
    const request = await shipmentRequest([{ salesOrderItemId: so.salesOrderItemId, requestQty: 3 }]);
    await service.issue(logistics, request.id);
    const stock = await inventoryOf();

    await expect(service.issue(logistics, request.id)).rejects.toMatchObject({ code: 'COM-001' });
    expect(await prisma.millSheet.count({ where: { shipmentRequestId: request.id } })).toBe(1);
    expect(await reservationQty(so.salesOrderItemId, RESERVATION_STATUS.CONVERTED)).toBe(3);
    expect(await inventoryOf()).toMatchObject({ onHandQty: stock.onHandQty, reservedQty: stock.reservedQty });
  });

  it('동시에 두 번 눌러도 한 번만 출고된다', async () => {
    const so = await salesOrder(2);
    const request = await shipmentRequest([{ salesOrderItemId: so.salesOrderItemId, requestQty: 2 }]);
    const results = await Promise.allSettled([service.issue(logistics, request.id), service.issue(logistics, request.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await reservationQty(so.salesOrderItemId, RESERVATION_STATUS.CONVERTED)).toBe(2);
    expect(await prisma.millSheet.count({ where: { shipmentRequestId: request.id } })).toBe(1);
  });

  it('상위 히트가 불합격인 슬래브가 섞여 있으면 INV-002로 막고 아무것도 바뀌지 않는다', async () => {
    const so = await salesOrder(2);
    const request = await shipmentRequest([{ salesOrderItemId: so.salesOrderItemId, requestQty: 2 }]);
    await prisma.qualityInspection.updateMany({ where: { lotId: request.lotsByLine[0][1].heatId }, data: { inspectionResult: INSPECTION_RESULT.FAIL } });
    const stock = await inventoryOf();

    await expect(service.issue(logistics, request.id)).rejects.toMatchObject({ code: 'INV-002' });
    expect((await prisma.shipmentRequest.findUniqueOrThrow({ where: { id: request.id } })).shipmentRequestStatus).not.toBe(SHIPMENT_REQUEST_STATUS.ISSUED);
    expect((await prisma.lot.findMany({ where: { id: { in: request.lotsByLine[0].map((l) => l.slabId) } } })).every((l) => l.lotStatus === LOT_STATUS.AVAILABLE)).toBe(true);
    expect(await reservationQty(so.salesOrderItemId, RESERVATION_STATUS.CONVERTED)).toBe(0);
    expect(await inventoryOf()).toMatchObject({ onHandQty: stock.onHandQty, reservedQty: stock.reservedQty });
    expect(await prisma.millSheet.count({ where: { shipmentRequestId: request.id } })).toBe(0);
  });

  it('이미 출고·투입된 LOT은 INV-004', async () => {
    const so = await salesOrder(1);
    const request = await shipmentRequest([{ salesOrderItemId: so.salesOrderItemId, requestQty: 1 }]);
    await prisma.lot.update({ where: { id: request.lotsByLine[0][0].slabId }, data: { lotStatus: LOT_STATUS.CONSUMED } });
    await expect(service.issue(logistics, request.id)).rejects.toMatchObject({ code: 'INV-004' });
  });

  it('배정 대기가 남아 있으면 INV-001, 취소된 요청·없는 요청은 막는다', async () => {
    const so = await salesOrder(3);
    const request = await shipmentRequest([{ salesOrderItemId: so.salesOrderItemId, requestQty: 3, lotCount: 2 }]);
    await expect(service.issue(logistics, request.id)).rejects.toMatchObject({ code: 'INV-001' });

    await service.cancel(sales, request.id);
    await expect(service.issue(logistics, request.id)).rejects.toMatchObject({ code: 'COM-001' });
    await expect(service.issue(logistics, 999999)).rejects.toMatchObject({ code: 'COM-003' });
  });

  it('수주가 둘이면 밀시트가 수주마다 1장(MS-…-1, MS-…-2)이고 작업 로그도 수주마다 남는다', async () => {
    const a = await salesOrder(2);
    const b = await salesOrder(1);
    const request = await shipmentRequest([
      { salesOrderItemId: a.salesOrderItemId, requestQty: 2 },
      { salesOrderItemId: b.salesOrderItemId, requestQty: 1 },
    ]);
    await service.issue(logistics, request.id);

    const sheets = await prisma.millSheet.findMany({ where: { shipmentRequestId: request.id }, orderBy: { id: 'asc' } });
    expect(sheets.map((s) => s.millSheetNo)).toEqual([`MS-${request.shipmentRequestNo.slice(3)}-1`, `MS-${request.shipmentRequestNo.slice(3)}-2`]);
    expect(sheets.map((s) => s.salesOrderId)).toEqual([a.salesOrderId, b.salesOrderId]);
    for (const so of [a, b]) {
      const events = await prisma.businessEvent.findMany({ where: { salesOrderId: so.salesOrderId } });
      expect(events.map((e) => e.businessEventType)).toEqual(expect.arrayContaining([BUSINESS_EVENT_TYPE.GOODS_ISSUE_CONFIRMED, BUSINESS_EVENT_TYPE.MILL_SHEET_ISSUED]));
    }
  });

  it('밀시트 스냅샷에는 고객사·규격·히트·검사값이 담기고, 이후 검사값·고객사명을 바꿔도 그대로다 (TRM-083)', async () => {
    const so = await salesOrder(2);
    const request = await shipmentRequest([{ salesOrderItemId: so.salesOrderItemId, requestQty: 2 }]);
    await service.issue(logistics, request.id);
    const sheet = await prisma.millSheet.findFirstOrThrow({ where: { shipmentRequestId: request.id } });
    const detail = await service.findMillSheet(sheet.id);
    const [lotA, lotB] = request.lotsByLine[0];

    expect(detail.snapshot).toMatchObject({
      millSheetNo: sheet.millSheetNo,
      customer: { customerCode: 'CUS-01' },
      salesOrder: { salesOrderNo: so.salesOrderNo },
      shipmentRequest: { shipmentRequestNo: request.shipmentRequestNo, issuedEmployeeName: logistics.employeeName },
      totalQty: 2,
      totalWeightTon: '58.876',
    });
    const [snapshotItem] = detail.snapshot.items;
    expect(snapshotItem).toMatchObject({ itemCode: 'SL-SM355A-250x1500x10000', steelGradeCode: 'SM355A', qty: 2, theoreticalWeightTon: '29.438' });
    expect(snapshotItem.standardNo).toBeTruthy();
    // 슬래브마다 히트가 다르면 LOT별 히트 값이 그대로 들어간다 (14.1-9)
    expect(snapshotItem.lots.map((l) => [l.lotNo, l.heatNo])).toEqual([[lotA.slabNo, lotA.heatNo], [lotB.slabNo, lotB.heatNo]]);
    expect(detail.snapshot.heats.map((h) => [h.heatNo, h.converterCode])).toEqual([[lotA.heatNo, 'BOF1'], [lotB.heatNo, 'BOF1']]);
    expect(detail.snapshot.heats[0].inspection?.values[0]).toMatchObject({ inspectionItemCode: 'C', measuredValue: '0.1000', maxValue: '0.2000', isPassed: true });
    expect(snapshotItem.lots[0].productInspection).toMatchObject({ inspectionResult: INSPECTION_RESULT.PASS, inspectionStandardCode: 'QS-SM355A-CC' });
    expect(detail.snapshot.lotIds).toEqual(expect.arrayContaining([lotA.slabId, lotA.heatId, lotB.slabId, lotB.heatId]));

    await prisma.qualityInspectionValue.updateMany({ where: { qualityInspection: { lotId: lotA.heatId } }, data: { measuredValue: '0.1900' } });
    await prisma.customer.update({ where: { id: customerId }, data: { customerName: '변경된 고객사' } });
    try {
      await expect(service.findMillSheet(sheet.id)).resolves.toEqual(detail);
    } finally {
      await prisma.customer.update({ where: { id: customerId }, data: { customerName: detail.snapshot.customer.customerName } });
    }
  });

  it('출하요청 목록·상세에서 ISSUED로 보이고 출고 확정 후에는 배정이 CONSUMED로 보인다', async () => {
    const so = await salesOrder(1);
    const request = await shipmentRequest([{ salesOrderItemId: so.salesOrderItemId, requestQty: 1 }]);
    await service.issue(logistics, request.id);
    const detail = await service.findOne(logistics, request.id);
    expect(detail.items[0].allocations.map((a) => a.allocationStatus)).toEqual([ALLOCATION_STATUS.CONSUMED]);
    expect(detail.items[0].unallocatedQty).toBe(0);
  });
});
