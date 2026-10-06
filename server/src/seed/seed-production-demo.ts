// 생산 화면 개발·시연용 거래 시드. 기본 시드(prisma/seed.ts, 조직·기준정보)를 넣은 빈 거래 DB에서 한 번 실행한다.
//   npm run db:reset && npm run seed:demo -w @fantasteel/server
// 실제 서비스(수주 등록·실적 시뮬레이션·검사 등록)를 불러 만들어 번호·작업 로그·재고가 화면에서 하는 것과 같다.
// 서비스 주입(Nest DI)에 데코레이터 메타데이터가 필요해서 prisma/seed.ts처럼 tsx로 돌리지 않고 tsc로 빌드해 실행한다.
import 'dotenv/config';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { LOT_TYPE, PROCESS_TYPE, type AuthUser, type ProcessType } from '@fantasteel/shared';
import { AppModule } from '../app.module';
import { AuthUserService } from '../common/auth/auth-user.service';
import { NumberingService } from '../common/numbering/numbering.service';
import { seoulDateOnly, seoulToday } from '../common/time/seoul-date';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProductionSimulationService } from '../modules/production/production-simulation.service';
import { isItemApplicable } from '../modules/quality/inspection-judge';
import { QualityService } from '../modules/quality/quality.service';
import { SalesOrderService } from '../modules/sales-order/sales-order.service';

const logger = new Logger('SeedProductionDemo');
const DAY = 86_400_000;

/**
 * 원료 입고 (가정값, docs/backend/seed.md 원단위 기준 히트 5~6개분). 원료마다 입고일이 다른 2건이라 FIFO 차감을 화면에서 볼 수 있다.
 * 히트 1개(250t)에 철광석 444.445 · 석탄 166.667 · 석회석 41.667t, 합금철은 SS275 2.5t · SM355 5t.
 */
const RECEIPTS: { itemCode: string; tons: [string, string] }[] = [
  { itemCode: 'ORE01', tons: ['1500.000', '1500.000'] },
  { itemCode: 'COL01', tons: ['600.000', '600.000'] },
  { itemCode: 'LIM01', tons: ['150.000', '150.000'] },
  { itemCode: 'SMN01', tons: ['20.000', '20.000'] },
];

/** 수주 3건 (업무 프로세스 14.1 슬래브, 14.2 코일, 그리고 시작 전 계획) */
const ORDERS = [
  { key: 'slab', itemCode: 'SL-SS275-250x1200x10000', orderedQty: 10, dueInDays: 14 },
  { key: 'coil', itemCode: 'CL-SM355A-4.5x1500x544000', orderedQty: 6, dueInDays: 21 },
  { key: 'planned', itemCode: 'SL-SM355B-220x1400x9500', orderedQty: 8, dueInDays: 28 },
] as const;

const INSPECTED_PROCESS: Record<string, ProcessType> = {
  [LOT_TYPE.HEAT]: PROCESS_TYPE.STEELMAKING,
  [LOT_TYPE.SLAB]: PROCESS_TYPE.CONTINUOUS_CASTING,
  [LOT_TYPE.COIL]: PROCESS_TYPE.HOT_ROLLING,
};

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    if ((await prisma.salesOrder.count()) > 0 || (await prisma.lot.count()) > 0) {
      logger.warn('이미 수주·LOT이 있어 건너뜁니다. 처음부터 넣으려면 npm run db:reset 후 다시 실행하세요');
      return;
    }
    const users = app.get(AuthUserService);
    const userOf = async (employeeNo: string): Promise<AuthUser> => {
      const employee = await prisma.employee.findUniqueOrThrow({ where: { employeeNo } });
      const user = await users.load(employee.id);
      if (!user) throw new Error(`사원 ${employeeNo}을 불러올 수 없습니다`);
      return user;
    };
    const sales = await userOf('2103003');
    const producer = await userOf('1401006');
    const inspector = await userOf('2205013');
    const purchaser = await userOf('2207005');
    const purchaseHead = await userOf('1702004');

    await receiveRawMaterials(prisma, app.get(NumberingService), purchaser, purchaseHead);

    // 수주 등록 → 재고가 없어 전량 생산계획 (REQ-SO-003, REQ-PRD-001)
    const salesOrders = app.get(SalesOrderService);
    const customers = await prisma.customer.findMany({ orderBy: { id: 'asc' } });
    const planIds: Record<string, number> = {};
    for (const [index, order] of ORDERS.entries()) {
      const item = await prisma.item.findUniqueOrThrow({ where: { itemCode: order.itemCode } });
      const dueDate = new Date(Date.parse(`${seoulToday()}T00:00:00Z`) + order.dueInDays * DAY).toISOString().slice(0, 10);
      const created = await salesOrders.create(sales, { customerId: customers[index % customers.length].id, items: [{ itemId: item.id, orderedQty: order.orderedQty, dueDate }] });
      const planNo = created.items[0].productionPlanNo;
      if (!planNo) throw new Error(`${order.itemCode} 수주에 생산계획이 생기지 않았습니다`);
      planIds[order.key] = (await prisma.productionPlan.findUniqueOrThrow({ where: { productionPlanNo: planNo } })).id;
      logger.log(`수주 ${created.salesOrderNo} ${order.itemCode} ${order.orderedQty} → 생산계획 ${planNo}`);
    }

    // 실적 시뮬레이션: 슬래브 계획은 연주까지(검사 대기), 코일 계획은 연주까지 → 히트·슬래브 검사 합격 → 열연 투입 대기
    const simulation = app.get(ProductionSimulationService);
    const slab = await simulation.simulate(producer, planIds.slab, { randomSeed: 20261006 });
    logger.log(`슬래브 계획 시뮬레이션: ${slab.steps.map((s) => s.processType).join(' → ')} (${slab.productionPlanStatus})`);
    const coil = await simulation.simulate(producer, planIds.coil, { randomSeed: 20261007 });
    logger.log(`코일 계획 시뮬레이션: ${coil.steps.map((s) => s.processType).join(' → ')} (${coil.productionPlanStatus})`);

    const coilLots = await prisma.lot.findMany({ where: { productionResult: { productionPlanId: planIds.coil }, lotType: { in: [LOT_TYPE.HEAT, LOT_TYPE.SLAB] } }, orderBy: { id: 'asc' } });
    const quality = app.get(QualityService);
    for (const lot of coilLots) await quality.registerQualityInspection({ lotId: lot.id, values: await passingValues(prisma, lot.id) }, inspector);
    logger.log(`코일 계획 히트·슬래브 ${coilLots.length}건 검사 합격 → 열연 투입 화면에서 배정할 수 있어요`);
    logger.log('완료: 슬래브 계획(검사 대기), 코일 계획(열연 투입 대기), 시작 전 계획 1건');
  } finally {
    await app.close();
  }
}

/** 구매요청(발주 완료) → 발주(입고 완료) → 입고 → 원료 LOT. 입고 API가 아직 없어 데이터로 직접 넣는다 */
async function receiveRawMaterials(prisma: PrismaService, numbering: NumberingService, requester: AuthUser, approver: AuthUser) {
  const today = Date.parse(`${seoulToday()}T00:00:00Z`);
  for (const receipt of RECEIPTS) {
    const item = await prisma.item.findUniqueOrThrow({ where: { itemCode: receipt.itemCode } });
    if (item.defaultSupplierId === null) throw new Error(`${receipt.itemCode} 기본 공급업체가 없습니다`);
    for (const [index, ton] of receipt.tons.entries()) {
      // 입고일: 7일 전, 3일 전 (서울 날짜)
      const receivedAt = new Date(today - (index === 0 ? 7 : 3) * DAY + 3 * 3_600_000);
      await prisma.$transaction(async (tx) => {
        const pr = await tx.purchaseRequisition.create({
          data: {
            purchaseRequisitionNo: await numbering.nextDocumentNumber(tx, 'PURCHASE_REQUISITION', receivedAt),
            itemId: item.id,
            requestedTon: ton,
            desiredReceiptDate: seoulDateOnly(receivedAt),
            requesterId: requester.employeeId,
            approverId: approver.employeeId,
            approvedAt: receivedAt,
            requestReason: '시연용 시드 (생산 원료)',
            purchaseRequisitionStatus: 'ORDERED',
          },
        });
        const po = await tx.purchaseOrder.create({
          data: { purchaseOrderNo: await numbering.nextDocumentNumber(tx, 'PURCHASE_ORDER', receivedAt), supplierId: item.defaultSupplierId ?? 0, purchaseOrderStatus: 'RECEIVED' },
        });
        const poi = await tx.purchaseOrderItem.create({ data: { purchaseOrderId: po.id, purchaseRequisitionId: pr.id, itemId: item.id, orderedTon: ton, expectedReceiptDate: seoulDateOnly(receivedAt) } });
        const gr = await tx.goodsReceipt.create({
          data: { goodsReceiptNo: await numbering.nextDocumentNumber(tx, 'GOODS_RECEIPT', receivedAt), purchaseOrderItemId: poi.id, receivedTon: ton, receivedDate: seoulDateOnly(receivedAt) },
        });
        await tx.lot.create({
          data: {
            lotNo: await numbering.nextLotNumber(tx, 'RAW_MATERIAL', item.itemCode, receivedAt),
            lotType: LOT_TYPE.RAW_MATERIAL,
            itemId: item.id,
            goodsReceiptId: gr.id,
            yardId: item.defaultYardId,
            initialTon: ton,
            remainingTon: ton,
          },
        });
      });
    }
    logger.log(`원료 입고 ${receipt.itemCode} ${receipt.tons.join(' + ')}t`);
  }
}

/** 그 LOT에 적용되는 최신 검사 기준 항목마다 기준 범위 안의 값 (최소·최대 가운데, 한쪽만 있으면 그 안쪽) */
async function passingValues(prisma: PrismaService, lotId: number) {
  const lot = await prisma.lot.findUniqueOrThrow({ where: { id: lotId }, select: { lotType: true, steelGradeId: true, item: { select: { steelGradeId: true, thicknessMm: true } } } });
  const steelGradeId = lot.lotType === LOT_TYPE.HEAT ? lot.steelGradeId : (lot.item?.steelGradeId ?? null);
  const standard = await prisma.inspectionStandard.findFirstOrThrow({
    where: { processType: INSPECTED_PROCESS[lot.lotType], steelGradeId: steelGradeId ?? 0 },
    orderBy: { versionNo: 'desc' },
    include: { inspectionStandardItems: true },
  });
  return standard.inspectionStandardItems
    .filter((item) => isItemApplicable(item, lot.item?.thicknessMm ?? null))
    .map((item) => {
      const min = item.minValue;
      const max = item.maxValue;
      const value = min && max ? min.add(max).div(2) : max ? max.mul(new Prisma.Decimal('0.8')) : min ? min.mul(new Prisma.Decimal('1.1')) : new Prisma.Decimal(0);
      return { inspectionStandardItemId: item.id, measuredValue: value.toDecimalPlaces(4).toFixed(4) };
    });
}

main().catch((e: unknown) => {
  logger.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exitCode = 1;
});
