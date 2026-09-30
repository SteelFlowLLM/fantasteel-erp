// 테스트 전용: 로컬 테스트 DB에 시험용 LOT 관계·수주·출고를 만들고 지운다. 운영 코드에서 쓰지 않는다.
import 'dotenv/config';
import { PrismaService } from '../../../prisma/prisma.service';

/** 실수로 개발용 기본 DB(fantasteel)에 시험 데이터를 넣지 않게 막는다. */
export function connectTestDb(): PrismaService {
  const url = process.env.DATABASE_URL ?? '';
  if (!url || /\/fantasteel(\?|$)/.test(url)) {
    throw new Error('테스트는 전용 DB로 실행하세요. 예: DATABASE_URL=postgresql://postgres:postgres@localhost:54322/fs_log');
  }
  return new PrismaService();
}

export const newTag = (): string => `TST${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1296).toString(36).toUpperCase()}`;

export interface Genealogy {
  tag: string;
  rawLotId: number;
  hotMetalId: number;
  heatId: number;
  slabAId: number;
  slabBId: number;
  coilId: number;
  slabSpecId: number;
  coilSpecId: number;
  steelGradeId: number;
}

/** 원료 → 용선 → 히트 → 슬래브 2매 → (슬래브 A) 코일 1개. 히트는 합격, 슬래브·코일은 검사 전(isPassed = null). */
export async function createGenealogy(prisma: PrismaService, tag: string): Promise<Genealogy> {
  const raw = await prisma.rawMaterial.findFirstOrThrow({ where: { materialCode: 'IO' } });
  const slabSpec = await prisma.productSpec.findUniqueOrThrow({ where: { specCode: 'SL-SS275-250x1200x10000' }, include: { slabMapping: true } });
  const coilSpecId = slabSpec.slabMapping!.coilSpecId;
  const at = new Date();
  const rawLot = await prisma.lot.create({ data: { lotNo: `${tag}-RM`, lotType: 'RAW_MATERIAL', rawMaterialId: raw.id, initialTon: 10, remainingTon: 10, producedAt: at } });
  const hotMetal = await prisma.lot.create({ data: { lotNo: `${tag}-HM`, lotType: 'HOT_METAL', initialTon: 10, remainingTon: 0, blastFurnaceNo: '1', lotStatus: 'CONSUMED', producedAt: at } });
  const heat = await prisma.lot.create({
    data: { lotNo: `${tag}-HT`, lotType: 'HEAT', steelGradeId: slabSpec.steelGradeId, initialTon: 10, converterNo: '1', isPassed: true, lotStatus: 'CONSUMED', producedAt: at },
  });
  const slab = (no: string) => ({ lotNo: `${tag}-HT-${no}`, lotType: 'SLAB', productSpecId: slabSpec.id, steelGradeId: slabSpec.steelGradeId, heatLotId: heat.id, producedAt: at });
  const slabA = await prisma.lot.create({ data: slab('01') });
  const slabB = await prisma.lot.create({ data: slab('02') });
  const coil = await prisma.lot.create({
    data: { lotNo: `C${tag}-HT-01`, lotType: 'COIL', productSpecId: coilSpecId, steelGradeId: slabSpec.steelGradeId, heatLotId: heat.id, producedAt: at },
  });
  await prisma.lotRelation.createMany({
    data: [
      { parentLotId: rawLot.id, childLotId: hotMetal.id, relationType: 'RAW_TO_HOT_METAL', evidenceType: 'PERIOD', periodStart: new Date(at.getTime() - 8 * 3600_000), periodEnd: at },
      { parentLotId: hotMetal.id, childLotId: heat.id, relationType: 'HOT_METAL_TO_HEAT', evidenceType: 'DIRECT', inputTon: 10 },
      { parentLotId: heat.id, childLotId: slabA.id, relationType: 'HEAT_TO_SLAB', evidenceType: 'DIRECT' },
      { parentLotId: heat.id, childLotId: slabB.id, relationType: 'HEAT_TO_SLAB', evidenceType: 'DIRECT' },
      { parentLotId: slabA.id, childLotId: coil.id, relationType: 'SLAB_TO_COIL', evidenceType: 'DIRECT' },
    ],
  });
  return {
    tag,
    rawLotId: rawLot.id,
    hotMetalId: hotMetal.id,
    heatId: heat.id,
    slabAId: slabA.id,
    slabBId: slabB.id,
    coilId: coil.id,
    slabSpecId: slabSpec.id,
    coilSpecId,
    steelGradeId: slabSpec.steelGradeId,
  };
}

export interface ShipmentFixture {
  salesOrderId: number;
  salesOrderNo: string;
  goodsIssueNo: string;
  shipmentRequestNo: string;
  millSheetNo: string;
  customerName: string;
}

/** 슬래브 B(코일 단계 없이 슬래브로 출하)와 코일을 한 출고로 내보낸 수주·출하요청·출고·밀시트. */
export async function createShipment(prisma: PrismaService, g: Genealogy): Promise<ShipmentFixture> {
  const customer = await prisma.customer.findFirstOrThrow({ orderBy: { id: 'asc' } });
  const owner = await prisma.employee.findFirstOrThrow({ where: { employeeNo: '2104012' } });
  const due = new Date(Date.now() + 5 * 86_400_000);
  const so = await prisma.salesOrder.create({
    data: {
      salesOrderNo: `SO-${g.tag}`,
      customerId: customer.id,
      dueDate: due,
      ownerEmployeeId: owner.id,
      items: {
        create: [
          { lineNo: 1, productSpecId: g.slabSpecId, orderedQty: 1, shippedQty: 1, salesOrderItemStatus: 'SHIPPED' },
          { lineNo: 2, productSpecId: g.coilSpecId, orderedQty: 1, shippedQty: 1, salesOrderItemStatus: 'SHIPPED' },
        ],
      },
    },
    include: { items: { orderBy: { lineNo: 'asc' } } },
  });
  const req = await prisma.shipmentRequest.create({
    data: {
      shipmentRequestNo: `SHP-${g.tag}`,
      customerId: customer.id,
      requestedShipDate: due,
      shipmentRequestStatus: 'ISSUED',
      requesterId: owner.id,
      items: {
        create: so.items.map((i) => ({ lineNo: i.lineNo, salesOrderItemId: i.id, requestQty: 1, shipmentRequestItemStatus: 'ISSUED' })),
      },
    },
    include: { items: { orderBy: { lineNo: 'asc' } } },
  });
  const issue = await prisma.goodsIssue.create({
    data: {
      goodsIssueNo: `GI-${g.tag}`,
      shipmentRequestId: req.id,
      confirmedAt: new Date(),
      items: {
        create: [
          { shipmentRequestItemId: req.items[0].id, lotId: g.slabBId },
          { shipmentRequestItemId: req.items[1].id, lotId: g.coilId },
        ],
      },
    },
  });
  await prisma.millSheet.create({ data: { millSheetNo: `MS-${g.tag}`, goodsIssueId: issue.id, salesOrderId: so.id, customerId: customer.id, snapshot: {} } });
  await prisma.lot.updateMany({ where: { id: { in: [g.slabBId, g.coilId] } }, data: { lotStatus: 'SHIPPED' } });
  return { salesOrderId: so.id, salesOrderNo: so.salesOrderNo, goodsIssueNo: issue.goodsIssueNo, shipmentRequestNo: req.shipmentRequestNo, millSheetNo: `MS-${g.tag}`, customerName: customer.customerName };
}

/** 태그가 들어간 시험 데이터를 FK 순서대로 모두 지운다. */
export async function cleanupTag(prisma: PrismaService, tag: string): Promise<void> {
  const lots = await prisma.lot.findMany({ where: { lotNo: { contains: tag } }, select: { id: true } });
  const lotIds = lots.map((l) => l.id);
  const orders = await prisma.salesOrder.findMany({ where: { salesOrderNo: { contains: tag } }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);
  const issues = await prisma.goodsIssue.findMany({ where: { goodsIssueNo: { contains: tag } }, select: { id: true } });
  const issueIds = issues.map((i) => i.id);

  await prisma.businessEvent.deleteMany({ where: { OR: [{ summary: { contains: tag } }, { targetNo: { contains: tag } }] } });
  await prisma.millSheet.deleteMany({ where: { OR: [{ goodsIssueId: { in: issueIds } }, { salesOrderId: { in: orderIds } }] } });
  await prisma.goodsIssueItem.deleteMany({ where: { OR: [{ goodsIssueId: { in: issueIds } }, { lotId: { in: lotIds } }] } });
  await prisma.goodsIssue.deleteMany({ where: { id: { in: issueIds } } });
  await prisma.allocation.deleteMany({ where: { lotId: { in: lotIds } } });
  await prisma.shipmentRequestItem.deleteMany({ where: { shipmentRequest: { shipmentRequestNo: { contains: tag } } } });
  await prisma.shipmentRequest.deleteMany({ where: { shipmentRequestNo: { contains: tag } } });
  await prisma.qualityInspectionValue.deleteMany({ where: { qualityInspection: { lotId: { in: lotIds } } } });
  await prisma.qualityInspection.deleteMany({ where: { lotId: { in: lotIds } } });
  await prisma.lotRelation.deleteMany({ where: { OR: [{ parentLotId: { in: lotIds } }, { childLotId: { in: lotIds } }] } });
  await prisma.lot.updateMany({ where: { id: { in: lotIds } }, data: { heatLotId: null, salesOrderItemId: null } });
  await prisma.lot.deleteMany({ where: { id: { in: lotIds } } });
  await prisma.reservation.deleteMany({ where: { salesOrderItem: { salesOrderId: { in: orderIds } } } });
  await prisma.productionPlan.deleteMany({ where: { productionPlanNo: { contains: tag } } });
  await prisma.salesOrderItem.deleteMany({ where: { salesOrderId: { in: orderIds } } });
  await prisma.salesOrder.deleteMany({ where: { id: { in: orderIds } } });
}
