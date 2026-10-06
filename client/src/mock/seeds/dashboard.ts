// 대시보드 시계열 시드 (BP-DSH-01 "추이 집계에는 시계열 시드가 필요하다", BP-SEED-01).
// core 시드는 9월 생산 5일·출고 1일뿐이라 출하 실적·생산량·불합격률 위젯이 비어 보인다. 그래서 끝난 거래 4건을 서비스로 더 만든다.
// - 8월 말 수주 4건 → 9월 실적 시뮬레이션(고정 난수 시드) → 검사 합격 → 9월 출하요청·출고 확정. 모두 출하완료라 남는 재고·예약이 없다.
// - 수주 매수 = 히트에서 나오는 매수(여재가 남지 않는 크기, BP-SEED-01). 규격은 업무 프로세스 14.1·14.2와 core 시드가 쓰지 않는 것만 쓴다.
// - 원료는 8-31 입고분을 이 시드의 히트 소요만큼 정확히 산다(같은 계산 함수). 입고일이 가장 이르므로 FIFO로 먼저 다 쓰이고,
//   core 시드의 원료 LOT 잔량·입고예정은 그대로다 → 14.1 MRP(실리코망가니즈 순소요 1.500t 등) 결과가 바뀌지 않는다.
// - 이 시드가 만든 구매 알림(승인 요청·승인 결과)은 8월에 처리한 것으로 읽음 표시한다(셸의 안 읽은 수를 바꾸지 않게).
// 등록: seeds/index.ts의 AREA_SEEDERS에서 core 뒤에 { key: 'dashboard', run: seedDashboard } (병합 단계에서).
import { decMul, decSum, TON_DIGITS } from '@/lib/decimal';
import { typicalPassValue } from '@/lib/inspectionJudgment';
import { ferroalloyTonFor, hotMetalTonFor, rawMaterialTonFor } from '@/lib/mrp';
import type { ProductionPlanRow } from '@/mock/schema';
import { updateRow, type MockTx } from '@/mock/store';
import {
  approvePurchaseRequisition,
  confirmGoodsIssue,
  confirmShipmentAllocations,
  createPurchaseOrders,
  createPurchaseRequisition,
  createSalesOrder,
  createShipmentRequest,
  inspectionFormOf,
  productionSettingOf,
  productItemTypeOf,
  receiveGoods,
  registerInspection,
  routingYieldOf,
  simulatePlan,
  userActor,
  type PersonActor,
} from '@/mock/services';

/** 이 시드가 만드는 기록 (문서·테스트가 가리키는 값) */
export const SEED_DASHBOARD = {
  /** 수주 4건: 규격 · 매수(= 히트에서 나오는 매수) · 고객사 · 등록 시각 · 납기 */
  salesOrders: [
    { itemCode: 'SL-SM355A-250x1200x10000', qty: 10, customerCode: 'CUS-01', createdAt: '2026-08-24T10:00:00+09:00', dueDate: '2026-09-12' },
    { itemCode: 'CL-SPHC-2.3x1200x1065000', qty: 10, customerCode: 'CUS-04', createdAt: '2026-08-25T10:00:00+09:00', dueDate: '2026-09-15' },
    { itemCode: 'SL-SS275-220x1400x9500', qty: 20, customerCode: 'CUS-03', createdAt: '2026-08-26T10:00:00+09:00', dueDate: '2026-09-26' },
    { itemCode: 'SL-SM355B-220x1400x9500', qty: 10, customerCode: 'CUS-02', createdAt: '2026-08-27T10:00:00+09:00', dueDate: '2026-09-30' },
  ],
  randomSeeds: [6001, 6002, 6003, 6004],
  /** 원료 입고일 (core 시드의 첫 입고 09-02보다 이르다) */
  receiptDate: '2026-08-31',
  /** 출고 확정일 */
  issueDates: ['2026-09-08', '2026-09-11', '2026-09-16', '2026-09-25', '2026-09-29'],
} as const;

function txAt(tx: MockTx, iso: string): MockTx {
  const now = new Date(iso);
  return { tables: tx.tables, now, nowIso: now.toISOString() };
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`대시보드 시드 참조를 찾지 못했어요: ${what}`);
  return value;
}

export function seedDashboard(tx: MockTx): void {
  const t = tx.tables;
  const emp = (employeeNo: string): PersonActor => userActor(required(t.employee.find((e) => e.employeeNo === employeeNo), employeeNo).id);
  const itemOf = (code: string) => required(t.item.find((i) => i.itemCode === code), code);
  const customerId = (code: string) => required(t.customer.find((c) => c.customerCode === code), code).id;

  const sales = emp('2103003');
  const salesHead = emp('1608002');
  const purchase = emp('2207005');
  const purchaseHead = emp('1702004');
  const steelmakingStaff = emp('2402011');
  const quality = emp('2205013');
  const logistics = emp('2304015');

  const inspect = (at: string, lotId: number) => {
    const form = inspectionFormOf(t, lotId);
    registerInspection(txAt(tx, at), quality, {
      lotId,
      values: form.items.map((i) => ({ inspectionStandardItemId: i.inspectionStandardItemId, measuredValue: typicalPassValue(i) })),
    });
  };
  const lotsOf = (planId: number, lotType: 'HEAT' | 'SLAB' | 'COIL') => t.lot.filter((l) => l.productionPlanId === planId && l.lotType === lotType).sort((a, b) => a.id - b.id);

  // 1. 8월 말 수주 4건 (재고 없음 → 부족분 전부 생산계획) ─────────────
  const [smA, sphcCoil, ss275, smB] = SEED_DASHBOARD.salesOrders.map((salesOrder, index) => {
    const created = createSalesOrder(txAt(tx, salesOrder.createdAt), index % 2 === 0 ? sales : salesHead, {
      customerId: customerId(salesOrder.customerCode),
      items: [{ itemId: itemOf(salesOrder.itemCode).id, orderedQty: salesOrder.qty, dueDate: salesOrder.dueDate }],
    });
    return { salesOrderItem: created.items[0], plan: required(created.productionPlans[0], `${salesOrder.itemCode} 생산계획`) };
  });
  const plans: ProductionPlanRow[] = [smA.plan, sphcCoil.plan, ss275.plan, smB.plan];

  // 2. 원료: 이 계획들의 히트 소요만큼 정확히 (실적 서비스와 같은 계산 함수) ─────
  const heatCapacity = productionSettingOf(t).heatCapacityTon;
  const needs = new Map<number, string[]>();
  const addNeed = (itemId: number, ton: string) => needs.set(itemId, [...(needs.get(itemId) ?? []), ton]);
  for (const plan of plans) {
    const item = itemOf(required(t.item.find((i) => i.id === plan.itemId), '계획 규격').itemCode);
    const steelmakingYield = routingYieldOf(t, productItemTypeOf(item), 'STEELMAKING');
    const hotMetalTon = hotMetalTonFor(heatCapacity, steelmakingYield);
    const heatTon = decMul(hotMetalTon, steelmakingYield, TON_DIGITS);
    for (let heat = 0; heat < plan.heatCount; heat += 1) {
      for (const consumption of t.specificConsumption) {
        const material = required(t.item.find((i) => i.id === consumption.itemId), '원료');
        if (consumption.steelGradeId === null && material.rawMaterialType !== 'FERROALLOY') addNeed(material.id, rawMaterialTonFor(hotMetalTon, consumption.consumptionRate));
        if (consumption.steelGradeId !== null && consumption.steelGradeId === item.steelGradeId && material.rawMaterialType === 'FERROALLOY') {
          addNeed(material.id, ferroalloyTonFor(heatTon, consumption.consumptionRate));
        }
      }
    }
  }
  // 구매요청 1건 = 원료 1품목(ERD)이라 원료마다 요청한다
  const prs = [...needs].map(([itemId, tons]) =>
    createPurchaseRequisition(txAt(tx, '2026-08-27T14:00:00+09:00'), purchase, {
      itemId,
      requestedTon: decSum(tons, TON_DIGITS),
      desiredReceiptDate: SEED_DASHBOARD.receiptDate,
      requestReason: '8월 수주 4건 생산 원료',
    }),
  );
  for (const pr of prs) approvePurchaseRequisition(txAt(tx, '2026-08-27T15:00:00+09:00'), purchaseHead, { purchaseRequisitionId: pr.id });
  createPurchaseOrders(txAt(tx, '2026-08-27T16:00:00+09:00'), purchase, { purchaseRequisitionIds: prs.map((pr) => pr.id) });
  for (const pr of prs) {
    const poLine = required(t.purchaseOrderItem.find((l) => l.purchaseRequisitionId === pr.id), `발주 줄 ${pr.id}`);
    receiveGoods(txAt(tx, '2026-08-31T10:00:00+09:00'), purchase, { purchaseOrderItemId: poLine.id, receivedTon: poLine.orderedTon, receiptDate: SEED_DASHBOARD.receiptDate });
  }
  // 8월에 처리한 구매 알림은 읽음
  const prLinks = prs.map((pr) => `?pr=${pr.id}`);
  for (const notification of t.notification.filter((n) => !n.isRead && prLinks.some((link) => n.linkPath?.endsWith(link)))) {
    updateRow(txAt(tx, '2026-08-27T17:00:00+09:00'), 'notification', notification.id, { isRead: true, readAt: new Date('2026-08-27T17:00:00+09:00').toISOString() });
  }

  // 3. 9월 실적 시뮬레이션 → 검사 합격 (합격하면 원래 수주에 자동 예약) ─────────
  const [seedA, seedCoil, seedSs, seedB] = SEED_DASHBOARD.randomSeeds;
  simulatePlan(txAt(tx, '2026-09-03T18:00:00+09:00'), steelmakingStaff, { productionPlanId: smA.plan.id, randomSeed: seedA });
  for (const lot of [...lotsOf(smA.plan.id, 'SLAB'), ...lotsOf(smA.plan.id, 'HEAT')]) inspect('2026-09-04T09:30:00+09:00', lot.id);

  // 코일 계획: 연주 → 슬래브·히트 합격 → 다시 실행해 열연 → 코일 합격
  simulatePlan(txAt(tx, '2026-09-06T18:00:00+09:00'), steelmakingStaff, { productionPlanId: sphcCoil.plan.id, randomSeed: seedCoil });
  for (const lot of [...lotsOf(sphcCoil.plan.id, 'SLAB'), ...lotsOf(sphcCoil.plan.id, 'HEAT')]) inspect('2026-09-07T09:30:00+09:00', lot.id);
  simulatePlan(txAt(tx, '2026-09-07T16:00:00+09:00'), steelmakingStaff, { productionPlanId: sphcCoil.plan.id, randomSeed: seedCoil });
  for (const lot of lotsOf(sphcCoil.plan.id, 'COIL')) inspect('2026-09-08T09:30:00+09:00', lot.id);

  simulatePlan(txAt(tx, '2026-09-11T20:00:00+09:00'), steelmakingStaff, { productionPlanId: ss275.plan.id, randomSeed: seedSs });
  for (const lot of [...lotsOf(ss275.plan.id, 'SLAB'), ...lotsOf(ss275.plan.id, 'HEAT')]) inspect('2026-09-12T09:30:00+09:00', lot.id);

  simulatePlan(txAt(tx, '2026-09-22T18:00:00+09:00'), steelmakingStaff, { productionPlanId: smB.plan.id, randomSeed: seedB });
  for (const lot of [...lotsOf(smB.plan.id, 'SLAB'), ...lotsOf(smB.plan.id, 'HEAT')]) inspect('2026-09-23T09:30:00+09:00', lot.id);

  // 4. 출하요청 → FIFO 배정 확정 → 출고 확정 (밀시트 자동 발행) ─────────────
  const ship = (salesOrderItemId: number, qty: number, requestedAt: string, issueDate: string) => {
    const soItem = required(t.salesOrderItem.find((i) => i.id === salesOrderItemId), `수주 품목 ${salesOrderItemId}`);
    const so = required(t.salesOrder.find((s) => s.id === soItem.salesOrderId), `수주 ${soItem.salesOrderId}`);
    const request = createShipmentRequest(txAt(tx, requestedAt), sales, {
      customerId: so.customerId,
      requestedShipDate: issueDate,
      items: [{ salesOrderItemId, requestQty: qty }],
    });
    confirmShipmentAllocations(txAt(tx, requestedAt), sales, {
      shipmentRequestId: request.shipmentRequest.id,
      lines: request.recommendation.map((line) => ({ shipmentRequestItemId: line.shipmentRequestItemId, lotIds: line.recommendedLots.map((l) => l.lotId) })),
    });
    confirmGoodsIssue(txAt(tx, `${issueDate}T10:00:00+09:00`), logistics, { shipmentRequestId: request.shipmentRequest.id });
  };
  const [issueA, issueCoil, issueSs1, issueSs2, issueB] = SEED_DASHBOARD.issueDates;
  ship(smA.salesOrderItem.id, 10, '2026-09-07T14:00:00+09:00', issueA);
  ship(sphcCoil.salesOrderItem.id, 10, '2026-09-10T14:00:00+09:00', issueCoil);
  ship(ss275.salesOrderItem.id, 12, '2026-09-15T14:00:00+09:00', issueSs1);
  ship(ss275.salesOrderItem.id, 8, '2026-09-24T14:00:00+09:00', issueSs2);
  ship(smB.salesOrderItem.id, 10, '2026-09-26T14:00:00+09:00', issueB);
}
