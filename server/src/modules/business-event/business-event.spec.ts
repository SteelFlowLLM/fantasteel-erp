import type { AuthUser } from '@fantasteel/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { RealtimeService } from '../../common/realtime/realtime.service';
import { LotGraphService } from '../lot/lot-graph.service';
import { LotRepository } from '../lot/lot.repository';
import { cleanupTag, connectTestDb, createGenealogy, newTag, type Genealogy } from '../lot/testing/genealogy.fixture';
import { BusinessEventRecorder } from './business-event.recorder';
import { BusinessEventRepository } from './business-event.repository';
import { BusinessEventService, parseBoundary } from './business-event.service';

describe('작업 로그 조회 (REQ-LOG-003 Decision Replay)', () => {
  let prisma: PrismaService;
  let service: BusinessEventService;
  let recorder: BusinessEventRecorder;
  let g: Genealogy;
  let tag: string;
  let salesOrderId: number;
  let employeeId: number;
  const T0 = Date.parse('2026-01-15T03:00:00Z');
  const at = (sec: number) => new Date(T0 + sec * 1000);

  const create = (data: { summary: string; occurredAt: Date; lotIds?: number[]; salesOrderId?: number; eventType?: string; actorEmployeeId?: number; targetNo?: string }) =>
    prisma.businessEvent.create({
      data: {
        actorType: data.actorEmployeeId ? 'USER' : 'SYSTEM',
        actorEmployeeId: data.actorEmployeeId ?? null,
        eventType: data.eventType ?? 'RESULT_REGISTERED',
        targetType: 'LOT',
        targetNo: data.targetNo ?? null,
        salesOrderId: data.salesOrderId ?? null,
        lotIds: data.lotIds ?? [],
        summary: `${tag} ${data.summary}`,
        occurredAt: data.occurredAt,
      },
    });

  beforeAll(async () => {
    prisma = connectTestDb();
    await prisma.onModuleInit();
    const repo = new LotRepository();
    service = new BusinessEventService(prisma, new BusinessEventRepository(), new LotGraphService(repo));
    recorder = new BusinessEventRecorder({ changed: () => undefined } as unknown as RealtimeService);
    tag = newTag();
    g = await createGenealogy(prisma, tag);
    const emp = await prisma.employee.findFirstOrThrow({ where: { employeeNo: '1803021' }, include: { department: true } });
    employeeId = emp.id;
    const so = await prisma.salesOrder.create({
      data: { salesOrderNo: `SO-${tag}`, customerId: (await prisma.customer.findFirstOrThrow()).id, dueDate: new Date('2026-02-01'), ownerEmployeeId: emp.id },
    });
    salesOrderId = so.id;

    // 시각 순서와 id 순서를 일부러 다르게 만든다: 나중에 만든 것이 더 이른 시각. 같은 시각 2건은 id 순.
    await create({ summary: 'E3 늦은 시각', occurredAt: at(30), lotIds: [g.heatId], salesOrderId });
    await create({ summary: 'E1 이른 시각', occurredAt: at(10), lotIds: [g.heatId, g.slabAId], salesOrderId, actorEmployeeId: employeeId, targetNo: g.tag });
    await create({ summary: 'E2a 같은 시각 먼저', occurredAt: at(20), lotIds: [g.slabAId] });
    await create({ summary: 'E2b 같은 시각 나중', occurredAt: at(20), lotIds: [g.slabBId] });
    await create({ summary: 'E4 원료 LOT', occurredAt: at(5), lotIds: [g.rawLotId] });
    await create({ summary: 'E5 코일 LOT', occurredAt: at(40), lotIds: [g.coilId], eventType: 'INSPECTION_REGISTERED' });
  });

  afterAll(async () => {
    await cleanupTag(prisma, tag);
    await prisma.onModuleDestroy();
  });

  const summaries = (r: { items: { summary: string }[] }) => r.items.map((i) => i.summary.replace(`${tag} `, '').split(' ')[0]);

  it('수주 타임라인은 발생 시각 → id 오름차순', async () => {
    const r = await service.list({ salesOrderId });
    expect(r.order).toBe('asc');
    expect(summaries(r)).toEqual(['E1', 'E3']);
  });

  it('LOT 타임라인: lot_ids에 그 LOT이 들어 있는 이벤트만, 시간순, 같은 시각은 id 순', async () => {
    const r = await service.list({ lotId: g.slabAId });
    expect(summaries(r)).toEqual(['E1', 'E2a']);
    expect(r.items.every((i) => i.lotIds.includes(g.slabAId))).toBe(true);
    expect(r.items[0].lots.map((l) => l.lotNo)).toEqual(expect.arrayContaining([`${tag}-HT`, `${tag}-HT-01`]));
    expect(r.items[0].isLineageOnly).toBe(false);
  });

  it('includeLineage: 조상·자손 LOT의 이벤트가 함께 나오고 형제 LOT은 빠진다', async () => {
    const r = await service.list({ lotId: g.slabAId, includeLineage: true });
    // 슬래브 A의 조상(히트·용선·원료)과 자손(코일). 형제 슬래브 B(E2b)는 제외
    expect(summaries(r)).toEqual(['E4', 'E1', 'E2a', 'E3', 'E5']);
    expect(r.items.filter((i) => i.isLineageOnly).map((i) => i.summary.replace(`${tag} `, '').split(' ')[0])).toEqual(['E4', 'E3', 'E5']);
  });

  it('최근 목록은 내림차순(desc), 명시하면 시간순 정렬을 바꿀 수 있다', async () => {
    const recent = await service.list({ q: tag, limit: 100 });
    expect(recent.order).toBe('desc');
    expect(summaries(recent)).toEqual(['E5', 'E3', 'E2b', 'E2a', 'E1', 'E4']);
    const asc = await service.list({ q: tag, order: 'asc' });
    expect(summaries(asc)).toEqual(['E4', 'E1', 'E2a', 'E2b', 'E3', 'E5']);
  });

  it('필터: 이벤트 유형·주체·기간(날짜만 주면 한국 시간 하루)', async () => {
    expect(summaries(await service.list({ q: tag, eventType: 'INSPECTION_REGISTERED' }))).toEqual(['E5']);
    const userOnly = await service.list({ q: tag, actorType: 'USER' });
    expect(summaries(userOnly)).toEqual(['E1']);
    expect(userOnly.items[0].actor).toMatchObject({ employeeName: '박생산', departmentName: '생산부' });
    expect(userOnly.items[0].eventTypeLabel).toBe('실적');
    const system = await service.list({ q: tag, actorType: 'SYSTEM', limit: 100 });
    expect(system.items[0].actorLabel).toBe('시스템');
    expect(system.items[0].actor).toBeNull();

    // 2026-01-15T03:00Z = 한국 12:00 → 2026-01-15 하루에 모두 들어가고 2026-01-14 에는 없다
    expect((await service.list({ q: tag, from: '2026-01-15', to: '2026-01-15' })).items).toHaveLength(6);
    expect((await service.list({ q: tag, from: '2026-01-14', to: '2026-01-14' })).items).toHaveLength(0);
    const ranged = await service.list({ q: tag, from: at(15).toISOString(), to: at(30).toISOString(), order: 'asc' });
    expect(summaries(ranged)).toEqual(['E2a', 'E2b', 'E3']);
  });

  it('커서 페이지 나누기: 중복·누락 없이 이어진다', async () => {
    const seen: string[] = [];
    let cursor: number | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await service.list({ q: tag, order: 'asc', limit: 4, cursor });
      seen.push(...summaries(page));
      if (!page.hasMore) {
        expect(page.nextCursor).toBeNull();
        break;
      }
      expect(page.items).toHaveLength(4);
      cursor = page.nextCursor!;
    }
    expect(seen).toEqual(['E4', 'E1', 'E2a', 'E2b', 'E3', 'E5']);
  });

  it('기록기(record)로 남긴 이벤트가 lot_ids·수주로 조회되고 before/after·AI 경유·사유가 그대로 나온다', async () => {
    const user: AuthUser = { employeeId, employeeNo: '1803021', employeeName: '박생산', roleCode: 'PRODUCTION', departmentId: 1, departmentName: '생산부', jobGrade: '과장', headDepartmentIds: [], permissions: {} };
    await prisma.tx((tx) =>
      recorder.record(tx, {
        actor: user,
        eventType: 'ALLOCATION_CONFIRMED',
        targetType: 'ALLOCATION',
        targetId: 1,
        targetNo: `${tag}-ALLOC`,
        salesOrderId,
        lotIds: [g.slabBId, g.slabBId],
        summary: `${tag} 배정 확정`,
        before: { status: null },
        after: { status: 'CONFIRMED' },
        reasonCode: 'FIFO_RECOMMENDATION',
        reason: 'FIFO 추천 그대로 확정',
        isAiAssisted: true,
      }),
    );
    const r = await service.list({ lotId: g.slabBId, eventType: 'ALLOCATION_CONFIRMED' });
    expect(r.items).toHaveLength(1);
    const e = r.items[0];
    expect(e).toMatchObject({
      eventTypeLabel: '배정 확정',
      actorLabel: '박생산',
      salesOrderNo: `SO-${tag}`,
      lotIds: [g.slabBId],
      before: { status: null },
      after: { status: 'CONFIRMED' },
      reasonCode: 'FIFO_RECOMMENDATION',
      reason: 'FIFO 추천 그대로 확정',
      isAiAssisted: true,
    });
    expect((await service.getById(e.id)).id).toBe(e.id);
    await expect(service.getById(2_000_000_000)).rejects.toMatchObject({ code: 'COM-004' });
  });

  it('날짜 경계 해석', () => {
    expect(parseBoundary('2026-01-15', 'from').toISOString()).toBe('2026-01-14T15:00:00.000Z');
    expect(parseBoundary('2026-01-15', 'to').toISOString()).toBe('2026-01-15T14:59:59.999Z');
    expect(parseBoundary('2026-01-15T00:00:00Z', 'to').toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });
});
