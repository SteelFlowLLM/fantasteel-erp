// 업무 프로세스 14.1 P1 슬래브 수주 전체 흐름의 핵심을 실제 DB(fs_sales)로 끝까지 잇는다. 단계별 세부 규칙은 각 모듈 테스트가 확인한다.
// 수주 → 부족분 생산계획 → 실적 시뮬레이션(제선·제강·연주) → 검사 자동 판정·자동 예약 → 출하요청·FIFO 배정 → 출고 확정·밀시트
// → LOT 역추적 → 수주 작업 로그, 그리고 Message → ERP 초안 → 요청자 확정 → 부서장 승인.
// 다른 테스트 파일과 같은 DB를 쓰므로 이 테스트 전용 슬래브 규격·원료 입고·채팅방을 직접 만든다.
import { Test, type TestingModule } from '@nestjs/testing';
import { BUSINESS_EVENT_TYPE, calcTheoreticalWeightTon, type AuthUser } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { seoulToday } from '../../common/time/seoul-date';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { LotService } from '../lot/lot.service';
import { MessageActionService } from '../message-action/message-action.service';
import { ProductionSimulationService } from '../production/production-simulation.service';
import { PurchasingService } from '../purchasing/purchasing.service';
import { isItemApplicable } from '../quality/inspection-judge';
import { QualityService } from '../quality/quality.service';
import { ShipmentService } from '../shipment/shipment.service';
import { SalesOrderService } from './sales-order.service';

let moduleRef: TestingModule;
let prisma: PrismaService;
const users: Record<'sales' | 'production' | 'quality' | 'logistics' | 'purchase' | 'purchaseHead', AuthUser> = {} as never;

async function receiveRawMaterial(itemCode: string, ton: string, seq: number) {
  const item = await prisma.item.findUniqueOrThrow({ where: { itemCode } });
  const supplier = await prisma.supplier.findFirstOrThrow({ orderBy: { id: 'asc' } });
  const date = new Date(`${seoulToday()}T00:00:00Z`);
  const pr = await prisma.purchaseRequisition.create({ data: { purchaseRequisitionNo: `PR-FLOW-${seq}`, itemId: item.id, requestedTon: ton, desiredReceiptDate: date, requesterId: users.purchase.employeeId, purchaseRequisitionStatus: 'ORDERED' } });
  const po = await prisma.purchaseOrder.create({ data: { purchaseOrderNo: `PO-FLOW-${seq}`, supplierId: supplier.id } });
  const poi = await prisma.purchaseOrderItem.create({ data: { purchaseOrderId: po.id, purchaseRequisitionId: pr.id, itemId: item.id, orderedTon: ton } });
  const gr = await prisma.goodsReceipt.create({ data: { goodsReceiptNo: `GR-FLOW-${seq}`, purchaseOrderItemId: poi.id, receivedTon: ton, receivedDate: date } });
  await prisma.lot.create({ data: { lotNo: `RM-FLOW-${itemCode}-${seq}`, lotType: 'RAW_MATERIAL', itemId: item.id, goodsReceiptId: gr.id, yardId: item.defaultYardId, initialTon: ton, remainingTon: ton } });
}

/** 기준 범위 가운데 값(상·하한 중 하나만 있으면 그 안쪽)으로 적용 항목을 모두 채운다. overrides로 항목 코드별 값을 바꾼다 */
async function inspect(lotId: number, processType: string, steelGradeId: number, overrides: Record<string, string> = {}) {
  const lot = await prisma.lot.findUniqueOrThrow({ where: { id: lotId }, include: { item: true } });
  const standard = await prisma.inspectionStandard.findFirstOrThrow({ where: { processType, steelGradeId }, orderBy: { versionNo: 'desc' }, include: { inspectionStandardItems: true } });
  const inside = (min: Prisma.Decimal | null, max: Prisma.Decimal | null) =>
    min && max ? min.add(max).div(2) : max ? max.div(2) : min ? min.add(1) : new Prisma.Decimal(1);
  const values = standard.inspectionStandardItems
    .filter((i) => isItemApplicable(i, lot.item?.thicknessMm ?? null))
    .map((i) => ({ inspectionStandardItemId: i.id, measuredValue: overrides[i.inspectionItemCode] ?? inside(i.minValue, i.maxValue).toFixed(4) }));
  return moduleRef.get(QualityService).registerQualityInspection({ lotId, values }, users.quality);
}

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  const authUsers = moduleRef.get(AuthUserService);
  const load = async (employeeNo: string) => {
    const employee = await prisma.employee.findUniqueOrThrow({ where: { employeeNo } });
    const user = await authUsers.load(employee.id);
    if (!user) throw new Error(employeeNo);
    return user;
  };
  Object.assign(users, {
    sales: await load('2103003'),
    production: await load('1401006'),
    quality: await load('2205013'),
    logistics: await load('2304015'),
    purchase: await load('2207005'),
    purchaseHead: await load('1702004'),
  });
  // 히트 1개: 철광석 444.445 · 석탄 166.667 · 석회석 41.667 t, 합금철 SS275 2.5 t
  for (const [index, [code, ton]] of ([['ORE01', '1000'], ['COL01', '400'], ['LIM01', '100'], ['SMN01', '10']] as const).entries()) await receiveRawMaterial(code, ton, index + 1);
}, 60_000);

afterAll(async () => {
  await moduleRef?.close();
});

describe('14.1 P1 슬래브 수주 전체 흐름 (핵심)', () => {
  it('수주부터 출고·밀시트·추적·작업 로그까지 끝까지 이어진다', async () => {
    const base = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'SL-SS275-250x1200x10000' } });
    const slab = await prisma.item.create({
      data: { itemCode: 'SL-FLOW-1', itemName: '흐름 확인 슬래브', itemType: 'SLAB', unitType: 'QTY', steelGradeId: base.steelGradeId, thicknessMm: '250', widthMm: '1200', lengthMm: '9990', theoreticalWeightTon: calcTheoreticalWeightTon('250', '1200', '9990'), defaultYardId: base.defaultYardId },
    });
    const steelGradeId = slab.steelGradeId ?? 0;
    const customerId = (await prisma.customer.findFirstOrThrow({ orderBy: { id: 'asc' } })).id;

    // 1. 재고가 없으니 10매 모두 부족 → 생산계획
    const salesOrders = moduleRef.get(SalesOrderService);
    const order = await salesOrders.create(users.sales, { customerId, items: [{ itemId: slab.id, orderedQty: 10, dueDate: '2026-12-31' }] });
    expect(order.items[0]).toMatchObject({ orderedQty: 10, reservedQty: 0, shortageQty: 10 });
    const plan = await prisma.productionPlan.findUniqueOrThrow({ where: { productionPlanNo: order.items[0].productionPlanNo ?? '' } });
    expect(plan).toMatchObject({ shortageQty: 10, heatCount: 1, productionPlanStatus: 'PLANNED' });

    // 2. 실적 시뮬레이션: 제선·제강·연주 → 계획 완료, 슬래브는 판정 대기
    const simulated = await moduleRef.get(ProductionSimulationService).simulate(users.production, plan.id, { randomSeed: 20261013 });
    expect(simulated.steps.map((s) => s.processType)).toEqual(['IRONMAKING', 'STEELMAKING', 'CONTINUOUS_CASTING']);
    expect((await prisma.productionPlan.findUniqueOrThrow({ where: { id: plan.id } })).productionPlanStatus).toBe('COMPLETED');
    const lotsOf = (lotType: string) => prisma.lot.findMany({ where: { lotType, productionResult: { productionPlanId: plan.id } }, orderBy: { lotNo: 'asc' } });
    const [heat] = await lotsOf('HEAT');
    const slabs = await lotsOf('SLAB');
    expect(slabs.length).toBeGreaterThanOrEqual(10);

    // 3. 검사: 슬래브 합격만으로는 예약하지 않고, 히트 합격으로 적격이 되면 원래 수주에 자동 예약한다
    for (const lot of slabs) await inspect(lot.id, 'CONTINUOUS_CASTING', steelGradeId);
    expect((await salesOrders.detail(order.salesOrderId)).items[0].activeReservedQty).toBe(0);
    const heatResult = await inspect(heat.id, 'STEELMAKING', steelGradeId);
    expect(heatResult).toMatchObject({ inspectionResult: 'PASS', stockSync: { autoReservedQty: 10 } });
    expect((await salesOrders.detail(order.salesOrderId)).items[0].activeReservedQty).toBe(10);

    // 4. 출하요청 10매 → FIFO 추천대로 배정 확정 → 배정 확정
    const shipments = moduleRef.get(ShipmentService);
    const inventory = moduleRef.get(InventoryService);
    const salesOrderItemId = order.items[0].salesOrderItemId;
    const request = await shipments.create(users.sales, { customerId, items: [{ salesOrderItemId, requestQty: 10 }] });
    const shipmentRequestItemId = request.items[0].id;
    const recommendation = await inventory.recommendAllocations(users.sales, { allocationPurpose: 'SHIPMENT', shipmentRequestItemId });
    const lotIds = recommendation.candidates.filter((c) => c.isRecommended).map((c) => c.lotId);
    expect(lotIds).toHaveLength(10);
    await inventory.confirmAllocations(users.sales, { allocationPurpose: 'SHIPMENT', shipmentRequestItemId, lotIds });
    expect((await shipments.findOne(users.sales, request.id)).shipmentRequestStatus).toBe('ALLOCATED');

    // 5. 출고 확정 → 예약 전환·출하 완료, 밀시트 1장(이 히트의 성분값)
    const issued = await shipments.issue(users.logistics, request.id);
    expect(issued.shipmentRequestStatus).toBe('ISSUED');
    const detail = await salesOrders.detail(order.salesOrderId);
    expect(detail.items[0]).toMatchObject({ shippedQty: 10, salesOrderItemStatus: 'SHIPPED', activeReservedQty: 0 });
    const sheets = await shipments.listMillSheets({ shipmentRequestId: request.id, page: 1, size: 20 });
    expect(sheets.items).toHaveLength(1);
    const sheet = await shipments.findMillSheet(sheets.items[0].id);
    expect(sheet.snapshot.heats.map((h) => h.heatNo)).toEqual([heat.lotNo]);
    expect(sheet.snapshot.totalQty).toBe(10);

    // 6. 출고한 슬래브 역추적: 슬래브 → 히트 → 용선 → 원료
    const trace = await moduleRef.get(LotService).trace(lotIds[0], 'backward');
    expect(new Set(trace.nodes.map((n) => n.lotType))).toEqual(new Set(['SLAB', 'HEAT', 'HOT_METAL', 'RAW_MATERIAL']));

    // 7. 수주 작업 로그에 전체 흐름이 남는다 (작업 로그는 본 거래와 같은 트랜잭션, REQ-LOG-002)
    const types = [...new Set((await prisma.businessEvent.findMany({ where: { salesOrderId: order.salesOrderId } })).map((e) => e.businessEventType))];
    expect(types).toEqual(
      expect.arrayContaining([
      BUSINESS_EVENT_TYPE.SALES_ORDER_CREATED,
      BUSINESS_EVENT_TYPE.PRODUCTION_PLAN_CREATED,
      BUSINESS_EVENT_TYPE.PRODUCTION_STARTED,
      BUSINESS_EVENT_TYPE.PRODUCTION_RESULT_REGISTERED,
      BUSINESS_EVENT_TYPE.INSPECTION_REGISTERED,
      BUSINESS_EVENT_TYPE.RESERVATION_CREATED,
      BUSINESS_EVENT_TYPE.SHIPMENT_REQUEST_CREATED,
      BUSINESS_EVENT_TYPE.ALLOCATION_RECOMMENDED,
      BUSINESS_EVENT_TYPE.ALLOCATION_CONFIRMED,
      BUSINESS_EVENT_TYPE.GOODS_ISSUE_CONFIRMED,
      BUSINESS_EVENT_TYPE.RESERVATION_CONVERTED,
      BUSINESS_EVENT_TYPE.MILL_SHEET_ISSUED,
      ]),
    );
  });

  it('Message → ERP: 메시지 초안 → 요청자 확정 → 승인 대기 구매요청 → 부서장 승인', async () => {
    const room = await prisma.chatRoom.create({
      data: { chatRoomType: 'GROUP', chatRoomName: '원료 협의 (흐름 확인)', chatRoomMembers: { create: [users.purchase, users.purchaseHead].map((u) => ({ employeeId: u.employeeId })) } },
    });
    const message = await prisma.message.create({ data: { chatRoomId: room.id, senderId: users.purchase.employeeId, content: '실리코망가니즈 20톤 필요합니다' } });
    const drafts = moduleRef.get(MessageActionService);
    const { id } = await drafts.create(users.purchase, message.id);
    const smn = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'SMN01' } });
    await drafts.update(users.purchase, id, { payload: { itemId: smn.id, requestedTon: '20', desiredReceiptDate: '2026-12-20' } });
    const outcome = await drafts.confirm(users.purchase, id, {});
    expect(outcome).toMatchObject({ executed: true, draft: { draftStatus: 'EXECUTED', result: { table: 'purchase_requisition', status: 'WAITING_APPROVAL' } } });

    const requisitionId = outcome.draft.result?.id ?? 0;
    expect(await moduleRef.get(PurchasingService).approve(users.purchaseHead, requisitionId)).toMatchObject({ purchaseRequisitionStatus: 'APPROVED' });
    const events = await prisma.businessEvent.findMany({ where: { actionDraftId: id }, orderBy: { id: 'asc' } });
    expect(events.map((e) => e.businessEventType)).toEqual([
      BUSINESS_EVENT_TYPE.DRAFT_CREATED,
      BUSINESS_EVENT_TYPE.DRAFT_CONFIRMED,
      BUSINESS_EVENT_TYPE.PURCHASE_REQUISITION_CREATED,
      BUSINESS_EVENT_TYPE.DRAFT_EXECUTED,
    ]);
    const approved = await prisma.businessEvent.findFirstOrThrow({ where: { businessEventType: BUSINESS_EVENT_TYPE.PURCHASE_REQUISITION_APPROVED, targetId: requisitionId } });
    expect(approved.actorEmployeeId).toBe(users.purchaseHead.employeeId);
  });
});
