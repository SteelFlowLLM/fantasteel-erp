import { Test } from '@nestjs/testing';
import {
  ALLOCATION_PURPOSE,
  ALLOCATION_STATUS,
  INSPECTION_RESULT,
  LOT_RELATION_EVIDENCE,
  LOT_STATUS,
  LOT_TYPE,
  PROCESS_TYPE,
  PURCHASE_REQUISITION_STATUS,
  SHIPMENT_REQUEST_STATUS,
} from '@fantasteel/shared';
import { CommonModule } from '../../common/common.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { LotModule } from './lot.module';
import { LotService } from './lot.service';

// 실제 DB(fs_log)에 원료 → 용선 → 히트 → 슬래브 → 코일 계보와 출하를 직접 만들고 조회·추적을 확인한다 (시드에 거래 데이터 없음).
//
//   R1·R2(원료) ─PERIOD_BASED→ H1(용선) ─┐
//   R1        ─PERIOD_BASED→ H2(용선) ─┴→ HT(히트) ←─ A1(합금철 원료, ACTUAL_INPUT)
//   HT → S1(슬래브, 소진) → C1(코일, 출고)        HT → S2(슬래브, 불합격·재고)
describe('LotService LOT 조회·정·역추적 (REQ-LOT-001·005)', () => {
  let prisma: PrismaService;
  let service: LotService;
  const ids: Record<string, number> = {};
  const P = 'LT-';
  let seq = 0;
  let salesOrderId: number;
  let shipmentRequestId: number;
  let millSheetId: number;
  let employeeId: number;
  let standardId: number;

  const rawLot = async (name: string, tonValue: string) => {
    seq += 1;
    const item = await prisma.item.findFirstOrThrow({ where: { itemType: 'RAW_MATERIAL' }, orderBy: { id: 'asc' } });
    const supplier = await prisma.supplier.findFirstOrThrow();
    const yard = await prisma.yard.findFirstOrThrow();
    const order = await prisma.purchaseOrder.create({ data: { purchaseOrderNo: `${P}PO-${seq}`, supplierId: supplier.id } });
    const requisition = await prisma.purchaseRequisition.create({
      data: { purchaseRequisitionNo: `${P}PR-${seq}`, itemId: item.id, requestedTon: tonValue, desiredReceiptDate: new Date('2026-11-30T00:00:00.000Z'), requesterId: employeeId, purchaseRequisitionStatus: PURCHASE_REQUISITION_STATUS.ORDERED },
    });
    const orderItem = await prisma.purchaseOrderItem.create({ data: { purchaseOrderId: order.id, purchaseRequisitionId: requisition.id, itemId: item.id, orderedTon: tonValue } });
    const receipt = await prisma.goodsReceipt.create({ data: { goodsReceiptNo: `${P}GR-${seq}`, purchaseOrderItemId: orderItem.id, receivedTon: tonValue, receivedDate: new Date('2026-10-01T00:00:00.000Z') } });
    const lot = await prisma.lot.create({
      data: { lotNo: `${P}RM-${name}`, lotType: LOT_TYPE.RAW_MATERIAL, itemId: item.id, goodsReceiptId: receipt.id, yardId: yard.id, initialTon: tonValue, remainingTon: tonValue },
    });
    ids[name] = lot.id;
    return lot;
  };

  const link = (parent: string, child: string, evidence: string, extra: { inputTon?: string; period?: [string, string] } = {}) =>
    prisma.lotRelation.create({
      data: {
        parentLotId: ids[parent],
        childLotId: ids[child],
        lotRelationEvidence: evidence,
        inputTon: extra.inputTon,
        inputStartedAt: extra.period ? new Date(extra.period[0]) : undefined,
        inputEndedAt: extra.period ? new Date(extra.period[1]) : undefined,
      },
    });

  const inspect = (name: string, result: string) =>
    prisma.qualityInspection.create({ data: { lotId: ids[name], inspectionStandardId: standardId, inspectionResult: result, inspectorEmployeeId: employeeId, inspectedAt: new Date('2026-10-03T00:00:00.000Z') } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PrismaModule, CommonModule, LotModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(LotService);
    employeeId = (await prisma.employee.findFirstOrThrow()).id;
    const slabItem = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'SL-SM355A-250x1500x10000' } });
    const coilItem = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'CL-SM355A-9x1400x227500' } });
    standardId = (await prisma.inspectionStandard.findFirstOrThrow({ where: { steelGradeId: slabItem.steelGradeId! } })).id;

    await rawLot('R1', '100.000');
    await rawLot('R2', '50.000');
    await rawLot('A1', '5.000');

    const ironmaking = await prisma.productionResult.create({
      data: { processType: PROCESS_TYPE.IRONMAKING, blastFurnaceCode: 'BF2', startedAt: new Date('2026-10-01T00:00:00.000Z'), completedAt: new Date('2026-10-02T00:00:00.000Z') },
    });
    const steelmaking = await prisma.productionResult.create({ data: { processType: PROCESS_TYPE.STEELMAKING, converterCode: 'BOF1', startedAt: new Date(), completedAt: new Date() } });
    const casting = await prisma.productionResult.create({ data: { processType: PROCESS_TYPE.CONTINUOUS_CASTING, startedAt: new Date(), completedAt: new Date() } });
    const rolling = await prisma.productionResult.create({ data: { processType: PROCESS_TYPE.HOT_ROLLING, startedAt: new Date(), completedAt: new Date() } });

    for (const name of ['H1', 'H2']) {
      ids[name] = (await prisma.lot.create({ data: { lotNo: `${P}HM-${name}`, lotType: LOT_TYPE.HOT_METAL, productionResultId: ironmaking.id, initialTon: '80.000', remainingTon: '10.000' } })).id;
    }
    ids.HT = (await prisma.lot.create({ data: { lotNo: `${P}HT-1`, lotType: LOT_TYPE.HEAT, steelGradeId: slabItem.steelGradeId!, productionResultId: steelmaking.id } })).id;
    const producedDate = new Date('2026-10-04T00:00:00.000Z');
    ids.S1 = (await prisma.lot.create({ data: { lotNo: `${P}SL-1`, lotType: LOT_TYPE.SLAB, itemId: slabItem.id, productionResultId: casting.id, producedDate, lotStatus: LOT_STATUS.CONSUMED } })).id;
    ids.S2 = (await prisma.lot.create({ data: { lotNo: `${P}SL-2`, lotType: LOT_TYPE.SLAB, itemId: slabItem.id, productionResultId: casting.id, producedDate: new Date('2026-10-05T00:00:00.000Z') } })).id;
    ids.C1 = (await prisma.lot.create({ data: { lotNo: `${P}CL-1`, lotType: LOT_TYPE.COIL, itemId: coilItem.id, productionResultId: rolling.id, producedDate: new Date('2026-10-06T00:00:00.000Z'), lotStatus: LOT_STATUS.SHIPPED } })).id;

    const period: [string, string] = ['2026-10-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z'];
    await link('R1', 'H1', LOT_RELATION_EVIDENCE.PERIOD_BASED, { inputTon: '60.000', period });
    await link('R2', 'H1', LOT_RELATION_EVIDENCE.PERIOD_BASED, { inputTon: '20.000', period });
    await link('R1', 'H2', LOT_RELATION_EVIDENCE.PERIOD_BASED, { inputTon: '40.000', period });
    await link('H1', 'HT', LOT_RELATION_EVIDENCE.ACTUAL_INPUT, { inputTon: '70.000' });
    await link('H2', 'HT', LOT_RELATION_EVIDENCE.ACTUAL_INPUT, { inputTon: '30.000' });
    await link('A1', 'HT', LOT_RELATION_EVIDENCE.ACTUAL_INPUT, { inputTon: '2.000' });
    await link('HT', 'S1', LOT_RELATION_EVIDENCE.ACTUAL_INPUT);
    await link('HT', 'S2', LOT_RELATION_EVIDENCE.ACTUAL_INPUT);
    await link('S1', 'C1', LOT_RELATION_EVIDENCE.ACTUAL_INPUT);

    await inspect('HT', INSPECTION_RESULT.PASS);
    await inspect('S1', INSPECTION_RESULT.PASS);
    await inspect('C1', INSPECTION_RESULT.PASS);
    await inspect('S2', INSPECTION_RESULT.FAIL);
    await prisma.lot.update({ where: { id: ids.S2 }, data: { dispositionStatus: 'HOLD', dispositionReason: '표면 결함' } });

    // C1 → 수주 → 출하요청(출고) → 밀시트
    const customer = await prisma.customer.findFirstOrThrow();
    const so = await prisma.salesOrder.create({
      data: { salesOrderNo: `${P}SO-1`, customerId: customer.id, ownerEmployeeId: employeeId, salesOrderItems: { create: { itemId: coilItem.id, orderedQty: 1, dueDate: new Date('2026-12-01T00:00:00.000Z') } } },
      select: { id: true, salesOrderItems: { select: { id: true } } },
    });
    salesOrderId = so.id;
    const request = await prisma.shipmentRequest.create({
      data: { shipmentRequestNo: 'DR-2610-9001', customerId: customer.id, shipmentRequestStatus: SHIPMENT_REQUEST_STATUS.ISSUED, issuedAt: new Date('2026-10-07T00:00:00.000Z'), issuedEmployeeId: employeeId },
    });
    shipmentRequestId = request.id;
    const requestItem = await prisma.shipmentRequestItem.create({ data: { shipmentRequestId: request.id, salesOrderItemId: so.salesOrderItems[0].id, requestQty: 1 } });
    await prisma.allocation.create({ data: { lotId: ids.C1, allocationPurpose: ALLOCATION_PURPOSE.SHIPMENT, shipmentRequestItemId: requestItem.id, allocationStatus: ALLOCATION_STATUS.CONSUMED } });
    millSheetId = (await prisma.millSheet.create({ data: { millSheetNo: 'MS-2610-9001-1', shipmentRequestId: request.id, salesOrderId: so.id, snapshot: {}, issuedAt: new Date('2026-10-07T00:00:00.000Z') } })).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('목록 (API-235)', () => {
    it('번호 앞부분(대소문자 무관)·유형·상태로 거르고 생산완료일 최근 순으로 돌려준다', async () => {
      const slabs = await service.list({ lotNo: 'lt-sl', lotType: LOT_TYPE.SLAB, page: 1, size: 20 });
      expect(slabs.total).toBe(2);
      expect(slabs.items.map((l) => l.lotNo)).toEqual([`${P}SL-2`, `${P}SL-1`]);
      expect(slabs.items[0]).toMatchObject({ lotType: LOT_TYPE.SLAB, lotStatus: LOT_STATUS.AVAILABLE, inspectionResult: INSPECTION_RESULT.FAIL, itemCode: 'SL-SM355A-250x1500x10000', steelGradeCode: 'SM355A', producedDate: '2026-10-05' });

      const shipped = await service.list({ lotNo: P, lotStatus: LOT_STATUS.SHIPPED, page: 1, size: 20 });
      expect(shipped.items.map((l) => l.lotNo)).toEqual([`${P}CL-1`]);
    });

    it('페이징 total은 조건에 맞는 전체 수다', async () => {
      const page = await service.list({ lotNo: P, page: 2, size: 4 });
      expect(page.total).toBe(9);
      expect(page.items).toHaveLength(4);
    });
  });

  describe('상세 (API-236)', () => {
    it('코일: 검사 판정·기준 버전, 적격, 상위 히트, 바로 위 LOT, 출하·밀시트를 돌려준다', async () => {
      const coil = await service.detail(ids.C1);
      expect(coil).toMatchObject({ lotNo: `${P}CL-1`, lotType: LOT_TYPE.COIL, isEligible: true, heat: { id: ids.HT, lotNo: `${P}HT-1` }, disposition: null });
      expect(coil.inspection).toMatchObject({ inspectionResult: INSPECTION_RESULT.PASS, standardVersion: expect.any(Number) });
      expect(coil.parents).toEqual([expect.objectContaining({ lotId: ids.S1, lotNo: `${P}SL-1`, lotRelationEvidence: LOT_RELATION_EVIDENCE.ACTUAL_INPUT })]);
      expect(coil.children).toEqual([]);
      expect(coil.allocations).toEqual([expect.objectContaining({ allocationStatus: ALLOCATION_STATUS.CONSUMED, shipmentRequest: { id: shipmentRequestId, shipmentRequestNo: 'DR-2610-9001' } })]);
      expect(coil.shipments).toEqual([
        expect.objectContaining({ shipmentRequestNo: 'DR-2610-9001', allocationStatus: ALLOCATION_STATUS.CONSUMED, salesOrder: { salesOrderId, salesOrderNo: `${P}SO-1` }, millSheets: [{ id: millSheetId, millSheetNo: 'MS-2610-9001-1', salesOrderId }] }),
      ]);
    });

    it('불합격 슬래브: 적격이 아니고 불합격 처리 상태·사유가 보인다', async () => {
      const slab = await service.detail(ids.S2);
      expect(slab).toMatchObject({ isEligible: false, inspectionResult: INSPECTION_RESULT.FAIL, disposition: { dispositionStatus: 'HOLD', dispositionReason: '표면 결함' } });
    });

    it('원료·용선: 입고 번호·잔량(톤)과 연결 근거(기간)를 보여 주고 적격은 계산하지 않는다', async () => {
      const raw = await service.detail(ids.R1);
      expect(raw).toMatchObject({ lotType: LOT_TYPE.RAW_MATERIAL, isEligible: null, heat: null, initialTon: '100.000', remainingTon: '100.000', goodsReceiptNo: expect.stringMatching(/^LT-GR-/) });
      expect(raw.children.map((c) => c.lotNo).sort()).toEqual([`${P}HM-H1`, `${P}HM-H2`]);
      expect(raw.children[0]).toMatchObject({ lotRelationEvidence: LOT_RELATION_EVIDENCE.PERIOD_BASED, periodStartedAt: '2026-10-01T00:00:00.000Z', periodEndedAt: '2026-10-02T00:00:00.000Z' });

      const hotMetal = await service.detail(ids.H1);
      expect(hotMetal).toMatchObject({ blastFurnaceCode: 'BF2', remainingTon: '10.000' });
      expect(hotMetal.parents).toHaveLength(2);
    });

    it('없는 LOT은 COM-003', async () => {
      await expect(service.detail(999999)).rejects.toMatchObject({ code: 'COM-003' });
    });
  });

  describe('역추적 (API-237, TRM-072)', () => {
    it('코일 → 슬래브 → 히트 → 용선(둘) → 원료·합금철을 한 번씩만, 가까운 순으로 돌려준다', async () => {
      const trace = await service.trace(ids.C1, 'backward');
      expect(trace.direction).toBe('backward');
      expect(trace.nodes.map((n) => [n.lotNo, n.depth])).toEqual([
        [`${P}CL-1`, 0],
        [`${P}SL-1`, 1],
        [`${P}HT-1`, 2],
        [`${P}RM-A1`, 3],
        [`${P}HM-H1`, 3],
        [`${P}HM-H2`, 3],
        [`${P}RM-R1`, 4],
        [`${P}RM-R2`, 4],
      ]);
      expect(trace.nodes[0].isStart).toBe(true);
      // R1은 H1·H2 두 경로로 닿지만 노드는 하나, 연결은 둘 다 남는다 (N:M 보존)
      expect(trace.nodes.filter((n) => n.lotNo === `${P}RM-R1`)).toHaveLength(1);
      expect(trace.edges).toHaveLength(8); // HT→S2는 범위 밖
      expect(trace.edges.find((e) => e.parentLotId === ids.R1 && e.childLotId === ids.H1)).toMatchObject({ lotRelationEvidence: LOT_RELATION_EVIDENCE.PERIOD_BASED, inputTon: '60.000', periodStartedAt: '2026-10-01T00:00:00.000Z' });
      expect(trace.edges.find((e) => e.parentLotId === ids.A1)).toMatchObject({ lotRelationEvidence: LOT_RELATION_EVIDENCE.ACTUAL_INPUT, inputTon: '2.000' });
      expect(trace.nodes.find((n) => n.lotNo === `${P}HM-H1`)).toMatchObject({ blastFurnaceCode: 'BF2' });
      expect(trace.nodes.find((n) => n.lotNo === `${P}HT-1`)).toMatchObject({ converterCode: 'BOF1' });
      expect(trace.shipments).toEqual([]);
      expect(trace.impact).toBeNull();
    });

    it('슬래브에서 시작하면 코일 단계가 없다', async () => {
      const trace = await service.trace(ids.S1, 'backward');
      expect(trace.nodes.map((n) => n.lotType)).not.toContain(LOT_TYPE.COIL);
      expect(trace.nodes[0].lotNo).toBe(`${P}SL-1`);
    });
  });

  describe('정추적 (API-237, TRM-073)', () => {
    it('원료 → 용선 → 히트 → 슬래브·코일과 출하·수주·영향 범위를 돌려준다', async () => {
      const trace = await service.trace(ids.R1, 'forward');
      expect(trace.nodes.map((n) => n.lotNo)).toEqual([`${P}RM-R1`, `${P}HM-H1`, `${P}HM-H2`, `${P}HT-1`, `${P}SL-1`, `${P}SL-2`, `${P}CL-1`]);
      expect(trace.shipments).toEqual([
        expect.objectContaining({ shipmentRequestNo: 'DR-2610-9001', allocationStatus: ALLOCATION_STATUS.CONSUMED, lotIds: [ids.C1], salesOrder: { salesOrderId, salesOrderNo: `${P}SO-1` }, millSheets: [expect.objectContaining({ id: millSheetId })] }),
      ]);
      expect(trace.impact).toMatchObject({ slabCount: 2, coilCount: 1, shippedLotCount: 1, unshippedLotCount: 1, consumedLotCount: 1 });
      expect(trace.impact?.salesOrders).toEqual([{ salesOrderId, salesOrderNo: `${P}SO-1`, customerName: expect.any(String), hasShipped: true, lotCount: 1, dueDate: '2026-12-01' }]);
    });

    it('히트에서 시작하면 그 아래 슬래브·코일만 나온다 (합금철·용선은 위쪽이라 빠진다)', async () => {
      const trace = await service.trace(ids.HT, 'forward');
      expect(trace.nodes.map((n) => n.lotNo)).toEqual([`${P}HT-1`, `${P}SL-1`, `${P}SL-2`, `${P}CL-1`]);
    });
  });

  describe('방향·오류', () => {
    it('direction을 생략하면 코일·슬래브는 역추적, 원료·용선·히트는 정추적', async () => {
      expect((await service.trace(ids.C1)).direction).toBe('backward');
      expect((await service.trace(ids.S2)).direction).toBe('backward');
      expect((await service.trace(ids.R2)).direction).toBe('forward');
      expect((await service.trace(ids.HT)).direction).toBe('forward');
    });

    it('없는 LOT은 COM-003', async () => {
      await expect(service.trace(999999)).rejects.toMatchObject({ code: 'COM-003' });
    });

    it('연결이 순환(A→B→A)이어도 추적이 끝나고 같은 LOT은 한 번만 나온다', async () => {
      const a = await prisma.lot.create({ data: { lotNo: `${P}HM-LOOP-A`, lotType: LOT_TYPE.HOT_METAL, productionResultId: (await prisma.productionResult.findFirstOrThrow({ where: { processType: PROCESS_TYPE.IRONMAKING } })).id, remainingTon: '1.000' } });
      const b = await prisma.lot.create({ data: { lotNo: `${P}HM-LOOP-B`, lotType: LOT_TYPE.HOT_METAL, productionResultId: a.productionResultId, remainingTon: '1.000' } });
      await prisma.lotRelation.createMany({
        data: [
          { parentLotId: a.id, childLotId: b.id, lotRelationEvidence: LOT_RELATION_EVIDENCE.ACTUAL_INPUT },
          { parentLotId: b.id, childLotId: a.id, lotRelationEvidence: LOT_RELATION_EVIDENCE.ACTUAL_INPUT },
        ],
      });
      for (const direction of ['backward', 'forward'] as const) {
        const trace = await service.trace(a.id, direction);
        expect(trace.nodes.map((n) => n.id).sort()).toEqual([a.id, b.id].sort());
      }
    });
  });
});
