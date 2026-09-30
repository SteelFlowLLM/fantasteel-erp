import { PrismaService } from '../../prisma/prisma.service';
import { LotGraphService, detectCycle } from './lot-graph.service';
import { LotTraceService } from './lot-trace.service';
import { LotRepository } from './lot.repository';
import { LotService } from './lot.service';
import { cleanupTag, connectTestDb, createGenealogy, createShipment, newTag, type Genealogy } from './testing/genealogy.fixture';

describe('LOT 정·역추적 (BP-LOT-01, REQ-LOT-005)', () => {
  let prisma: PrismaService;
  let trace: LotTraceService;
  let lots: LotService;
  const tags: string[] = [];

  beforeAll(async () => {
    prisma = connectTestDb();
    await prisma.onModuleInit();
    const repo = new LotRepository();
    trace = new LotTraceService(prisma, repo, new LotGraphService(repo));
    lots = new LotService(prisma, repo);
  });

  afterAll(async () => {
    for (const t of tags) await cleanupTag(prisma, t);
    await prisma.onModuleDestroy();
  });

  async function make(): Promise<Genealogy> {
    const tag = newTag();
    tags.push(tag);
    return createGenealogy(prisma, tag);
  }

  it('시드 코일에서 역추적하면 슬래브·히트·용선과 원료 3종 + 합금철 2종에 닿는다', async () => {
    const coil = await prisma.lot.findFirstOrThrow({ where: { lotType: 'COIL', lotNo: { not: { contains: 'TST' } } }, orderBy: { id: 'asc' } });
    const res = await trace.trace(coil.id, 'backward');

    const byType = (t: string) => res.nodes.filter((n) => n.lotType === t);
    expect(res.summary.countByType).toEqual({ COIL: 1, SLAB: 1, HEAT: 1, HOT_METAL: 1, RAW_MATERIAL: 5 });
    expect(res.nodes.find((n) => n.isRoot)?.id).toBe(coil.id);
    expect(res.levels.map((l) => l.lotType)).toEqual(['RAW_MATERIAL', 'HOT_METAL', 'HEAT', 'SLAB', 'COIL']);

    const slab = byType('SLAB')[0];
    const heat = byType('HEAT')[0];
    const hm = byType('HOT_METAL')[0];
    const edge = (p: number, c: number) => res.edges.find((e) => e.parentId === p && e.childId === c);
    expect(edge(slab.id, coil.id)?.relationType).toBe('SLAB_TO_COIL');
    expect(edge(heat.id, slab.id)?.relationType).toBe('HEAT_TO_SLAB');
    expect(edge(hm.id, heat.id)?.relationType).toBe('HOT_METAL_TO_HEAT');

    const raws = byType('RAW_MATERIAL');
    expect(raws.filter((r) => r.rawMaterialType === 'FERROALLOY')).toHaveLength(2);
    // 합금철은 히트에 직접, 철광석·석탄·석회석은 용선에 기간 기반으로 연결
    for (const r of raws) {
      const e = res.edges.find((x) => x.parentId === r.id)!;
      if (r.rawMaterialType === 'FERROALLOY') {
        expect(e).toMatchObject({ childId: heat.id, relationType: 'ALLOY_TO_HEAT', evidenceType: 'DIRECT', isPeriodBased: false });
      } else {
        expect(e).toMatchObject({ childId: hm.id, relationType: 'RAW_TO_HOT_METAL', evidenceType: 'PERIOD', isPeriodBased: true });
        expect(e.periodStart).toBeInstanceOf(Date);
        expect(e.periodEnd).toBeInstanceOf(Date);
      }
    }
    expect(res.summary.hasPeriodEvidence).toBe(true);
    expect(res.summary.hasCycle).toBe(false);
    expect(res.impact).toBeNull();
    expect(heat.isPassed).toBe(true);
    expect(heat.inspection?.result).toBe('PASS');
  });

  it('시드 히트에서 정추적하면 그 히트의 슬래브와 코일이 모두 나온다', async () => {
    const heat = await prisma.lot.findFirstOrThrow({ where: { lotType: 'HEAT', lotNo: { not: { contains: 'TST' } } }, orderBy: { id: 'asc' } });
    const slabs = await prisma.lot.findMany({ where: { heatLotId: heat.id, lotType: 'SLAB' }, select: { id: true } });
    const coils = await prisma.lot.findMany({ where: { heatLotId: heat.id, lotType: 'COIL' }, select: { id: true } });
    expect(slabs.length).toBeGreaterThan(0);
    expect(coils.length).toBeGreaterThan(0);

    const res = await trace.trace(heat.id, 'forward');
    const ids = new Set(res.nodes.map((n) => n.id));
    for (const l of [...slabs, ...coils]) expect(ids.has(l.id)).toBe(true);
    expect(res.summary.countByType).toEqual({ HEAT: 1, SLAB: slabs.length, COIL: coils.length });
    // 히트 → 슬래브 1:N, 슬래브 → 코일 1:1
    const slabToCoil = res.edges.filter((e) => e.relationType === 'SLAB_TO_COIL');
    expect(slabToCoil).toHaveLength(coils.length);
    expect(new Set(slabToCoil.map((e) => e.parentId)).size).toBe(coils.length);
    expect(res.edges.filter((e) => e.relationType === 'HEAT_TO_SLAB')).toHaveLength(slabs.length);
    expect(res.impact?.shippedProductLotCount).toBe(0);
  });

  it('원료 LOT에서 정추적하면 용선·히트·슬래브·코일과 출하(출고번호·밀시트·고객사)까지 닿는다', async () => {
    const g = await make();
    const ship = await createShipment(prisma, g);
    const res = await trace.trace(g.rawLotId, 'forward');

    expect(res.summary.countByType).toEqual({ RAW_MATERIAL: 1, HOT_METAL: 1, HEAT: 1, SLAB: 2, COIL: 1 });
    // 슬래브 B는 코일 단계 없이 슬래브로 출하, 코일은 코일로 출하
    const slabB = res.nodes.find((n) => n.id === g.slabBId)!;
    const coil = res.nodes.find((n) => n.id === g.coilId)!;
    expect(slabB.shipment).toMatchObject({ goodsIssueNo: ship.goodsIssueNo, shipmentRequestNo: ship.shipmentRequestNo, customerName: ship.customerName, millSheetNos: [ship.millSheetNo], lineNo: 1 });
    expect(coil.shipment).toMatchObject({ goodsIssueNo: ship.goodsIssueNo, lineNo: 2 });
    expect(coil.salesOrderLinks.map((l) => l.linkType)).toContain('SHIPPED');
    expect(res.nodes.find((n) => n.id === g.slabAId)!.shipment).toBeNull();

    expect(res.impact?.shippedProductLotCount).toBe(2);
    expect(res.impact?.unshippedProductLotCount).toBe(1);
    expect(res.impact?.shipments).toHaveLength(1);
    expect(res.impact?.shipments[0]).toMatchObject({ goodsIssueNo: ship.goodsIssueNo, customerName: ship.customerName, millSheetNos: [ship.millSheetNo] });
    expect(res.impact?.shipments[0].lotNos.sort()).toEqual([coil.lotNo, slabB.lotNo].sort());
    expect(res.impact?.salesOrders).toEqual([expect.objectContaining({ salesOrderNo: ship.salesOrderNo, hasShipped: true, lotCount: 2 })]);
    // 원료 → 용선은 기간 기반으로 표시
    expect(res.edges.find((e) => e.parentId === g.rawLotId)).toMatchObject({ evidenceType: 'PERIOD', isPeriodBased: true });

    // 출하된 코일에서 역추적해도 출고 정보가 루트 노드에 붙는다
    const back = await trace.trace(g.coilId, 'backward');
    expect(back.nodes.find((n) => n.isRoot)?.shipment?.goodsIssueNo).toBe(ship.goodsIssueNo);
    expect(back.summary.countByType).toEqual({ COIL: 1, SLAB: 1, HEAT: 1, HOT_METAL: 1, RAW_MATERIAL: 1 });
  });

  it('순환 연결이 있어도 무한 반복하지 않고 hasCycle을 알린다', async () => {
    const g = await make();
    // 코일 → 원료 (비정상 연결)
    await prisma.lotRelation.create({ data: { parentLotId: g.coilId, childLotId: g.rawLotId, relationType: 'RAW_TO_HOT_METAL', evidenceType: 'DIRECT' } });
    // 자기 연결
    await prisma.lotRelation.create({ data: { parentLotId: g.slabBId, childLotId: g.slabBId, relationType: 'HEAT_TO_SLAB', evidenceType: 'DIRECT' } });

    const fwd = await trace.trace(g.rawLotId, 'forward');
    const back = await trace.trace(g.coilId, 'backward');
    for (const res of [fwd, back]) {
      expect(res.summary.hasCycle).toBe(true);
      expect(res.summary.truncated).toBe(false);
      expect(new Set(res.nodes.map((n) => n.id)).size).toBe(res.nodes.length);
    }
    expect(fwd.summary.countByType).toEqual({ RAW_MATERIAL: 1, HOT_METAL: 1, HEAT: 1, SLAB: 2, COIL: 1 });
  });

  it('순환 판정 함수: 정상 그래프(합류 포함)는 순환이 아니다', () => {
    const rel = (parentLotId: number, childLotId: number) => ({ parentLotId, childLotId });
    expect(detectCycle([1, 2, 3, 4], [rel(1, 2), rel(1, 3), rel(2, 4), rel(3, 4)])).toBe(false);
    expect(detectCycle([1, 2, 3], [rel(1, 2), rel(2, 3), rel(3, 1)])).toBe(true);
    expect(detectCycle([1], [rel(1, 1)])).toBe(true);
  });

  it('LOT 상세: 이론중량 계산값·검사 요약·적격/여재 표시', async () => {
    const coil = await prisma.lot.findFirstOrThrow({ where: { lotType: 'COIL', lotNo: { not: { contains: 'TST' } } }, orderBy: { id: 'asc' }, include: { productSpec: true } });
    const view = await lots.getById(coil.id);
    expect(view.weightTon).toBe(coil.productSpec!.theoreticalWeightTon.toFixed(3));
    expect(view.inspection?.result).toBe('PASS');
    expect(view.inspection?.itemCount).toBeGreaterThan(0);
    expect(view.inspection?.failedItemCount).toBe(0);
    expect(view.isEligible).toBe(true);
    expect(view.isSurplus).toBeNull();
    expect(view.parents.map((p) => p.lotType)).toEqual(['SLAB']);
    expect(view.heat?.isPassed).toBe(true);

    const raw = await lots.getByNo((await prisma.lot.findFirstOrThrow({ where: { lotType: 'RAW_MATERIAL', lotNo: { not: { contains: 'TST' } } } })).lotNo);
    expect(raw.weightTon).toBeNull();
    expect(raw.initialTon).not.toBeNull();
    expect(raw.rawMaterial?.materialName).toBeTruthy();
  });

  it('LOT 상세: 현재 배정(CONFIRMED)·연결 수주 품목·불합격 처리 상태', async () => {
    const g = await make();
    const ship = await createShipment(prisma, g);
    const item = await prisma.salesOrderItem.findFirstOrThrow({ where: { salesOrderId: ship.salesOrderId, lineNo: 1 } });
    const req = await prisma.shipmentRequestItem.findFirstOrThrow({ where: { salesOrderItemId: item.id } });
    await prisma.lot.update({ where: { id: g.slabAId }, data: { isPassed: true, salesOrderItemId: item.id } });
    await prisma.allocation.create({ data: { lotId: g.slabAId, purpose: 'SHIPMENT', salesOrderItemId: item.id, shipmentRequestItemId: req.id, status: 'CONFIRMED' } });
    // 이미 소진된(CONSUMED) 배정은 "현재 배정"이 아니다
    await prisma.allocation.create({ data: { lotId: g.slabAId, purpose: 'ROLLING', status: 'CONSUMED' } });

    const view = await lots.getById(g.slabAId);
    expect(view.allocation).toMatchObject({ purpose: 'SHIPMENT', purposeLabel: '출하', status: 'CONFIRMED', salesOrderNo: ship.salesOrderNo, lineNo: 1, shipmentRequestNo: ship.shipmentRequestNo });
    expect(view.salesOrderItem).toMatchObject({ salesOrderNo: ship.salesOrderNo, lineNo: 1, customerName: ship.customerName });
    expect(view.isEligible).toBe(true);
    expect(view.isSurplus).toBe(false); // 수주에 귀속·배정됨

    await prisma.lot.update({ where: { id: g.slabBId }, data: { isPassed: false, dispositionStatus: 'HOLD', dispositionReason: '표면 결함', dispositionAt: new Date() } });
    const held = await lots.getById(g.slabBId);
    expect(held.disposition).toMatchObject({ status: 'HOLD', statusLabel: '보류', reason: '표면 결함' });
    expect(held.inspectionResult).toBe('FAIL');
    expect(held.isEligible).toBe(false);

    // 추적 노드에도 배정 연결이 나온다 (정추적)
    const res = await trace.trace(g.slabAId, 'forward');
    const node = res.nodes.find((n) => n.id === g.slabAId)!;
    expect(node.salesOrderLinks.map((l) => l.linkType).sort()).toEqual(['ALLOCATED', 'PRODUCED_FOR']);
  });

  it('목록 필터와 번호 일부 검색', async () => {
    const g = await make();
    const list = await lots.list({ lotType: 'SLAB', q: g.tag, limit: 10 });
    expect(list.total).toBe(2);
    expect(list.items.every((l) => l.lotType === 'SLAB')).toBe(true);
    const found = await lots.search(g.tag.toLowerCase());
    expect(found.map((f) => f.lotNo)).toEqual(expect.arrayContaining([`${g.tag}-HT`, `${g.tag}-RM`]));
    expect(await lots.search('   ')).toEqual([]);
    // LIKE 특수문자는 글자 그대로 찾는다 (% · _ 가 모든 LOT에 맞으면 안 된다)
    expect(await lots.search('%')).toEqual([]);
    expect((await lots.list({ q: '_' })).total).toBe(0);
    expect((await lots.list({ q: `${g.tag.slice(0, 5)}_` })).total).toBe(0);
    const surplus = await lots.getById(g.slabAId);
    // 히트 합격이지만 슬래브 검사 전이라 적격이 아니다
    expect(surplus.isEligible).toBe(false);
    expect(surplus.isSurplus).toBe(false);
  });
});
