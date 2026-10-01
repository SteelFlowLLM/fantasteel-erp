// 수주 (REQ-SO-001~006, BP-SO-01·02, 13.1·13.2, 업무 프로세스 4.1·4.2·4.5).
// - 등록: 규격(등록된 슬래브·코일만, SO-001) + 매수(1 이상 정수, SO-002) + 품목별 납기. 톤은 저장하지 않는다.
// - 재고 우선 예약: 품목마다 예약 가용만큼 ACTIVE 예약(주체 SYSTEM, 사유 STOCK_FIRST), 부족분은 품목 라우팅대로 생산계획(히트 편성, ORDER_SHORTAGE).
// - 취소: 출고 있으면 SO-003, 진행 중 출하요청 있으면 SO-004. ACTIVE 예약·CONFIRMED 배정 RELEASED, PLANNED 계획 CANCELLED,
//   IN_PROGRESS 계획은 수주 연결 해제 + 완료 후 여재(SURPLUS_CONVERTED).
import type { ProductItemType, SalesOrderItemStatus } from '@/codes';
import type { HeatFormation } from '@/lib/heatPlanning';
import { progressOf, stockFirstSplit, type ProgressMeasure } from '@/lib/inventoryMath';
import { headerStatusOf, isDueRisk } from '@/lib/salesOrderStatus';
import { toSeoulDateString } from '@/lib/seoulDate';
import { calcWeightTon, sumTon } from '@/lib/weight';
import { recordBusinessEvent } from '@/mock/businessEvents';
import type { MockTables, ProductionPlanRow, ReservationRow, SalesOrderItemRow, SalesOrderRow } from '@/mock/schema';
import { issueBusinessNo } from '@/mock/sequence';
import { insertRow, updateRow, type MockTx } from '@/mock/store';
import { releaseAllocationRow } from '@/mock/services/allocations';
import {
  ApiError,
  assertNotChanged,
  checkDate,
  checkText,
  employeeNameOf,
  FieldErrors,
  findById,
  inputError,
  mustGet,
  productionSettingOf,
  refreshInventory,
  requirePositiveQty,
  SYSTEM_ACTOR,
  unitWeightOf,
  type PersonActor,
} from '@/mock/services/context';
import { confirmedAllocationOf, lotEligibility, reservationPoolOf } from '@/mock/services/inventoryPool';
import { cancelPlanRow, createProductionPlan, formHeatsFor, itemShortageOf, planProgressOf, planSnapshot, type ItemShortage } from '@/mock/services/productionPlans';
import { createReservation, releaseReservationsOfItem } from '@/mock/services/reservations';

type Tables = Readonly<MockTables>;

const OPEN_SHIPMENT_STATUSES = ['REQUESTED', 'ALLOCATED'] as const;

export interface SalesOrderLineInput {
  itemId: number;
  /** 매수. 문자열이면 그대로 확인한다(글자를 지우지 않는다) */
  orderedQty: number | string;
  dueDate: string;
}

export interface CreateSalesOrderInput {
  customerId: number;
  items: readonly SalesOrderLineInput[];
}

interface ValidLine {
  itemId: number;
  orderedQty: number;
  dueDate: string;
}

/** 입력 확인: 규격 SO-001, 매수 SO-002, 납기·고객사는 입력 오류 / COM-003 */
function validateLines(tables: Tables, items: readonly SalesOrderLineInput[]): ValidLine[] {
  if (items.length === 0) inputError('items', '품목을 하나 이상 넣어 주세요');
  const errors = new FieldErrors();
  const lines = items.map((line, index) => {
    const item = tables.item.find((i) => i.id === line.itemId);
    if (!item || item.itemType === 'RAW_MATERIAL') throw new ApiError('SO-001', `${index + 1}번째 품목`);
    const orderedQty = requirePositiveQty(line.orderedQty, `${index + 1}번째 품목`);
    const dueDate = checkDate(errors, `items.${index}.dueDate`, line.dueDate, '납기', true);
    return { itemId: item.id, orderedQty, dueDate: dueDate ?? '' };
  });
  errors.throwIfAny();
  return lines;
}

export interface SalesOrderPreviewLine {
  itemId: number;
  itemCode: string;
  itemName: string;
  itemType: ProductItemType;
  orderedQty: number;
  unitWeightTon: string;
  /** 수주 톤 = 매수 × 1매 이론중량 (표시값, 저장 안 함) */
  weightTon: string;
  /** 이 줄을 볼 때의 예약 가용 (앞 줄이 같은 규격을 먼저 예약한 뒤) */
  availableQty: number;
  reserveQty: number;
  shortageQty: number;
  /** 부족분 히트 편성 (부족 없으면 null) */
  formation: HeatFormation | null;
}

/** 등록 전 미리보기 (저장 안 함): 예약 가능·부족과 히트 편성 */
export function previewSalesOrder(tables: Tables, items: readonly SalesOrderLineInput[]): SalesOrderPreviewLine[] {
  const lines = validateLines(tables, items);
  const used = new Map<number, number>();
  return lines.map((line) => {
    const item = mustGet(tables, 'item', line.itemId, '규격');
    const availableQty = Math.max(0, reservationPoolOf(tables, item.id).availableQty - (used.get(item.id) ?? 0));
    const { reserveQty, shortageQty } = stockFirstSplit(line.orderedQty, availableQty);
    used.set(item.id, (used.get(item.id) ?? 0) + reserveQty);
    const unitWeightTon = unitWeightOf(item);
    return {
      itemId: item.id,
      itemCode: item.itemCode,
      itemName: item.itemName,
      itemType: item.itemType === 'COIL' ? 'COIL' : 'SLAB',
      orderedQty: line.orderedQty,
      unitWeightTon,
      weightTon: calcWeightTon(line.orderedQty, unitWeightTon),
      availableQty,
      reserveQty,
      shortageQty,
      formation: shortageQty > 0 ? formHeatsFor(tables, item, shortageQty) : null,
    };
  });
}

export interface CreateSalesOrderResult {
  salesOrder: SalesOrderRow;
  items: SalesOrderItemRow[];
  reservations: ReservationRow[];
  productionPlans: ProductionPlanRow[];
}

/** 수주 등록 (13.2 registerSalesOrder). 주체: 등록한 영업 담당(owner). */
export function createSalesOrder(tx: MockTx, actor: PersonActor, input: CreateSalesOrderInput): CreateSalesOrderResult {
  const customer = mustGet(tx.tables, 'customer', input.customerId, '고객사');
  const lines = validateLines(tx.tables, input.items);
  // 편성할 수 없는(수율·배합·매핑 누락) 규격이면 저장 전에 MST-001
  previewSalesOrder(tx.tables, input.items);

  const salesOrder = insertRow(tx, 'salesOrder', {
    salesOrderNo: issueBusinessNo(tx, 'SALES_ORDER'),
    customerId: customer.id,
    ownerEmployeeId: actor.employeeId,
    cancelledAt: null,
    cancelReason: null,
  });
  const items = lines.map((line, index) =>
    insertRow(tx, 'salesOrderItem', {
      salesOrderId: salesOrder.id,
      lineNo: index + 1,
      itemId: line.itemId,
      orderedQty: line.orderedQty,
      shippedQty: 0,
      dueDate: line.dueDate,
      salesOrderItemStatus: 'OPEN',
    }),
  );
  recordBusinessEvent(tx, {
    businessEventType: 'SALES_ORDER_CREATED',
    actor,
    targetType: 'sales_order',
    targetId: salesOrder.id,
    targetNo: salesOrder.salesOrderNo,
    salesOrderId: salesOrder.id,
    afterData: {
      salesOrderNo: salesOrder.salesOrderNo,
      customerName: customer.customerName,
      items: items.map((i) => ({ lineNo: i.lineNo, itemCode: tx.tables.item.find((x) => x.id === i.itemId)?.itemCode ?? '', orderedQty: i.orderedQty, dueDate: i.dueDate })),
    },
  });

  const reservations: ReservationRow[] = [];
  const productionPlans: ProductionPlanRow[] = [];
  for (const soItem of items) {
    const available = Math.max(0, reservationPoolOf(tx.tables, soItem.itemId).availableQty);
    const { reserveQty, shortageQty } = stockFirstSplit(soItem.orderedQty, available);
    if (reserveQty > 0) {
      reservations.push(
        createReservation(tx, SYSTEM_ACTOR, { salesOrderItemId: soItem.id, qty: reserveQty, reasonCode: 'STOCK_FIRST', reasonText: `합격 재고 ${reserveQty}매 우선 예약` }),
      );
    }
    if (shortageQty > 0) {
      productionPlans.push(
        createProductionPlan(tx, SYSTEM_ACTOR, {
          salesOrderItemId: soItem.id,
          itemId: soItem.itemId,
          shortageQty,
          isReproduction: false,
          createdEmployeeId: actor.employeeId,
          reasonText: `수주 ${salesOrder.salesOrderNo} ${soItem.lineNo}번 품목 부족 ${shortageQty}매`,
        }),
      );
    }
    refreshInventory(tx, soItem.itemId);
  }
  return { salesOrder, items, reservations, productionPlans };
}

/** 취소할 수 있는지: 출고 있으면 SO-003, 진행 중 출하요청 있으면 SO-004 */
export function cancelBlockOf(tables: Tables, salesOrderId: number): 'SO-003' | 'SO-004' | 'CANCELLED' | null {
  const so = mustGet(tables, 'salesOrder', salesOrderId, '수주');
  if (so.cancelledAt) return 'CANCELLED';
  const items = tables.salesOrderItem.filter((i) => i.salesOrderId === so.id);
  if (items.some((i) => i.shippedQty > 0)) return 'SO-003';
  const itemIds = new Set(items.map((i) => i.id));
  const openRequestIds = new Set(tables.shipmentRequest.filter((r) => (OPEN_SHIPMENT_STATUSES as readonly string[]).includes(r.shipmentRequestStatus)).map((r) => r.id));
  if (tables.shipmentRequestItem.some((line) => itemIds.has(line.salesOrderItemId) && openRequestIds.has(line.shipmentRequestId))) return 'SO-004';
  return null;
}

/** 수주 취소 (REQ-SO-006, BP-SO-02, 9.3 SO-003·004) */
export function cancelSalesOrder(tx: MockTx, actor: PersonActor, input: { salesOrderId: number; cancelReason: string; expectedUpdatedAt?: string | null }): SalesOrderRow {
  const so = mustGet(tx.tables, 'salesOrder', input.salesOrderId, '수주');
  assertNotChanged(so.updatedAt, input.expectedUpdatedAt, '수주');
  const block = cancelBlockOf(tx.tables, so.id);
  if (block === 'CANCELLED') inputError('salesOrderId', '이미 취소된 수주예요');
  if (block) throw new ApiError(block);
  const errors = new FieldErrors();
  const cancelReason = checkText(errors, 'cancelReason', input.cancelReason, '취소 사유', 200, true);
  errors.throwIfAny();

  const items = tx.tables.salesOrderItem.filter((i) => i.salesOrderId === so.id);
  const before = { cancelledAt: so.cancelledAt, cancelReason: so.cancelReason, items: items.map((i) => ({ lineNo: i.lineNo, salesOrderItemStatus: i.salesOrderItemStatus })) };
  const cancelled = updateRow(tx, 'salesOrder', so.id, { cancelledAt: tx.nowIso, cancelReason }) ?? so;
  for (const item of items) updateRow(tx, 'salesOrderItem', item.id, { salesOrderItemStatus: 'CANCELLED' });
  recordBusinessEvent(tx, {
    businessEventType: 'SALES_ORDER_CANCELLED',
    actor,
    targetType: 'sales_order',
    targetId: so.id,
    targetNo: so.salesOrderNo,
    salesOrderId: so.id,
    beforeData: before,
    afterData: { cancelledAt: cancelled.cancelledAt, cancelReason, items: items.map((i) => ({ lineNo: i.lineNo, salesOrderItemStatus: 'CANCELLED' })) },
    reasonCode: 'ORDER_CANCELLED',
    reasonText: cancelReason,
  });

  for (const item of items) {
    releaseReservationsOfItem(tx, actor, item.id, 'ORDER_CANCELLED', '수주 취소로 예약 해제');
    for (const allocation of tx.tables.allocation.filter((a) => a.salesOrderItemId === item.id && a.allocationStatus === 'CONFIRMED')) {
      releaseAllocationRow(tx, actor, allocation, { reasonCode: 'ORDER_CANCELLED', reasonText: '수주 취소로 배정 해제' });
    }
    for (const plan of tx.tables.productionPlan.filter((p) => p.salesOrderItemId === item.id)) {
      if (plan.productionPlanStatus === 'PLANNED') {
        cancelPlanRow(tx, actor, plan, { reasonCode: 'ORDER_CANCELLED', reasonText: '수주 취소로 시작 전 계획 취소' });
      } else if (plan.productionPlanStatus === 'IN_PROGRESS') {
        unlinkInProgressPlan(tx, actor, plan, so.id);
      } else if (plan.productionPlanStatus === 'COMPLETED') {
        markPlanSlabsSurplus(tx, actor, plan, so.id, '수주 취소로 예약이 풀린 합격 슬래브를 여재로 전환');
      }
    }
    refreshInventory(tx, item.itemId);
  }
  return cancelled;
}

/** 진행 중 계획: 수주 연결 해제 + 완료 후 여재 (ERD is_surplus_on_completion). 열연 배정은 풀고, 이미 나온 합격 슬래브는 바로 여재. */
function unlinkInProgressPlan(tx: MockTx, actor: PersonActor, plan: ProductionPlanRow, salesOrderId: number): void {
  const before = planSnapshot(plan);
  for (const allocation of tx.tables.allocation.filter((a) => a.productionPlanId === plan.id && a.allocationStatus === 'CONFIRMED')) {
    releaseAllocationRow(tx, actor, allocation, { reasonCode: 'ORDER_CANCELLED', reasonText: '수주 취소로 열연 배정 해제' });
  }
  const updated = updateRow(tx, 'productionPlan', plan.id, { salesOrderItemId: null, isSurplusOnCompletion: true }) ?? plan;
  const surplus = surplusCandidatesOf(tx.tables, plan);
  for (const slab of surplus) updateRow(tx, 'lot', slab.id, { surplusAt: tx.nowIso });
  recordBusinessEvent(tx, {
    businessEventType: 'SURPLUS_CONVERTED',
    actor,
    targetType: 'production_plan',
    targetId: plan.id,
    targetNo: plan.productionPlanNo,
    salesOrderId,
    beforeData: before,
    afterData: { ...planSnapshot(updated), surplusLotNos: surplus.map((s) => s.lotNo) },
    reasonCode: 'SURPLUS_CONVERSION',
    reasonText: '수주 취소: 진행 중 물량은 연결을 해제하고 완료 후 여재로 전환',
    lotIds: surplus.map((s) => s.id),
  });
}

const surplusCandidatesOf = (tables: Tables, plan: ProductionPlanRow) =>
  tables.lot.filter((l) => l.productionPlanId === plan.id && l.lotType === 'SLAB' && l.surplusAt === null && lotEligibility(tables, l) === 'ELIGIBLE' && !confirmedAllocationOf(tables, l.id));

function markPlanSlabsSurplus(tx: MockTx, actor: PersonActor, plan: ProductionPlanRow, salesOrderId: number, reasonText: string): void {
  const surplus = surplusCandidatesOf(tx.tables, plan);
  if (surplus.length === 0) return;
  for (const slab of surplus) updateRow(tx, 'lot', slab.id, { surplusAt: tx.nowIso });
  recordBusinessEvent(tx, {
    businessEventType: 'SURPLUS_CONVERTED',
    actor,
    targetType: 'production_plan',
    targetId: plan.id,
    targetNo: plan.productionPlanNo,
    salesOrderId,
    afterData: { surplusLotNos: surplus.map((s) => s.lotNo) },
    reasonCode: 'SURPLUS_CONVERSION',
    reasonText,
    lotIds: surplus.map((s) => s.id),
  });
}

// ── 조회 ──────────────────────────────────────────────

export interface ItemFulfillment {
  salesOrderItemId: number;
  lineNo: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  itemType: ProductItemType;
  unitWeightTon: string;
  orderedQty: number;
  /** 수주 톤 = 매수 × 1매 이론중량 (계산값) */
  orderedTon: string;
  dueDate: string;
  salesOrderItemStatus: SalesOrderItemStatus;
  isDueRisk: boolean;
  shippedQty: number;
  activeReservedQty: number;
  /** 검사합격(확보) = 이 품목 몫으로 확보한 합격 제품 = ACTIVE 예약 + 출고 (예약은 모두 합격 제품이다) */
  securedQty: number;
  /** 생산중 = 진행중(IN_PROGRESS)·완료(COMPLETED) 연결 계획의 잔여 목표 */
  inProductionQty: number;
  /** 시작 전(PLANNED) 연결 계획의 잔여 목표 */
  plannedQty: number;
  shortage: ItemShortage;
  /**
   * SO-004 충족 현황 지표. 분모를 함께 준다(4.5): 단계를 더하지 않는다.
   * reserved/unshipped · inProduction/ordered · secured(검사합격)/ordered · shipped/ordered
   */
  measures: { reserved: ProgressMeasure; inProduction: ProgressMeasure; passed: ProgressMeasure; shipped: ProgressMeasure };
  plans: { productionPlanId: number; productionPlanNo: string; productionPlanStatus: ProductionPlanRow['productionPlanStatus']; isReproduction: boolean; shortageQty: number; heatCount: number; remainingTargetQty: number }[];
}

const todayOf = (today?: string) => today ?? toSeoulDateString(new Date());

export function fulfillmentOf(tables: Tables, soItem: SalesOrderItemRow, today?: string): ItemFulfillment {
  const item = mustGet(tables, 'item', soItem.itemId, '규격');
  const shortage = itemShortageOf(tables, soItem);
  const plans = tables.productionPlan.filter((p) => p.salesOrderItemId === soItem.id).sort((a, b) => a.id - b.id);
  const planRows = plans.map((p) => ({
    productionPlanId: p.id,
    productionPlanNo: p.productionPlanNo,
    productionPlanStatus: p.productionPlanStatus,
    isReproduction: p.isReproduction,
    shortageQty: p.shortageQty,
    heatCount: p.heatCount,
    remainingTargetQty: planProgressOf(tables, p).remainingTargetQty,
  }));
  const inProductionQty = planRows.filter((p) => p.productionPlanStatus === 'IN_PROGRESS' || p.productionPlanStatus === 'COMPLETED').reduce((s, p) => s + p.remainingTargetQty, 0);
  const plannedQty = planRows.filter((p) => p.productionPlanStatus === 'PLANNED').reduce((s, p) => s + p.remainingTargetQty, 0);
  const securedQty = shortage.activeReservedQty + soItem.shippedQty;
  const unitWeightTon = unitWeightOf(item);
  const riskDays = productionSettingOf(tables).deliveryRiskDays;
  return {
    salesOrderItemId: soItem.id,
    lineNo: soItem.lineNo,
    itemId: item.id,
    itemCode: item.itemCode,
    itemName: item.itemName,
    itemType: item.itemType === 'COIL' ? 'COIL' : 'SLAB',
    unitWeightTon,
    orderedQty: soItem.orderedQty,
    orderedTon: calcWeightTon(soItem.orderedQty, unitWeightTon),
    dueDate: soItem.dueDate,
    salesOrderItemStatus: soItem.salesOrderItemStatus,
    isDueRisk: isDueRisk({ dueDate: soItem.dueDate, today: todayOf(today), deliveryRiskDays: riskDays, unshippedQty: shortage.unshippedQty, status: soItem.salesOrderItemStatus }),
    shippedQty: soItem.shippedQty,
    activeReservedQty: shortage.activeReservedQty,
    securedQty,
    inProductionQty,
    plannedQty,
    shortage,
    measures: {
      reserved: progressOf(shortage.activeReservedQty, shortage.unshippedQty),
      inProduction: progressOf(inProductionQty, soItem.orderedQty),
      passed: progressOf(securedQty, soItem.orderedQty),
      shipped: progressOf(soItem.shippedQty, soItem.orderedQty),
    },
    plans: planRows,
  };
}

export interface SalesOrderSummary {
  id: number;
  salesOrderNo: string;
  customerId: number;
  customerName: string;
  ownerEmployeeId: number;
  ownerName: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  /** 헤더 상태 (품목 상태에서 계산, 저장 안 함) */
  status: SalesOrderItemStatus;
  itemCount: number;
  itemTypes: ProductItemType[];
  totalOrderedQty: number;
  totalOrderedTon: string;
  totalShippedQty: number;
  totalActiveReservedQty: number;
  earliestDueDate: string | null;
  isDueRisk: boolean;
  /** 재생산이 필요한 품목이 있는지 (4.5·14.1-6) */
  hasReproductionNeed: boolean;
  workRoomId: number | null;
}

function summaryOf(tables: Tables, so: SalesOrderRow, today?: string): SalesOrderSummary & { items: ItemFulfillment[] } {
  const items = tables.salesOrderItem
    .filter((i) => i.salesOrderId === so.id)
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((i) => fulfillmentOf(tables, i, today));
  const live = items.filter((i) => i.salesOrderItemStatus !== 'CANCELLED');
  return {
    id: so.id,
    salesOrderNo: so.salesOrderNo,
    customerId: so.customerId,
    customerName: findById(tables, 'customer', so.customerId)?.customerName ?? '',
    ownerEmployeeId: so.ownerEmployeeId,
    ownerName: employeeNameOf(tables, so.ownerEmployeeId),
    createdAt: so.createdAt,
    updatedAt: so.updatedAt,
    cancelledAt: so.cancelledAt,
    cancelReason: so.cancelReason,
    status: headerStatusOf(items.map((i) => i.salesOrderItemStatus)),
    itemCount: items.length,
    itemTypes: [...new Set(items.map((i) => i.itemType))],
    totalOrderedQty: items.reduce((s, i) => s + i.orderedQty, 0),
    totalOrderedTon: sumTon(items.map((i) => i.orderedTon)),
    totalShippedQty: items.reduce((s, i) => s + i.shippedQty, 0),
    totalActiveReservedQty: items.reduce((s, i) => s + i.activeReservedQty, 0),
    earliestDueDate: live.map((i) => i.dueDate).sort()[0] ?? null,
    isDueRisk: items.some((i) => i.isDueRisk),
    hasReproductionNeed: items.some((i) => i.shortage.reproductionNeedQty > 0),
    workRoomId: tables.chatRoom.find((r) => r.chatRoomType === 'WORK' && r.salesOrderId === so.id)?.id ?? null,
    items,
  };
}

/** 수주 목록 (최근 것 먼저). today는 납기 위험 계산 기준일(생략하면 오늘, 서울). */
export function listSalesOrders(tables: Tables, options: { today?: string } = {}): SalesOrderSummary[] {
  return [...tables.salesOrder]
    .sort((a, b) => b.id - a.id)
    .map((so) => {
      const { items: _items, ...summary } = summaryOf(tables, so, options.today);
      return summary;
    });
}

export interface SalesOrderDetail extends SalesOrderSummary {
  items: ItemFulfillment[];
  reservations: { id: number; salesOrderItemId: number; lineNo: number; itemCode: string; reservedQty: number; reservationStatus: ReservationRow['reservationStatus']; createdAt: string; updatedAt: string }[];
  shipmentRequests: {
    id: number;
    shipmentRequestNo: string;
    shipmentRequestStatus: string;
    requestedShipDate: string;
    issuedAt: string | null;
    lines: { salesOrderItemId: number; lineNo: number; requestQty: number; allocatedQty: number }[];
  }[];
  millSheets: { id: number; millSheetNo: string; shipmentRequestId: number; issuedAt: string; pdfPath: string | null }[];
  /** 취소 가능 여부: null = 가능, 그 밖에는 막는 코드 */
  cancelBlock: 'SO-003' | 'SO-004' | 'CANCELLED' | null;
}

export function salesOrderDetail(tables: Tables, salesOrderId: number, options: { today?: string } = {}): SalesOrderDetail {
  const so = mustGet(tables, 'salesOrder', salesOrderId, '수주');
  const summary = summaryOf(tables, so, options.today);
  const itemIds = new Set(summary.items.map((i) => i.salesOrderItemId));
  const lineNoOf = (soItemId: number) => summary.items.find((i) => i.salesOrderItemId === soItemId)?.lineNo ?? 0;
  const requestLines = tables.shipmentRequestItem.filter((l) => itemIds.has(l.salesOrderItemId));
  const requestIds = [...new Set(requestLines.map((l) => l.shipmentRequestId))];
  return {
    ...summary,
    reservations: tables.reservation
      .filter((r) => itemIds.has(r.salesOrderItemId))
      .sort((a, b) => a.id - b.id)
      .map((r) => ({
        id: r.id,
        salesOrderItemId: r.salesOrderItemId,
        lineNo: lineNoOf(r.salesOrderItemId),
        itemCode: findById(tables, 'item', r.itemId)?.itemCode ?? '',
        reservedQty: r.reservedQty,
        reservationStatus: r.reservationStatus,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    shipmentRequests: requestIds
      .map((id) => mustGet(tables, 'shipmentRequest', id, '출하요청'))
      .sort((a, b) => a.id - b.id)
      .map((request) => ({
        id: request.id,
        shipmentRequestNo: request.shipmentRequestNo,
        shipmentRequestStatus: request.shipmentRequestStatus,
        requestedShipDate: request.requestedShipDate,
        issuedAt: request.issuedAt,
        lines: requestLines
          .filter((l) => l.shipmentRequestId === request.id)
          .map((l) => ({
            salesOrderItemId: l.salesOrderItemId,
            lineNo: lineNoOf(l.salesOrderItemId),
            requestQty: l.requestQty,
            allocatedQty: tables.allocation.filter((a) => a.shipmentRequestItemId === l.id && a.allocationStatus !== 'RELEASED').length,
          })),
      })),
    millSheets: tables.millSheet
      .filter((m) => m.salesOrderId === so.id)
      .map((m) => ({ id: m.id, millSheetNo: m.millSheetNo, shipmentRequestId: m.shipmentRequestId, issuedAt: m.issuedAt, pdfPath: m.pdfPath })),
    cancelBlock: cancelBlockOf(tables, so.id),
  };
}
