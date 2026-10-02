import { Test } from '@nestjs/testing';
import { ALLOCATION_PURPOSE, ALLOCATION_STATUS, BUSINESS_EVENT_TYPE, ITEM_TYPE, LOT_TYPE, PROCESS_TYPE, SALES_ORDER_ITEM_STATUS, SHIPMENT_REQUEST_STATUS, type AuthUser } from '@fantasteel/shared';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { CommonModule } from '../../common/common.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { ShipmentModule } from './shipment.module';
import { ShipmentService } from './shipment.service';

// 실제 DB(fs_sales)에 수주·예약을 직접 넣고 서비스를 부른다. 시드에는 거래 데이터가 없다 (seed.md)
describe('ShipmentService 출하요청 (REQ-SHP-001)', () => {
  let prisma: PrismaService;
  let service: ShipmentService;
  let sales: AuthUser;
  let logistics: AuthUser;
  let production: AuthUser;
  let customerA: number;
  let customerB: number;
  let slabItemId: number;
  let seq = 0;

  const loadUser = async (authUsers: AuthUserService, employeeNo: string) => {
    const e = await prisma.employee.findUniqueOrThrow({ where: { employeeNo } });
    const user = await authUsers.load(e.id);
    if (!user) throw new Error(`사원 ${employeeNo} 없음`);
    return user;
  };

  /** 수주 1건 + 품목 1개 + ACTIVE 예약 */
  const salesOrderItem = async (customerId: number, reservedQty: number, status: string = SALES_ORDER_ITEM_STATUS.OPEN) => {
    seq += 1;
    const salesOrder = await prisma.salesOrder.create({
      data: {
        salesOrderNo: `SO-TEST-${String(seq).padStart(3, '0')}`,
        customerId,
        ownerEmployeeId: sales.employeeId,
        salesOrderItems: { create: { itemId: slabItemId, orderedQty: 20, dueDate: new Date('2026-12-31T00:00:00.000Z'), salesOrderItemStatus: status } },
      },
      select: { id: true, salesOrderItems: { select: { id: true } } },
    });
    const salesOrderItemId = salesOrder.salesOrderItems[0].id;
    if (reservedQty > 0) await prisma.reservation.create({ data: { salesOrderItemId, itemId: slabItemId, reservedQty } });
    return { salesOrderId: salesOrder.id, salesOrderItemId };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PrismaModule, CommonModule, ShipmentModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(ShipmentService);
    const authUsers = moduleRef.get(AuthUserService);
    sales = await loadUser(authUsers, '2103003');
    logistics = await loadUser(authUsers, '2304015');
    production = await loadUser(authUsers, '2402011');
    customerA = (await prisma.customer.findUniqueOrThrow({ where: { customerCode: 'CUS-01' } })).id;
    customerB = (await prisma.customer.findUniqueOrThrow({ where: { customerCode: 'CUS-02' } })).id;
    slabItemId = (await prisma.item.findFirstOrThrow({ where: { itemType: ITEM_TYPE.SLAB }, orderBy: { id: 'asc' } })).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('여러 수주 품목을 묶어 등록하면 배정 대기(REQUESTED)로 만들고 수주마다 작업 로그를 남긴다', async () => {
    const a = await salesOrderItem(customerA, 10);
    const b = await salesOrderItem(customerA, 5);

    const created = await service.create(sales, {
      customerId: customerA,
      shipDate: '2026-10-20',
      items: [
        { salesOrderItemId: a.salesOrderItemId, requestQty: 4 },
        { salesOrderItemId: b.salesOrderItemId, requestQty: 5 },
      ],
    });

    expect(created.shipmentRequestNo).toMatch(/^DR-\d{4}-\d{4}$/);
    expect(created.shipmentRequestStatus).toBe(SHIPMENT_REQUEST_STATUS.REQUESTED);
    expect(created.shipDate).toBe('2026-10-20');
    expect(created.totalRequestQty).toBe(9);
    expect(created.items.map((i) => [i.salesOrderItemId, i.requestQty, i.unallocatedQty])).toEqual([
      [a.salesOrderItemId, 4, 4],
      [b.salesOrderItemId, 5, 5],
    ]);

    const events = await prisma.businessEvent.findMany({
      where: { businessEventType: BUSINESS_EVENT_TYPE.SHIPMENT_REQUEST_CREATED, targetId: created.id },
      orderBy: { salesOrderId: 'asc' },
    });
    expect(events.map((e) => e.salesOrderId)).toEqual([a.salesOrderId, b.salesOrderId]);
    expect(events.every((e) => e.actorEmployeeId === sales.employeeId)).toBe(true);
  });

  it('출하 가능 매수(ACTIVE 예약 − 진행 중 출하요청)를 넘으면 SHP-002, 취소된 요청 매수는 다시 쓸 수 있다', async () => {
    const a = await salesOrderItem(customerA, 10);
    const first = await service.create(sales, { customerId: customerA, items: [{ salesOrderItemId: a.salesOrderItemId, requestQty: 8 }] });

    await expect(
      service.create(sales, { customerId: customerA, items: [{ salesOrderItemId: a.salesOrderItemId, requestQty: 3 }] }),
    ).rejects.toMatchObject({ code: 'SHP-002' });
    await expect(
      service.create(sales, { customerId: customerA, items: [{ salesOrderItemId: a.salesOrderItemId, requestQty: 2 }] }),
    ).resolves.toMatchObject({ totalRequestQty: 2 });

    await prisma.shipmentRequest.update({ where: { id: first.id }, data: { shipmentRequestStatus: SHIPMENT_REQUEST_STATUS.CANCELLED } });
    await expect(
      service.create(sales, { customerId: customerA, items: [{ salesOrderItemId: a.salesOrderItemId, requestQty: 8 }] }),
    ).resolves.toMatchObject({ totalRequestQty: 8 });
  });

  it('예약이 없는 품목은 출하 가능 매수가 0이라 SHP-002', async () => {
    const a = await salesOrderItem(customerA, 0);
    await expect(
      service.create(sales, { customerId: customerA, items: [{ salesOrderItemId: a.salesOrderItemId, requestQty: 1 }] }),
    ).rejects.toMatchObject({ code: 'SHP-002' });
  });

  it('다른 고객사 수주 품목을 묶으면 거부한다', async () => {
    const a = await salesOrderItem(customerA, 5);
    const b = await salesOrderItem(customerB, 5);
    await expect(
      service.create(sales, {
        customerId: customerA,
        items: [
          { salesOrderItemId: a.salesOrderItemId, requestQty: 1 },
          { salesOrderItemId: b.salesOrderItemId, requestQty: 1 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'COM-004' });
  });

  it('취소된 수주 품목·없는 품목·같은 품목 두 줄은 거부한다', async () => {
    const cancelled = await salesOrderItem(customerA, 5, SALES_ORDER_ITEM_STATUS.CANCELLED);
    const ok = await salesOrderItem(customerA, 5);
    await expect(
      service.create(sales, { customerId: customerA, items: [{ salesOrderItemId: cancelled.salesOrderItemId, requestQty: 1 }] }),
    ).rejects.toMatchObject({ code: 'SHP-002' });
    await expect(
      service.create(sales, { customerId: customerA, items: [{ salesOrderItemId: 999999, requestQty: 1 }] }),
    ).rejects.toMatchObject({ code: 'COM-003' });
    await expect(
      service.create(sales, {
        customerId: customerA,
        items: [
          { salesOrderItemId: ok.salesOrderItemId, requestQty: 1 },
          { salesOrderItemId: ok.salesOrderItemId, requestQty: 1 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'COM-004' });
  });

  it('같은 품목을 동시에 요청해도 출하 가능 매수를 넘겨 받아 주지 않는다', async () => {
    const a = await salesOrderItem(customerA, 10);
    const results = await Promise.allSettled([
      service.create(sales, { customerId: customerA, items: [{ salesOrderItemId: a.salesOrderItemId, requestQty: 6 }] }),
      service.create(sales, { customerId: customerA, items: [{ salesOrderItemId: a.salesOrderItemId, requestQty: 6 }] }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected?.reason).toMatchObject({ code: 'SHP-002' });
  });

  it('목록·상세는 영업·물류가 볼 수 있고, 권한이 없으면 COM-002', async () => {
    const a = await salesOrderItem(customerB, 3);
    const created = await service.create(sales, { customerId: customerB, items: [{ salesOrderItemId: a.salesOrderItemId, requestQty: 3 }] });

    const page = await service.list(logistics, { customerId: customerB, page: 1, size: 20 });
    expect(page.items.map((r) => r.id)).toContain(created.id);
    expect(page.items.every((r) => r.customerId === customerB)).toBe(true);
    await expect(service.findOne(logistics, created.id)).resolves.toMatchObject({ customerName: '나래조선' });

    await expect(service.list(production, { page: 1, size: 20 })).rejects.toMatchObject({ code: 'COM-002' });
    await expect(service.findOne(production, created.id)).rejects.toMatchObject({ code: 'COM-002' });
    await expect(service.findOne(logistics, 999999)).rejects.toMatchObject({ code: 'COM-003' });
  });

  it('refreshAllocationStatus: 모든 품목 미배정 0이면 ALLOCATED, 배정이 풀리면 REQUESTED', async () => {
    const a = await salesOrderItem(customerA, 2);
    const created = await service.create(sales, { customerId: customerA, items: [{ salesOrderItemId: a.salesOrderItemId, requestQty: 2 }] });
    const shipmentRequestItemId = created.items[0].id;
    // 슬래브 LOT은 연주 실적과 생산완료일이 있어야 한다 (lot_type_columns_check)
    const castingResult = await prisma.productionResult.create({
      data: { processType: PROCESS_TYPE.CONTINUOUS_CASTING, startedAt: new Date(), completedAt: new Date() },
    });
    const allocationIds: number[] = [];
    for (const n of [1, 2]) {
      const lot = await prisma.lot.create({
        data: {
          lotNo: `SL-TEST-${created.id}-${n}`,
          lotType: LOT_TYPE.SLAB,
          itemId: slabItemId,
          productionResultId: castingResult.id,
          producedDate: new Date('2026-10-01T00:00:00.000Z'),
        },
      });
      const allocation = await prisma.allocation.create({
        data: { lotId: lot.id, allocationPurpose: ALLOCATION_PURPOSE.SHIPMENT, shipmentRequestItemId, allocationStatus: ALLOCATION_STATUS.CONFIRMED },
      });
      allocationIds.push(allocation.id);
    }

    await expect(prisma.$transaction((tx) => service.refreshAllocationStatus(tx, created.id))).resolves.toBe(SHIPMENT_REQUEST_STATUS.ALLOCATED);
    await expect(service.findOne(logistics, created.id)).resolves.toMatchObject({
      shipmentRequestStatus: SHIPMENT_REQUEST_STATUS.ALLOCATED,
      items: [expect.objectContaining({ unallocatedQty: 0 })],
    });

    await prisma.allocation.update({ where: { id: allocationIds[0] }, data: { allocationStatus: ALLOCATION_STATUS.RELEASED } });
    await expect(prisma.$transaction((tx) => service.refreshAllocationStatus(tx, created.id))).resolves.toBe(SHIPMENT_REQUEST_STATUS.REQUESTED);

    await prisma.shipmentRequest.update({ where: { id: created.id }, data: { shipmentRequestStatus: SHIPMENT_REQUEST_STATUS.CANCELLED } });
    await expect(prisma.$transaction((tx) => service.refreshAllocationStatus(tx, created.id))).resolves.toBe(SHIPMENT_REQUEST_STATUS.CANCELLED);
  });
});
