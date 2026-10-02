// 거래 시드 (core-domain). 서비스를 그대로 불러 만든다 → 규칙·불변조건·작업 로그가 처음부터 맞다.
// 날짜는 2026년 9월(Asia/Seoul), 난수 시드는 고정이라 매번 같은 결과가 나온다. 가정값은 docs/rework/areas/core-domain.md "가정값"에 있다.
//
// 이야기 (모두 9월):
//  1. 원료 확보: PR-2609-0001(직접) → 승인 → 공급업체별 발주 4건 → 입고 5건(RM LOT)
//  2. SO-2609-001 가람중공업 SS275 슬래브 250×1200×10000 4매 → 계획 1히트 → 실적 시뮬레이션 10매 → 검사 합격 → 자동 예약 4·여재 6
//     → 출하요청 DR-2609-0001 4매 FIFO 배정 → 출고 → 밀시트 MS-2609-0001-1 (PDF 생성됨)
//     ⇒ 남은 합격·미예약 SS275 슬래브 6매 = 업무 프로세스 14.1의 시작 재고 (이 6매는 아래에서 건드리지 않는다)
//  3. SO-2609-002 나래조선 SM355A 슬래브 250×1500 12매 → 2히트 → 16매(1매 표면 불합격) → 예약 12·여재 3
//  4. SO-2609-003 다온건설 혼합: SM355B 코일 4.5mm 6개 + SM355B 슬래브 250×1200 5매 → 코일 계획·슬래브 계획
//     업무방(멤버 5명, 시스템 메시지, 구매 담당 "실리코망가니즈 20톤 10월 20일까지 필요합니다")
//     MRP 부족 → PR-2609-0002(계획 연결) 승인 → 발주 → 부분 입고(4.5t, 3.5t 입고예정)
//     코일 계획: 8매 연주 → 6매 합격·2매 판정 대기 → 3매 열연 → 코일 3개 합격·자동 예약 (3개 더 열연할 적격 슬래브 3매 남음)
//     슬래브 계획: 제선·제강만 (연주 전, 히트 판정 대기)
//  5. SO-2609-004 나래조선 SM355A 슬래브 3매 → 여재로 재고 우선 예약(계획 없음), 납기 10-02(납기 위험)
//  6. DR-2609-0002 SO-2609-002 6매 출하요청 (배정 대기)
//  7. SO-2609-005 보람강관 SPHC 슬래브 220×1400 8매 → 10매 연주 → 히트 성분 불합격(P) → 하위 10매 제외, 재생산 필요 8
//  8. PR-2609-0003 철광석(승인, 미발주), PR-2609-0004 석회석(승인 대기)
import { decAdd } from '@/lib/decimal';
import { typicalPassValue } from '@/lib/inspectionJudgment';
import type { MockTx } from '@/mock/store';
import { insertRow, updateRow } from '@/mock/store';
import {
  approvePurchaseRequisition,
  confirmGoodsIssue,
  confirmRollingAllocations,
  confirmShipmentAllocations,
  createPurchaseOrders,
  createPurchaseRequisition,
  createSalesOrder,
  createShipmentRequest,
  ensureInventoryRows,
  inspectionFormOf,
  markMillSheetPdfGenerated,
  openWorkRoom,
  receiveGoods,
  registerHotRolling,
  registerInspection,
  registerIronmaking,
  registerSteelmaking,
  rollingRecommendation,
  simulatePlan,
  userActor,
  type PersonActor,
} from '@/mock/services';

/** 시드가 만든 기록 중 테스트·문서가 가리키는 것 */
export const SEED_CORE = {
  /** 14.1 시작 재고: SS275 슬래브 250×1200×10000 합격 가용 6매 */
  stock141ItemCode: 'SL-SS275-250x1200x10000',
  stock141Qty: 6,
  salesOrderNos: ['SO-2609-001', 'SO-2609-002', 'SO-2609-003', 'SO-2609-004', 'SO-2609-005'],
  /** Message → ERP 시연 메시지 */
  purchaseMessageText: '실리코망가니즈 20톤 10월 20일까지 필요합니다',
  workRoomSalesOrderNo: 'SO-2609-003',
  /** 출고·밀시트가 있는 출하요청 / 배정 대기 출하요청 */
  issuedShipmentRequestNo: 'DR-2609-0001',
  waitingShipmentRequestNo: 'DR-2609-0002',
  /** 시뮬레이션 난수 시드 */
  randomSeeds: { 'PP-2609-0001': 1001, 'PP-2609-0002': 2002, 'PP-2609-0003': 3003, 'PP-2609-0005': 5005 },
  /**
   * PR-2609-0001 원료 입고량(t, 가정값): 철광석 09-02·09-03 두 번, 나머지 한 번. 히트 1개에 철광석 444.445·석탄 166.667·석회석 41.667t를 쓴다.
   * 시드 끝 잔량 = 철광석 2,333.330 · 석탄 899.998 · 석회석 229.998 · 실리코망가니즈 1.000t → 14.1 히트 뒤에도 구매 없이 히트 4개를 더 만든다.
   */
  rawMaterialReceipts: { ORE01: ['1800.000', '3200.000'], COL01: '1900.000', LIM01: '480.000', SMN01: '20.000' },
} as const;

function txAt(tx: MockTx, iso: string): MockTx {
  const now = new Date(iso);
  return { tables: tx.tables, now, nowIso: now.toISOString() };
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`시드 참조를 찾지 못했어요: ${what}`);
  return value;
}

export function seedCore(tx: MockTx): void {
  const t = tx.tables;
  const emp = (employeeNo: string): PersonActor => userActor(required(t.employee.find((e) => e.employeeNo === employeeNo), employeeNo).id);
  const itemId = (code: string) => required(t.item.find((i) => i.itemCode === code), code).id;
  const customerId = (code: string) => required(t.customer.find((c) => c.customerCode === code), code).id;
  const planNo = (no: string) => required(t.productionPlan.find((p) => p.productionPlanNo === no), no);
  const lotsOf = (planId: number, lotType: 'HEAT' | 'SLAB' | 'COIL') => t.lot.filter((l) => l.productionPlanId === planId && l.lotType === lotType).sort((a, b) => a.id - b.id);

  const sales = emp('2103003');
  const salesHead = emp('1608002');
  const purchase = emp('2207005');
  const purchaseHead = emp('1702004');
  const productionHead = emp('1401006');
  const ironmaking = emp('1709007');
  const steelmaking = emp('1804008');
  const steelmakingStaff = emp('2402011');
  const hotRolling = emp('2001010');
  const quality = emp('2205013');
  const logistics = emp('2304015');

  /** 측정값: 기준 안 대표값 + 바꿀 값(항목 코드 → 값) */
  const inspect = (at: string, lotId: number, overrides: Record<string, string> = {}) => {
    const form = inspectionFormOf(t, lotId);
    registerInspection(txAt(tx, at), quality, {
      lotId,
      values: form.items.map((i) => ({ inspectionStandardItemId: i.inspectionStandardItemId, measuredValue: overrides[i.inspectionItemCode] ?? typicalPassValue(i) })),
    });
  };

  ensureInventoryRows(tx);

  // 1. 원료 확보 ────────────────────────────────────────
  // 양(가정값, SEED_CORE.rawMaterialReceipts): 시드의 히트 6개를 만들고 남은 잔량으로 14.1 히트 1개 뒤에도 구매 없이 히트를 4개 더 만들 수 있게
  // (철광석·석탄·석회석). 실리코망가니즈는 14.1 3단계 MRP(합금철만 순소요 1.500t)를 지키려고 20t 그대로다.
  const ore = itemId('ORE01');
  const coal = itemId('COL01');
  const lime = itemId('LIM01');
  const silicoManganese = itemId('SMN01');
  const receipts = SEED_CORE.rawMaterialReceipts;
  const pr1 = createPurchaseRequisition(txAt(tx, '2026-09-01T09:00:00+09:00'), purchase, {
    desiredReceiptDate: '2026-09-03',
    requestReason: '9월 생산 대비 기초 원료 확보',
    items: [
      { itemId: ore, requiredTon: decAdd(receipts.ORE01[0], receipts.ORE01[1]) },
      { itemId: coal, requiredTon: receipts.COL01 },
      { itemId: lime, requiredTon: receipts.LIM01 },
      { itemId: silicoManganese, requiredTon: receipts.SMN01 },
    ],
  });
  approvePurchaseRequisition(txAt(tx, '2026-09-01T10:00:00+09:00'), purchaseHead, { purchaseRequisitionId: pr1.purchaseRequisition.id });
  createPurchaseOrders(txAt(tx, '2026-09-01T11:00:00+09:00'), purchase, { purchaseRequisitionItemIds: pr1.items.map((i) => i.id) });
  const poLineOf = (prItemId: number) => required(t.purchaseOrderItem.find((l) => l.purchaseRequisitionItemId === prItemId), `발주 ${prItemId}`).id;
  const [oreLine, coalLine, limeLine, smnLine] = pr1.items.map((i) => poLineOf(i.id));
  receiveGoods(txAt(tx, '2026-09-02T10:00:00+09:00'), purchase, { purchaseOrderItemId: oreLine, receivedTon: receipts.ORE01[0], receiptDate: '2026-09-02' });
  receiveGoods(txAt(tx, '2026-09-02T10:30:00+09:00'), purchase, { purchaseOrderItemId: coalLine, receivedTon: receipts.COL01, receiptDate: '2026-09-02' });
  receiveGoods(txAt(tx, '2026-09-02T11:00:00+09:00'), purchase, { purchaseOrderItemId: limeLine, receivedTon: receipts.LIM01, receiptDate: '2026-09-02' });
  receiveGoods(txAt(tx, '2026-09-03T10:00:00+09:00'), purchase, { purchaseOrderItemId: oreLine, receivedTon: receipts.ORE01[1], receiptDate: '2026-09-03' });
  receiveGoods(txAt(tx, '2026-09-03T10:30:00+09:00'), purchase, { purchaseOrderItemId: smnLine, receivedTon: receipts.SMN01, receiptDate: '2026-09-03' });

  // 2. SO-2609-001 → 14.1 시작 재고 ─────────────────────
  const ss275SlabA = itemId(SEED_CORE.stock141ItemCode);
  const so1 = createSalesOrder(txAt(tx, '2026-09-03T14:00:00+09:00'), sales, {
    customerId: customerId('CUS-01'),
    items: [{ itemId: ss275SlabA, orderedQty: 4, dueDate: '2026-09-25' }],
  });
  const pp1 = planNo('PP-2609-0001');
  simulatePlan(txAt(tx, '2026-09-05T18:00:00+09:00'), steelmakingStaff, { productionPlanId: pp1.id, randomSeed: SEED_CORE.randomSeeds['PP-2609-0001'] });
  for (const slab of lotsOf(pp1.id, 'SLAB')) inspect('2026-09-06T09:30:00+09:00', slab.id);
  inspect('2026-09-06T10:00:00+09:00', lotsOf(pp1.id, 'HEAT')[0].id, { C: '0.18', SI: '0.22', MN: '1.05', P: '0.021', S: '0.012' });
  const dr1 = createShipmentRequest(txAt(tx, '2026-09-10T14:00:00+09:00'), sales, {
    customerId: customerId('CUS-01'),
    requestedShipDate: '2026-09-12',
    items: [{ salesOrderItemId: so1.items[0].id, requestQty: 4 }],
  });
  confirmShipmentAllocations(txAt(tx, '2026-09-10T14:05:00+09:00'), sales, {
    shipmentRequestId: dr1.shipmentRequest.id,
    lines: dr1.recommendation.map((line) => ({ shipmentRequestItemId: line.shipmentRequestItemId, lotIds: line.recommendedLots.map((l) => l.lotId) })),
  });
  const issued = confirmGoodsIssue(txAt(tx, '2026-09-12T10:00:00+09:00'), logistics, { shipmentRequestId: dr1.shipmentRequest.id });
  for (const sheet of issued.millSheets) markMillSheetPdfGenerated(txAt(tx, '2026-09-12T10:30:00+09:00'), logistics, { millSheetId: sheet.id });

  // 3. SO-2609-002 나래조선 SM355A 슬래브 12매 ─────────────
  const sm355aSlabB = itemId('SL-SM355A-250x1500x10000');
  const so2 = createSalesOrder(txAt(tx, '2026-09-08T10:00:00+09:00'), sales, {
    customerId: customerId('CUS-02'),
    items: [{ itemId: sm355aSlabB, orderedQty: 12, dueDate: '2026-10-15' }],
  });
  const pp2 = planNo('PP-2609-0002');
  simulatePlan(txAt(tx, '2026-09-14T20:00:00+09:00'), steelmakingStaff, { productionPlanId: pp2.id, randomSeed: SEED_CORE.randomSeeds['PP-2609-0002'] });
  const pp2Slabs = lotsOf(pp2.id, 'SLAB');
  pp2Slabs.forEach((slab, index) => inspect('2026-09-15T09:00:00+09:00', slab.id, index === 2 ? { SURFACE_DEFECT_DEPTH: '3.50' } : {}));
  const [pp2Heat1, pp2Heat2] = lotsOf(pp2.id, 'HEAT');
  inspect('2026-09-15T09:40:00+09:00', pp2Heat1.id, { C: '0.16', SI: '0.35', MN: '1.42', P: '0.018', S: '0.008', CEQ: '0.40' });
  inspect('2026-09-15T09:50:00+09:00', pp2Heat2.id, { C: '0.17', SI: '0.31', MN: '1.38', P: '0.020', S: '0.007', CEQ: '0.40' });

  // 4. SO-2609-003 다온건설 혼합 수주 + 업무방 ──────────────
  const sm355bCoil = itemId('CL-SM355B-4.5x1500x544000');
  const sm355bSlabA = itemId('SL-SM355B-250x1200x10000');
  const so3 = createSalesOrder(txAt(tx, '2026-09-15T11:00:00+09:00'), salesHead, {
    customerId: customerId('CUS-03'),
    items: [
      { itemId: sm355bCoil, orderedQty: 6, dueDate: '2026-10-14' },
      { itemId: sm355bSlabA, orderedQty: 5, dueDate: '2026-10-14' },
    ],
  });
  const pp3 = planNo('PP-2609-0003');
  const pp4 = planNo('PP-2609-0004');
  const room = openWorkRoom(txAt(tx, '2026-09-15T11:30:00+09:00'), salesHead, {
    salesOrderId: so3.salesOrder.id,
    memberEmployeeIds: [sales.employeeId, purchase.employeeId, productionHead.employeeId, emp('1802012').employeeId],
  }).chatRoom;
  const say = (at: string, sender: PersonActor, content: string) => {
    const iso = new Date(at).toISOString();
    return insertRow(tx, 'message', { chatRoomId: room.id, senderId: sender.employeeId, content, fileName: null, filePath: null, fileSize: null, mimeType: null, createdAt: iso, updatedAt: iso });
  };
  const m1 = say('2026-09-15T11:35:00+09:00', salesHead, '다온건설 혼합 수주 공유해요. 코일 6개·슬래브 5매, 납기는 10월 14일이에요.');
  const m2 = say('2026-09-15T13:10:00+09:00', productionHead, '코일 계획 히트 1개, 슬래브 계획 히트 1개 편성했어요. 슬래브 검사 끝나면 열연 들어갈게요.');

  // MRP 부족(합금철) → 계획 연결 구매요청 → 승인 → 발주 → 부분 입고
  const pr2 = createPurchaseRequisition(txAt(tx, '2026-09-15T14:00:00+09:00'), purchase, {
    desiredReceiptDate: '2026-09-17',
    requestReason: 'MRP 부족: 다온건설 수주 슬래브 계획 합금철',
    items: [{ itemId: silicoManganese, requiredTon: '8.000', productionPlanId: pp4.id }],
  });
  approvePurchaseRequisition(txAt(tx, '2026-09-15T15:00:00+09:00'), purchaseHead, { purchaseRequisitionId: pr2.purchaseRequisition.id });
  createPurchaseOrders(txAt(tx, '2026-09-15T16:00:00+09:00'), purchase, { purchaseRequisitionItemIds: pr2.items.map((i) => i.id), dueDate: '2026-10-28' });
  receiveGoods(txAt(tx, '2026-09-16T10:00:00+09:00'), purchase, { purchaseOrderItemId: poLineOf(pr2.items[0].id), receivedTon: '4.500', receiptDate: '2026-09-16' });

  // 코일 계획: 시뮬레이션(연주까지) → 6매 검사·2매 판정 대기 → 열연 3매 → 코일 3개 합격
  simulatePlan(txAt(tx, '2026-09-17T18:00:00+09:00'), steelmakingStaff, { productionPlanId: pp3.id, randomSeed: SEED_CORE.randomSeeds['PP-2609-0003'] });
  lotsOf(pp3.id, 'SLAB')
    .slice(0, 6)
    .forEach((slab) => inspect('2026-09-18T09:00:00+09:00', slab.id));
  inspect('2026-09-18T09:30:00+09:00', lotsOf(pp3.id, 'HEAT')[0].id, { C: '0.15', SI: '0.30', MN: '1.45', P: '0.017', S: '0.006', CEQ: '0.39' });

  // 슬래브 계획: 제선·제강만 (연주 전)
  registerIronmaking(txAt(tx, '2026-09-18T14:00:00+09:00'), ironmaking, {
    productionPlanId: pp4.id,
    blastFurnaceCode: 'BF2',
    startedAt: '2026-09-18T09:00:00+09:00',
    completedAt: '2026-09-18T13:00:00+09:00',
    outputTon: '277.778',
  });
  registerSteelmaking(txAt(tx, '2026-09-18T18:00:00+09:00'), steelmaking, {
    productionPlanId: pp4.id,
    converterCode: 'BOF1',
    startedAt: '2026-09-18T16:00:00+09:00',
    completedAt: '2026-09-18T17:00:00+09:00',
    inputHotMetalTon: '277.778',
  });

  const recommendation = rollingRecommendation(t, pp3.id);
  confirmRollingAllocations(txAt(tx, '2026-09-19T09:00:00+09:00'), hotRolling, { productionPlanId: pp3.id, lotIds: recommendation.lots.slice(0, 3).map((l) => l.lotId) });
  registerHotRolling(txAt(tx, '2026-09-19T13:00:00+09:00'), hotRolling, {
    productionPlanId: pp3.id,
    startedAt: '2026-09-19T10:00:00+09:00',
    completedAt: '2026-09-19T12:00:00+09:00',
  });
  for (const coil of lotsOf(pp3.id, 'COIL')) inspect('2026-09-19T15:00:00+09:00', coil.id);

  // 5. SO-2609-004 여재로 재고 우선 예약 ──────────────────
  createSalesOrder(txAt(tx, '2026-09-20T10:00:00+09:00'), sales, {
    customerId: customerId('CUS-02'),
    items: [{ itemId: sm355aSlabB, orderedQty: 3, dueDate: '2026-10-02' }],
  });

  // 6. 배정 대기 출하요청 ──────────────────────────────
  createShipmentRequest(txAt(tx, '2026-09-21T10:00:00+09:00'), sales, {
    customerId: customerId('CUS-02'),
    requestedShipDate: '2026-10-05',
    items: [{ salesOrderItemId: so2.items[0].id, requestQty: 6 }],
  });

  // 7. SO-2609-005 히트 불합격 ───────────────────────────
  createSalesOrder(txAt(tx, '2026-09-22T10:00:00+09:00'), salesHead, {
    customerId: customerId('CUS-04'),
    items: [{ itemId: itemId('SL-SPHC-220x1400x9500'), orderedQty: 8, dueDate: '2026-10-12' }],
  });
  const pp5 = planNo('PP-2609-0005');
  simulatePlan(txAt(tx, '2026-09-24T18:00:00+09:00'), steelmakingStaff, { productionPlanId: pp5.id, randomSeed: SEED_CORE.randomSeeds['PP-2609-0005'] });
  for (const slab of lotsOf(pp5.id, 'SLAB')) inspect('2026-09-25T09:00:00+09:00', slab.id);
  inspect('2026-09-25T10:00:00+09:00', lotsOf(pp5.id, 'HEAT')[0].id, { C: '0.06', MN: '0.32', P: '0.058', S: '0.015' });

  // 8. 구매요청: 승인(미발주) · 승인 대기 ──────────────────
  const pr3 = createPurchaseRequisition(txAt(tx, '2026-09-26T10:00:00+09:00'), purchase, {
    desiredReceiptDate: '2026-10-10',
    requestReason: '10월 철광석 보충',
    items: [{ itemId: ore, requiredTon: '500.000' }],
  });
  approvePurchaseRequisition(txAt(tx, '2026-09-26T11:00:00+09:00'), purchaseHead, { purchaseRequisitionId: pr3.purchaseRequisition.id });
  createPurchaseRequisition(txAt(tx, '2026-09-29T17:00:00+09:00'), purchase, {
    desiredReceiptDate: '2026-10-08',
    requestReason: '석회석 재고 보충',
    items: [{ itemId: lime, requiredTon: '80.000' }],
  });

  // 업무방: 구매 담당의 Message → ERP 시연 메시지 + 읽음 위치
  const m3 = say('2026-09-29T16:20:00+09:00', purchase, SEED_CORE.purchaseMessageText);
  const markRead = (employeeId: number, messageId: number) => {
    const member = t.chatRoomMember.find((m) => m.chatRoomId === room.id && m.employeeId === employeeId);
    if (member) updateRow(txAt(tx, '2026-09-29T17:00:00+09:00'), 'chatRoomMember', member.id, { lastReadMessageId: messageId });
  };
  markRead(salesHead.employeeId, m2.id);
  markRead(productionHead.employeeId, m2.id);
  markRead(purchase.employeeId, m3.id);
  markRead(sales.employeeId, m1.id);

  // 이미 승인한 구매요청의 승인 요청 알림은 부서장이 처리한 것이라 읽음으로 둔다(승인 대기 PR-2609-0004만 안 읽음)
  for (const notification of t.notification.filter((n) => n.notificationType === 'APPROVAL_REQUESTED' && !n.isRead)) {
    const prId = Number(/[?&]pr=(\d+)/.exec(notification.linkPath ?? '')?.[1]);
    const pr = t.purchaseRequisition.find((r) => r.id === prId);
    if (!pr || pr.purchaseRequisitionStatus === 'WAITING_APPROVAL' || !pr.approvedAt) continue;
    updateRow(txAt(tx, pr.approvedAt), 'notification', notification.id, { isRead: true, readAt: pr.approvedAt });
  }
}
