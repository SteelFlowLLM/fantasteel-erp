import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ACTOR_TYPE, BUSINESS_EVENT_SORT, BUSINESS_EVENT_TYPE, BUSINESS_EVENT_TYPE_LABEL, LOT_TYPE, PROCESS_TYPE } from '@fantasteel/shared';
import { CommonModule } from '../../common/common.module';
import { BusinessEventRecorder } from '../../common/business-event/business-event.recorder';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessEventModule } from './business-event.module';
import { BusinessEventService } from './business-event.service';
import { ListBusinessEventsQuery } from './dto/list-business-events.query';

// 실제 DB(fs_log)에 이벤트를 직접 만들고 조회 조건·정렬·표시 값을 확인한다.
// 같은 묶음의 다른 테스트 데이터와 섞이지 않도록 발생 시각을 2020-01(서울)로 두고 기간 조건으로 가둔다.
describe('BusinessEventService 작업 로그 조회 (API-238, REQ-LOG-003)', () => {
  let prisma: PrismaService;
  let service: BusinessEventService;
  let recorder: BusinessEventRecorder;
  let employee: { id: number; employeeNo: string; employeeName: string };
  let salesOrderId: number;
  let otherSalesOrderId: number;
  let heatId: number;
  let slabId: number;
  let seq = 0;
  const ev: Record<string, number> = {};
  const P = 'BE-';
  const IN_RANGE = { from: '2020-01-01', to: '2020-01-31' };

  /** 이벤트를 발생 시각을 정해 직접 넣는다 (recorder는 now()라 시각을 정할 수 없다) */
  const event = async (
    name: string,
    at: string,
    data: { type?: string; actor?: 'SYSTEM'; salesOrderId?: number | null; lotIds?: number[]; target?: [string, number]; before?: object; after?: object; reason?: string },
  ) => {
    seq += 1;
    const row = await prisma.businessEvent.create({
      data: {
        businessEventNo: `${P}EV-${seq}`,
        businessEventType: data.type ?? BUSINESS_EVENT_TYPE.SALES_ORDER_CREATED,
        actorType: data.actor ?? ACTOR_TYPE.USER,
        actorEmployeeId: data.actor === 'SYSTEM' ? null : employee.id,
        targetType: data.target?.[0] ?? 'sales_order',
        targetId: data.target?.[1] ?? salesOrderId,
        salesOrderId: data.salesOrderId === undefined ? salesOrderId : data.salesOrderId,
        beforeData: data.before,
        afterData: data.after,
        reason: data.reason,
        createdAt: new Date(at),
        businessEventLots: data.lotIds ? { create: data.lotIds.map((lotId) => ({ lotId })) } : undefined,
      },
    });
    ev[name] = row.id;
    return row;
  };

  const list = (query: Partial<ListBusinessEventsQuery>) => service.list({ sort: BUSINESS_EVENT_SORT.ASC, page: 1, size: 20, ...IN_RANGE, ...query });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PrismaModule, CommonModule, BusinessEventModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(BusinessEventService);
    recorder = moduleRef.get(BusinessEventRecorder);
    employee = await prisma.employee.findFirstOrThrow({ orderBy: { id: 'asc' }, select: { id: true, employeeNo: true, employeeName: true } });
    const customer = await prisma.customer.findFirstOrThrow();
    const slabItem = await prisma.item.findFirstOrThrow({ where: { itemType: 'SLAB' }, orderBy: { id: 'asc' } });
    const salesOrder = (no: string) =>
      prisma.salesOrder.create({
        data: { salesOrderNo: `${P}SO-${no}`, customerId: customer.id, ownerEmployeeId: employee.id, salesOrderItems: { create: { itemId: slabItem.id, orderedQty: 1, dueDate: new Date('2020-02-01T00:00:00.000Z') } } },
      });
    salesOrderId = (await salesOrder('1')).id;
    otherSalesOrderId = (await salesOrder('2')).id;
    const steelmaking = await prisma.productionResult.create({ data: { processType: PROCESS_TYPE.STEELMAKING, converterCode: 'BOF1', startedAt: new Date(), completedAt: new Date() } });
    const casting = await prisma.productionResult.create({ data: { processType: PROCESS_TYPE.CONTINUOUS_CASTING, startedAt: new Date(), completedAt: new Date() } });
    heatId = (await prisma.lot.create({ data: { lotNo: `${P}HT-1`, lotType: LOT_TYPE.HEAT, steelGradeId: slabItem.steelGradeId!, productionResultId: steelmaking.id } })).id;
    slabId = (await prisma.lot.create({ data: { lotNo: `${P}SL-1`, lotType: LOT_TYPE.SLAB, itemId: slabItem.id, productionResultId: casting.id, producedDate: new Date('2020-01-05T00:00:00.000Z') } })).id;

    // 서울 2020-01-10 09:00 = UTC 00:00. reserved·inspected는 같은 시각이라 id 순으로 나와야 한다
    await event('created', '2020-01-10T00:00:00.000Z', { after: { salesOrderNo: `${P}SO-1` }, reason: 'STOCK_FIRST: 합격 재고 1매 예약' });
    await event('reserved', '2020-01-10T01:00:00.000Z', { type: BUSINESS_EVENT_TYPE.RESERVATION_CREATED, actor: 'SYSTEM', lotIds: [slabId], target: ['reservation', 1] });
    await event('inspected', '2020-01-10T01:00:00.000Z', { type: BUSINESS_EVENT_TYPE.INSPECTION_REGISTERED, lotIds: [heatId, slabId], target: ['quality_inspection', 1], salesOrderId: null });
    await event('earlier', '2020-01-09T00:00:00.000Z', { salesOrderId: otherSalesOrderId, target: ['sales_order', otherSalesOrderId] });
    // 서울 2020-01-31 23:59 (UTC 14:59) = 기간 끝날 포함, 서울 2020-02-01 00:00(UTC 2020-01-31 15:00) = 다음 날이라 빠진다
    await event('lastMinute', '2020-01-31T14:59:00.000Z', { type: BUSINESS_EVENT_TYPE.DISPOSITION_SET, target: ['lot', slabId], lotIds: [slabId] });
    await event('nextDay', '2020-01-31T15:00:00.000Z', { salesOrderId: otherSalesOrderId });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('수주 타임라인: 그 수주의 이벤트만 발생 시각 → id 순으로, 사원·수주 번호·LOT·유형 표시명을 채운다', async () => {
    const page = await list({ salesOrderId });
    expect(page.items.map((e) => e.id)).toEqual([ev.created, ev.reserved, ev.lastMinute]);
    expect(page.total).toBe(3);
    expect(page.items[0]).toMatchObject({
      businessEventType: BUSINESS_EVENT_TYPE.SALES_ORDER_CREATED,
      businessEventTypeLabel: BUSINESS_EVENT_TYPE_LABEL.SALES_ORDER_CREATED,
      actorType: ACTOR_TYPE.USER,
      actorEmployeeId: employee.id,
      actorEmployeeNo: employee.employeeNo,
      actorEmployeeName: employee.employeeName,
      targetType: 'sales_order',
      targetId: salesOrderId,
      salesOrderNo: `${P}SO-1`,
      afterData: { salesOrderNo: `${P}SO-1` },
      beforeData: null,
      reason: 'STOCK_FIRST: 합격 재고 1매 예약',
      isAiAssisted: false,
      occurredAt: '2020-01-10T00:00:00.000Z',
      lots: [],
    });
    // 시스템 주체는 사원이 없다
    expect(page.items[1]).toMatchObject({ actorType: ACTOR_TYPE.SYSTEM, actorEmployeeId: null, actorEmployeeName: null, lots: [{ lotId: slabId, lotNo: `${P}SL-1`, lotType: LOT_TYPE.SLAB }] });
  });

  it('LOT 타임라인: business_event_lot으로 거르고, 같은 시각이면 이벤트 id 순이다', async () => {
    const page = await list({ lotId: slabId });
    expect(page.items.map((e) => e.id)).toEqual([ev.reserved, ev.inspected, ev.lastMinute]);
    expect(page.items[1].lots.map((l) => l.lotNo)).toEqual([`${P}HT-1`, `${P}SL-1`]);
    expect(page.items[1].salesOrderNo).toBeNull();
    expect((await list({ lotId: heatId })).items.map((e) => e.id)).toEqual([ev.inspected]);
  });

  it('유형·주체·대상 조건', async () => {
    expect((await list({ businessEventType: BUSINESS_EVENT_TYPE.INSPECTION_REGISTERED })).items.map((e) => e.id)).toEqual([ev.inspected]);
    expect((await list({ actorType: ACTOR_TYPE.SYSTEM })).items.map((e) => e.id)).toEqual([ev.reserved]);
    expect((await list({ targetType: 'lot' })).items.map((e) => e.id)).toEqual([ev.lastMinute]);
  });

  it('기간은 서울 날짜로 시작·끝을 포함한다', async () => {
    const all = await list({});
    expect(all.items.map((e) => e.id)).toEqual([ev.earlier, ev.created, ev.reserved, ev.inspected, ev.lastMinute]);
    // 서울 1월 10일 하루 (UTC 1월 9일 15:00 ~ 1월 10일 15:00)
    expect((await list({ from: '2020-01-10', to: '2020-01-10' })).items.map((e) => e.id)).toEqual([ev.created, ev.reserved, ev.inspected]);
    expect((await list({ from: '2020-02-01', to: '2020-02-01' })).items.map((e) => e.id)).toEqual([ev.nextDay]);
  });

  it('sort=desc면 최신순(같은 시각이면 id 큰 것 먼저), 페이징 total은 조건에 맞는 전체 수다', async () => {
    const desc = await list({ sort: BUSINESS_EVENT_SORT.DESC });
    expect(desc.items.map((e) => e.id)).toEqual([ev.lastMinute, ev.inspected, ev.reserved, ev.created, ev.earlier]);
    const second = await list({ sort: BUSINESS_EVENT_SORT.DESC, page: 2, size: 2 });
    expect(second).toMatchObject({ page: 2, size: 2, total: 5 });
    expect(second.items.map((e) => e.id)).toEqual([ev.reserved, ev.created]);
  });

  it('recorder로 남긴 이벤트도 같은 모양으로 읽힌다', async () => {
    const recorded = await prisma.$transaction((tx) =>
      recorder.record(tx, { type: BUSINESS_EVENT_TYPE.SHIPMENT_REQUEST_CREATED, actor: 'SYSTEM', target: { table: 'shipment_request', id: 99 }, salesOrderId: otherSalesOrderId, lotIds: [heatId] }),
    );
    const page = await service.list({ salesOrderId: otherSalesOrderId, targetType: 'shipment_request', sort: BUSINESS_EVENT_SORT.ASC, page: 1, size: 20 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: recorded.id, businessEventNo: recorded.businessEventNo, salesOrderNo: `${P}SO-2`, lots: [{ lotId: heatId, lotNo: `${P}HT-1`, lotType: LOT_TYPE.HEAT }] });
  });

  it('없는 날짜·시작일 > 종료일은 COM-004', async () => {
    await expect(list({ from: '2020-02-30' })).rejects.toMatchObject({ code: 'COM-004' });
    await expect(list({ from: '2020-01-31', to: '2020-01-01' })).rejects.toMatchObject({ code: 'COM-004' });
  });

  it('쿼리 DTO: 형식이 틀리면 검증 오류(COM-004), 생략하면 오래된 순·1쪽·20건', async () => {
    const errorsOf = async (raw: Record<string, string>) => (await validate(plainToInstance(ListBusinessEventsQuery, raw))).map((e) => e.property);
    expect(await errorsOf({ salesOrderId: 'abc', lotId: '0', businessEventType: 'NOPE', actorType: 'ROBOT', targetType: 'Sales-Order', from: '2020/01/01', sort: 'up', size: '101' })).toEqual([
      'salesOrderId',
      'lotId',
      'businessEventType',
      'actorType',
      'targetType',
      'from',
      'sort',
      'size',
    ]);
    const defaults = plainToInstance(ListBusinessEventsQuery, {});
    expect(await errorsOf({})).toEqual([]);
    expect(defaults).toMatchObject({ sort: BUSINESS_EVENT_SORT.ASC, page: 1, size: 20 });
    expect(plainToInstance(ListBusinessEventsQuery, { lotId: '7', page: '2' })).toMatchObject({ lotId: 7, page: 2 });
  });
});
