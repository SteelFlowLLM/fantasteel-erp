import { Test } from '@nestjs/testing';
import {
  ALLOCATION_PURPOSE,
  ALLOCATION_STATUS,
  INSPECTION_RESULT,
  ITEM_TYPE,
  LOT_RELATION_EVIDENCE,
  LOT_STATUS,
  LOT_TYPE,
  PROCESS_TYPE,
  PURCHASE_REQUISITION_STATUS,
} from '@fantasteel/shared';
import { CommonModule } from '../../common/common.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryModule } from './inventory.module';
import { InventoryService } from './inventory.service';

// 실제 DB(fs_sales)에서 재고 조회를 확인한다. 같은 DB를 다른 테스트 파일도 쓰므로 값은 "만들기 전 대비 변화량"으로 본다.
describe('InventoryService 재고 조회 (GET /inventories, REQ-INV-001·008)', () => {
  let prisma: PrismaService;
  let service: InventoryService;
  let slabItem: { id: number; steelGradeId: number; theoreticalWeightTon: string };
  let rawItem: { id: number };
  let employeeId: number;
  let supplierId: number;
  let steelmaking: number;
  let casting: number;
  let seq = 0;

  const slabRow = async () => (await service.listInventories({ itemId: slabItem.id })).products[0];

  /** 슬래브 LOT: 슬래브 PASS + 히트 결과(기본 PASS). 상태·배정은 호출한 쪽이 정한다 */
  const slabLot = async (opts: { heatResult?: string; lotStatus?: string } = {}) => {
    seq += 1;
    const inspector = employeeId;
    const heat = await prisma.lot.create({ data: { lotNo: `HT-IL-${seq}`, lotType: LOT_TYPE.HEAT, steelGradeId: slabItem.steelGradeId, productionResultId: steelmaking } });
    const slab = await prisma.lot.create({
      data: { lotNo: `SL-IL-${seq}`, lotType: LOT_TYPE.SLAB, itemId: slabItem.id, productionResultId: casting, producedDate: new Date('2026-10-02T00:00:00.000Z'), lotStatus: opts.lotStatus ?? LOT_STATUS.AVAILABLE },
    });
    await prisma.lotRelation.create({ data: { parentLotId: heat.id, childLotId: slab.id, lotRelationEvidence: LOT_RELATION_EVIDENCE.ACTUAL_INPUT } });
    const standard = await prisma.inspectionStandard.findFirstOrThrow({ where: { steelGradeId: slabItem.steelGradeId }, select: { id: true } });
    for (const [lotId, result] of [[heat.id, opts.heatResult ?? INSPECTION_RESULT.PASS], [slab.id, INSPECTION_RESULT.PASS]] as const) {
      await prisma.qualityInspection.create({ data: { lotId, inspectionStandardId: standard.id, inspectionResult: result, inspectorEmployeeId: inspector, inspectedAt: new Date() } });
    }
    return slab.id;
  };

  /** 원료 LOT: 구매요청 → 발주 → 입고 → 원료 LOT(입고 1건 = LOT 1개) */
  const rawLot = async (remainingTon: string) => {
    seq += 1;
    const order = await prisma.purchaseOrder.create({ data: { purchaseOrderNo: `T-IL-PO-${seq}`, supplierId } });
    const requisition = await prisma.purchaseRequisition.create({
      data: {
        purchaseRequisitionNo: `T-IL-PR-${seq}`,
        itemId: rawItem.id,
        requestedTon: remainingTon,
        desiredReceiptDate: new Date('2026-11-30T00:00:00.000Z'),
        requesterId: employeeId,
        purchaseRequisitionStatus: PURCHASE_REQUISITION_STATUS.ORDERED,
      },
    });
    const orderItem = await prisma.purchaseOrderItem.create({ data: { purchaseOrderId: order.id, purchaseRequisitionId: requisition.id, itemId: rawItem.id, orderedTon: remainingTon } });
    const receipt = await prisma.goodsReceipt.create({
      data: { goodsReceiptNo: `T-IL-GR-${seq}`, purchaseOrderItemId: orderItem.id, receivedTon: remainingTon, receivedDate: new Date('2026-10-06T00:00:00.000Z') },
    });
    const yard = await prisma.yard.findFirstOrThrow({ select: { id: true } });
    return prisma.lot.create({
      data: { lotNo: `RM-IL-${seq}`, lotType: LOT_TYPE.RAW_MATERIAL, itemId: rawItem.id, goodsReceiptId: receipt.id, yardId: yard.id, initialTon: remainingTon, remainingTon },
    });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PrismaModule, CommonModule, InventoryModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(InventoryService);
    const slab = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'SL-SM355A-250x1500x10000' } });
    slabItem = { id: slab.id, steelGradeId: slab.steelGradeId!, theoreticalWeightTon: slab.theoreticalWeightTon!.toFixed(3) };
    rawItem = await prisma.item.findFirstOrThrow({ where: { itemType: ITEM_TYPE.RAW_MATERIAL }, select: { id: true }, orderBy: { id: 'asc' } });
    employeeId = (await prisma.employee.findFirstOrThrow({ select: { id: true } })).id;
    supplierId = (await prisma.supplier.findFirstOrThrow({ select: { id: true } })).id;
    steelmaking = (await prisma.productionResult.create({ data: { processType: PROCESS_TYPE.STEELMAKING, converterCode: 'BOF1', startedAt: new Date(), completedAt: new Date() } })).id;
    casting = (await prisma.productionResult.create({ data: { processType: PROCESS_TYPE.CONTINUOUS_CASTING, startedAt: new Date(), completedAt: new Date() } })).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('제품 재고 행은 재고·예약·열연 배정·가용 매수와 톤(계산값)을 규격별로 돌려준다', async () => {
    await prisma.inventory.upsert({
      where: { itemId: slabItem.id },
      create: { itemId: slabItem.id, onHandQty: 10, reservedQty: 3, rollingAllocatedQty: 2 },
      update: { onHandQty: 10, reservedQty: 3, rollingAllocatedQty: 2 },
    });
    const row = await slabRow();
    expect(row).toMatchObject({ itemCode: 'SL-SM355A-250x1500x10000', itemType: ITEM_TYPE.SLAB, steelGradeCode: 'SM355A', onHandQty: 10, reservedQty: 3, rollingAllocatedQty: 2, availableQty: 5 });
    expect(row.onHandTon).toBe('294.380');
    expect(row.availableTon).toBe('147.190');
  });

  it('미배정 합격 LOT 수는 적격 + 재고 상태 + 확정 배정 없음만 센다', async () => {
    const before = (await slabRow()).unallocatedPassedQty;
    const free = await slabLot();
    await slabLot();
    const allocated = await slabLot();
    await slabLot({ heatResult: INSPECTION_RESULT.FAIL });
    await slabLot({ lotStatus: LOT_STATUS.SHIPPED });
    expect((await slabRow()).unallocatedPassedQty).toBe(before + 3);

    // 확정 배정이 걸리면 빠지고, 해제하면 다시 센다
    const request = await prisma.shipmentRequest.create({ data: { shipmentRequestNo: `DR-IL-${seq}`, customerId: (await prisma.customer.findFirstOrThrow()).id } });
    const salesOrder = await prisma.salesOrder.create({
      data: { salesOrderNo: `SO-IL-${seq}`, customerId: request.customerId, ownerEmployeeId: employeeId, salesOrderItems: { create: { itemId: slabItem.id, orderedQty: 5, dueDate: new Date('2026-12-31T00:00:00.000Z') } } },
      select: { salesOrderItems: { select: { id: true } } },
    });
    const requestItem = await prisma.shipmentRequestItem.create({ data: { shipmentRequestId: request.id, salesOrderItemId: salesOrder.salesOrderItems[0].id, requestQty: 1 } });
    const allocation = await prisma.allocation.create({
      data: { lotId: allocated, allocationPurpose: ALLOCATION_PURPOSE.SHIPMENT, shipmentRequestItemId: requestItem.id, allocationStatus: ALLOCATION_STATUS.CONFIRMED },
    });
    expect((await slabRow()).unallocatedPassedQty).toBe(before + 2);
    await prisma.allocation.update({ where: { id: allocation.id }, data: { allocationStatus: ALLOCATION_STATUS.RELEASED } });
    expect((await slabRow()).unallocatedPassedQty).toBe(before + 3);
    expect(free).toBeGreaterThan(0);
  });

  it('원료 재고는 잔량이 남은 원료 LOT의 remaining_ton 합계이고, 잔량 0인 LOT은 세지 않는다', async () => {
    const before = (await service.listInventories({ itemId: rawItem.id })).rawMaterials[0];
    await rawLot('12.500');
    await rawLot('7.250');
    const empty = await rawLot('3.000');
    await prisma.lot.update({ where: { id: empty.id }, data: { remainingTon: 0, lotStatus: LOT_STATUS.CONSUMED } });

    const after = (await service.listInventories({ itemId: rawItem.id })).rawMaterials[0];
    expect(after.lotCount).toBe(before.lotCount + 2);
    expect(Number(after.remainingTon)).toBeCloseTo(Number(before.remainingTon) + 19.75, 3);
    expect(after.remainingTon).toMatch(/^\d+\.\d{3}$/);
  });

  it('itemId를 주면 그 규격만 돌려준다 (제품 규격이면 원료 없음, 원료면 제품 없음)', async () => {
    const product = await service.listInventories({ itemId: slabItem.id });
    expect(product.products.map((p) => p.itemId)).toEqual([slabItem.id]);
    expect(product.rawMaterials).toEqual([]);

    const raw = await service.listInventories({ itemId: rawItem.id });
    expect(raw.products).toEqual([]);
    expect(raw.rawMaterials.map((r) => r.itemId)).toEqual([rawItem.id]);

    expect(await service.listInventories({ itemId: 999999 })).toEqual({ products: [], rawMaterials: [], surplus: [] });
  });

  it('여재 = 미배정 합격 슬래브 − ACTIVE 예약 매수이고, 여재 슬래브는 그 매수만큼 돌려준다 (inventory.md 8-1)', async () => {
    const setReserved = (reservedQty: number) =>
      prisma.inventory.upsert({ where: { itemId: slabItem.id }, create: { itemId: slabItem.id, onHandQty: 10, reservedQty }, update: { reservedQty } });
    const surplusRow = async () => (await service.listInventories({ itemId: slabItem.id })).surplus.find((row) => row.itemId === slabItem.id);

    await setReserved(0);
    const before = (await surplusRow())?.surplusQty ?? 0;
    await slabLot();
    await slabLot();
    const row = await surplusRow();
    expect(row).toMatchObject({ itemCode: 'SL-SM355A-250x1500x10000', steelGradeCode: 'SM355A', theoreticalWeightTon: slabItem.theoreticalWeightTon, reservedQty: 0, surplusQty: before + 2 });
    expect(row?.lots).toHaveLength(before + 2);
    expect(row?.lots[0]).toEqual(expect.objectContaining({ lotNo: expect.any(String), heatNo: expect.any(String) }));

    // 예약 1매가 늘면 여재가 1매 준다 (FIFO상 가장 늦게 쓰일 LOT이 여재로 남는다)
    await setReserved(1);
    expect((await surplusRow())?.surplusQty).toBe(before + 1);
    await setReserved(before + 2);
    expect(await surplusRow()).toBeUndefined();
    await setReserved(3);
  });

  it('itemId 없이 부르면 제품 규격과 원료 규격 전부를 돌려준다', async () => {
    const all = await service.listInventories({});
    expect(all.products.length).toBe(await prisma.item.count({ where: { itemType: { in: [ITEM_TYPE.SLAB, ITEM_TYPE.COIL] } } }));
    expect(all.rawMaterials.length).toBe(await prisma.item.count({ where: { itemType: ITEM_TYPE.RAW_MATERIAL } }));
  });
});
