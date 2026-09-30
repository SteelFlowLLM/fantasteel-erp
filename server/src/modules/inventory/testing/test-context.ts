import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { calcTheoreticalWeightTon, type AuthUser } from '@fantasteel/shared';
import { AuthUserService } from '../../../common/auth/auth-user.service';
import { NumberingService } from '../../../common/numbering/numbering.service';
import type { RealtimeService } from '../../../common/realtime/realtime.service';
import { StorageService } from '../../../common/storage/storage.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { BusinessEventRecorder } from '../../business-event/business-event.recorder';
import { NotificationSender } from '../../notification/notification.sender';
import { ProductionPlanWriter } from '../../production/production-plan.writer';
import { IdempotencyKeyRepository } from '../../sales-order/idempotency-key.repository';
import { IdempotencyService } from '../../sales-order/idempotency.service';
import { SalesOrderStatusService } from '../../sales-order/sales-order-status.service';
import { SalesOrderRepository } from '../../sales-order/sales-order.repository';
import { SalesOrderService } from '../../sales-order/sales-order.service';
import { GoodsIssueService } from '../../shipment/goods-issue.service';
import { MillSheetPdfRenderer } from '../../shipment/mill-sheet-pdf.renderer';
import { MillSheetRepository } from '../../shipment/mill-sheet.repository';
import { MillSheetService } from '../../shipment/mill-sheet.service';
import { ShipmentRequestService } from '../../shipment/shipment-request.service';
import { ShipmentRepository } from '../../shipment/shipment.repository';
import { AllocationRepository } from '../allocation.repository';
import { AllocationService } from '../allocation.service';
import { InventoryRepository } from '../inventory.repository';
import { InventoryService } from '../inventory.service';
import { StockService } from '../stock.service';

// 통합 테스트용 조립. 실제 DB(각자 배정받은 DB)와 실제 Prisma를 쓰고, 소켓 발송만 뺀다.
// 시드 데이터는 지우지 않는다: 테스트마다 자기 고객사·규격·LOT을 새로 만들어 그 안에서만 검증한다.

const SEED_EMPLOYEE_NO = { sales: '2104012', logistics: '2005024', production: '1803021' } as const;
const DAY_MS = 86_400_000;
const DEFAULT_TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:54322/fs_sales';

export const uniq = () => randomBytes(4).toString('hex').toUpperCase();

export interface TestStock {
  heatId: number;
  heatNo: string;
  lotIds: number[];
  lotNos: string[];
}

export type TestContext = Awaited<ReturnType<typeof createTestContext>>;

export async function createTestContext() {
  // server/.env(공용 개발 DB)를 읽지 않는다. 테스트가 만든 규격·고객사가 공용 DB 화면에 섞이지 않게
  // TEST_DATABASE_URL → DATABASE_URL → 수주·출하 담당 전용 DB(fs_sales) 순으로 고른다.
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  process.env.STORAGE_DIR = mkdtempSync(join(tmpdir(), 'fs-sales-test-'));

  const prisma = new PrismaService();
  await prisma.$connect();
  const realtime = { changed: () => undefined, toEmployees: () => undefined } as unknown as RealtimeService;
  const numbering = new NumberingService();
  const storage = new StorageService();
  const events = new BusinessEventRecorder(realtime);
  const notifications = new NotificationSender(realtime);
  const stock = new StockService(events, realtime);
  const planWriter = new ProductionPlanWriter(numbering, events, notifications, stock, realtime);
  const salesOrderStatus = new SalesOrderStatusService(realtime);
  const idempotency = new IdempotencyService(prisma, new IdempotencyKeyRepository());

  const shipmentRepo = new ShipmentRepository();
  const shipmentRequests = new ShipmentRequestService(prisma, shipmentRepo, numbering, stock, events, notifications, realtime);
  const renderer = new MillSheetPdfRenderer();
  const millSheets = new MillSheetService(prisma, new MillSheetRepository(), numbering, storage, renderer, events, realtime);
  const goodsIssues = new GoodsIssueService(prisma, shipmentRepo, idempotency, numbering, stock, salesOrderStatus, millSheets, events, notifications, realtime);
  const salesOrders = new SalesOrderService(prisma, new SalesOrderRepository(), idempotency, numbering, stock, planWriter, shipmentRequests, events, notifications, realtime);
  const allocations = new AllocationService(prisma, new AllocationRepository(), stock, events, notifications, realtime);
  const inventories = new InventoryService(prisma, new InventoryRepository());

  const authUsers = new AuthUserService(prisma);
  const loadUser = async (employeeNo: string): Promise<AuthUser> => {
    const e = await prisma.employee.findUnique({ where: { employeeNo } });
    const user = e ? await authUsers.load(e.id) : null;
    if (!user) throw new Error(`시드 사원 ${employeeNo}이 없습니다. prisma/seed.ts를 먼저 실행하세요`);
    return user;
  };
  const users = {
    sales: await loadUser(SEED_EMPLOYEE_NO.sales),
    logistics: await loadUser(SEED_EMPLOYEE_NO.logistics),
    production: await loadUser(SEED_EMPLOYEE_NO.production),
  };
  const grade = await prisma.steelGrade.findFirstOrThrow({ where: { steelGradeCode: 'SS275' }, include: { compositionSpecs: true } });
  const slabItem = await prisma.item.findFirstOrThrow({ where: { itemType: 'SLAB' } });
  const coilItem = await prisma.item.findFirstOrThrow({ where: { itemType: 'COIL' } });

  async function createCustomer() {
    const code = `T-${uniq()}`;
    return prisma.customer.create({ data: { customerCode: code, customerName: `테스트고객 ${code}` } });
  }

  /** 다른 테스트·시드와 겹치지 않는 새 규격(재고 풀 포함). 폭을 무작위로 잡아 유니크 제약을 피한다. */
  async function createSpec(itemType: 'SLAB' | 'COIL') {
    const widthMm = 1000 + Math.floor(Math.random() * 800_000) / 100;
    const [thicknessMm, lengthMm] = itemType === 'SLAB' ? [250, 10000] : [4.5, 400000];
    const spec = await prisma.productSpec.create({
      data: {
        specCode: `T-${itemType === 'SLAB' ? 'SL' : 'CL'}-${uniq()}`,
        itemId: itemType === 'SLAB' ? slabItem.id : coilItem.id,
        steelGradeId: grade.id,
        thicknessMm, widthMm, lengthMm,
        theoreticalWeightTon: calcTheoreticalWeightTon(thicknessMm, widthMm, lengthMm),
      },
    });
    await prisma.inventory.create({ data: { productSpecId: spec.id } });
    return spec;
  }

  /** 슬래브 규격과 대응 코일 규격 (열연 배정 테스트용). */
  async function createMappedSpecs() {
    const slabSpec = await createSpec('SLAB');
    const coilSpec = await createSpec('COIL');
    await prisma.specMapping.create({ data: { slabSpecId: slabSpec.id, coilSpecId: coilSpec.id } });
    return { slabSpec, coilSpec };
  }

  /**
   * 히트 1개와 그 하위 제품 LOT qty개를 만든다. 기본은 전부 합격(적격)이고 재고 풀에 넣는다.
   * daysAgo가 클수록 먼저 생산된 것(FIFO 앞).
   */
  async function createStock(
    spec: { id: number; steelGradeId: number },
    qty: number,
    options: { lotType?: 'SLAB' | 'COIL'; heatPassed?: boolean | null; lotPassed?: boolean | null; daysAgo?: number } = {},
  ): Promise<TestStock> {
    const lotType = options.lotType ?? 'SLAB';
    const heatPassed = options.heatPassed === undefined ? true : options.heatPassed;
    const lotPassed = options.lotPassed === undefined ? true : options.lotPassed;
    const base = new Date(Date.now() - (options.daysAgo ?? 5) * DAY_MS);
    const tag = uniq();
    const heatNo = `HT-T-${tag}`;
    const heat = await prisma.lot.create({
      data: { lotNo: heatNo, lotType: 'HEAT', steelGradeId: spec.steelGradeId, initialTon: 250, converterNo: 'T', isPassed: heatPassed, lotStatus: 'CONSUMED', producedAt: base },
    });
    if (heatPassed !== null) {
      await prisma.qualityInspection.create({
        data: {
          qualityInspectionNo: `QI-T-${tag}-H`, lotId: heat.id, processCode: 'STEELMAKING', inspectionResult: heatPassed ? 'PASS' : 'FAIL', inspectedAt: base,
          values: { create: grade.compositionSpecs.map((c) => ({ inspectionItemCode: c.elementCode, inspectionItemName: c.elementCode, unit: '%', maxValue: c.maxValue, measuredValue: Number(c.maxValue) * 0.5, isPassed: true, sortOrder: c.sortOrder })) },
        },
      });
    }
    const lotIds: number[] = [];
    const lotNos: string[] = [];
    for (let i = 1; i <= qty; i++) {
      const lotNo = `${lotType === 'COIL' ? 'C' : ''}${heatNo}-${String(i).padStart(2, '0')}`;
      const lot = await prisma.lot.create({
        data: {
          lotNo, lotType, productSpecId: spec.id, steelGradeId: spec.steelGradeId, heatLotId: heat.id, isPassed: lotPassed, lotStatus: 'IN_STOCK',
          producedAt: new Date(base.getTime() + i * 60_000),
        },
      });
      if (lotPassed !== null) {
        await prisma.qualityInspection.create({
          data: {
            qualityInspectionNo: `QI-T-${tag}-${i}`, lotId: lot.id, processCode: lotType === 'COIL' ? 'HOT_ROLLING' : 'CASTING', inspectionResult: lotPassed ? 'PASS' : 'FAIL',
            inspectedAt: lot.producedAt,
            values: { create: [{ inspectionItemCode: 'SURFACE_DEFECT_COUNT', inspectionItemName: '표면 결함 수', unit: '개', maxValue: 2, measuredValue: i % 2, isPassed: lotPassed, sortOrder: 1 }] },
          },
        });
      }
      lotIds.push(lot.id);
      lotNos.push(lotNo);
    }
    if (heatPassed === true && lotPassed === true) await prisma.inventory.update({ where: { productSpecId: spec.id }, data: { onHandQty: { increment: qty } } });
    return { heatId: heat.id, heatNo, lotIds, lotNos };
  }

  const pool = (productSpecId: number) => prisma.inventory.findUniqueOrThrow({ where: { productSpecId } });
  const dueIn = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);

  /** 수주 1건(품목 1개)을 등록하고, 필요하면 출하요청 → FIFO 추천대로 배정 확정까지 진행한다. */
  async function orderOne(customerId: number, productSpecId: number, orderedQty: number) {
    return salesOrders.create({ customerId, dueDate: dueIn(30), items: [{ productSpecId, orderedQty }] }, users.sales);
  }
  async function requestAndAllocate(customerId: number, salesOrderItemId: number, requestQty: number) {
    const request = await shipmentRequests.create({ customerId, requestedShipDate: dueIn(1), items: [{ salesOrderItemId, requestQty }] }, users.sales);
    const shipmentRequestItemId = request.items[0].id;
    const recommendation = await allocations.recommend({ purpose: 'SHIPMENT', shipmentRequestItemId }, users.sales);
    const confirmed = await allocations.confirm({ purpose: 'SHIPMENT', shipmentRequestItemId, lotIds: recommendation.recommendedLots.map((l) => l.lotId) }, users.sales);
    return { request, shipmentRequestItemId, recommendation, confirmed };
  }

  return {
    prisma, stock, salesOrders, shipmentRequests, goodsIssues, millSheets, allocations, inventories, users,
    createCustomer, createSpec, createMappedSpecs, createStock, pool, dueIn, orderOne, requestAndAllocate,
    close: () => prisma.$disconnect(),
  };
}

/** AppException의 업무 에러 코드를 꺼낸다 (성공하면 null). */
export async function errorCodeOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? `UNEXPECTED: ${(e as Error).message}`;
  }
}
