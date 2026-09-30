import { ITEM_QTY_UNIT, RESERVATION_STATUS, SALES_ORDER_ITEM_STATUS, deriveSalesOrderStatus, type SalesOrderItemStatus, type SalesOrderStatus } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { kstParts } from '../../common/numbering/numbering.service';
import { OPEN_PLAN_STATUSES, type SalesOrderItemRow, type SalesOrderRow } from './sales-order.repository';

// 응답은 JSON 그대로(톤 = 소수 3자리 문자열, 일시 = ISO 문자열) 만든다.
// 요청 고유키로 재시도했을 때 저장해 둔 응답과 모양이 같아야 하기 때문이다.

export interface SalesOrderItemView {
  id: number;
  lineNo: number;
  productSpecId: number;
  specCode: string;
  itemType: 'SLAB' | 'COIL';
  /** 화면 수량 단위: 슬래브 매, 코일 개 */
  qtyUnit: string;
  steelGradeCode: string;
  thicknessMm: string;
  widthMm: string;
  lengthMm: string;
  theoreticalWeightTon: string;
  salesOrderItemStatus: SalesOrderItemStatus;
  orderedQty: number;
  /** 주문 매수 × 1매 이론중량 (계산값, 저장하지 않음) */
  orderedTon: string;
  shippedQty: number;
  shippedTon: string;
  /** 재고에서 잡은 ACTIVE 예약 매수 */
  reservedQty: number;
  /** 부족분 생산분이 검사에 합격해 자동 예약된 ACTIVE 매수 */
  passedQty: number;
  /** 진행 중 생산계획의 남은 목표 매수 (미확보 매수를 넘지 않게 자른 값) */
  inProductionQty: number;
  /** 현재 미확보 매수 = max(0, 주문 − 출하 − ACTIVE 예약) */
  unsecuredQty: number;
  /** 추가 계획 필요 매수 = max(0, 미확보 − 진행 계획 잔여 목표) */
  additionalPlanNeededQty: number;
  /** 취소된 품목의 미출하 잔량 (취소가 아니면 0) */
  cancelledQty: number;
  /** 진행률(%) = (reservedQty + passedQty + shippedQty) ÷ orderedQty */
  progressRate: number;
}

export interface SalesOrderView {
  id: number;
  salesOrderNo: string;
  customer: { id: number; customerCode: string; customerName: string };
  /** YYYY-MM-DD */
  dueDate: string;
  ownerEmployee: { id: number; employeeNo: string; employeeName: string };
  note: string | null;
  /** 품목 상태에서 계산한 헤더 상태 */
  salesOrderStatus: SalesOrderStatus;
  isCancelled: boolean;
  cancelledAt: string | null;
  cancelReason: string | null;
  orderedQty: number;
  orderedTon: string;
  shippedQty: number;
  shippedTon: string;
  progressRate: number;
  /** 납기까지 남은 일수 (오늘 = 0, 지났으면 음수) */
  daysToDue: number;
  isDeliveryRisk: boolean;
  /** 수주 업무방(chat_room) id */
  workRoomId: number | null;
  createdAt: string;
  items: SalesOrderItemView[];
}

const DAY_MS = 86_400_000;

export function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 오늘(Asia/Seoul)부터 납기일까지 남은 일수. */
export function daysUntil(dueDate: Date, now = new Date()): number {
  const { yyyymmdd } = kstParts(now);
  const today = Date.UTC(Number(yyyymmdd.slice(0, 4)), Number(yyyymmdd.slice(4, 6)) - 1, Number(yyyymmdd.slice(6, 8)));
  return Math.round((dueDate.getTime() - today) / DAY_MS);
}

/** 백분율 (소수 1자리, 버림 — 다 채우기 전에는 100이 되지 않게). */
export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.floor((part * 1000) / whole) / 10);
}

export const qtyTon = (qty: number, theoreticalWeightTon: Prisma.Decimal): Prisma.Decimal => theoreticalWeightTon.mul(qty);
export const tonText = (ton: Prisma.Decimal): string => ton.toFixed(3);

/** 계획의 남은 목표 매수 = 목표 매수 − 이미 적격이 된 생산분. */
export function remainingTargetQty(plan: { id: number; shortageQty: number; productionPlanStatus: string }, qualifiedByPlan: Map<number, number>): number {
  if (!OPEN_PLAN_STATUSES.includes(plan.productionPlanStatus)) return 0;
  return Math.max(0, plan.shortageQty - (qualifiedByPlan.get(plan.id) ?? 0));
}

export function toItemView(item: SalesOrderItemRow, qualifiedByPlan: Map<number, number>): SalesOrderItemView {
  const spec = item.productSpec;
  const itemType = spec.item.itemType as 'SLAB' | 'COIL';
  const isCancelled = item.salesOrderItemStatus === SALES_ORDER_ITEM_STATUS.CANCELLED;
  const active = item.reservations.filter((r) => r.status === RESERVATION_STATUS.ACTIVE);
  const reservedQty = active.filter((r) => !r.isAutoReserved).reduce((s, r) => s + r.reservedQty, 0);
  const passedQty = active.filter((r) => r.isAutoReserved).reduce((s, r) => s + r.reservedQty, 0);
  const unshippedQty = item.orderedQty - item.shippedQty;
  const unsecuredQty = isCancelled ? 0 : Math.max(0, unshippedQty - reservedQty - passedQty);
  const planRemainingQty = item.productionPlans.reduce((s, p) => s + remainingTargetQty(p, qualifiedByPlan), 0);
  return {
    id: item.id,
    lineNo: item.lineNo,
    productSpecId: item.productSpecId,
    specCode: spec.specCode,
    itemType,
    qtyUnit: ITEM_QTY_UNIT[itemType],
    steelGradeCode: spec.steelGrade.steelGradeCode,
    thicknessMm: spec.thicknessMm.toString(),
    widthMm: spec.widthMm.toString(),
    lengthMm: spec.lengthMm.toString(),
    theoreticalWeightTon: tonText(spec.theoreticalWeightTon),
    salesOrderItemStatus: item.salesOrderItemStatus as SalesOrderItemStatus,
    orderedQty: item.orderedQty,
    orderedTon: tonText(qtyTon(item.orderedQty, spec.theoreticalWeightTon)),
    shippedQty: item.shippedQty,
    shippedTon: tonText(qtyTon(item.shippedQty, spec.theoreticalWeightTon)),
    reservedQty,
    passedQty,
    inProductionQty: Math.min(unsecuredQty, planRemainingQty),
    unsecuredQty,
    additionalPlanNeededQty: Math.max(0, unsecuredQty - planRemainingQty),
    cancelledQty: isCancelled ? unshippedQty : 0,
    progressRate: percent(reservedQty + passedQty + item.shippedQty, item.orderedQty),
  };
}

export function toSalesOrderView(order: SalesOrderRow, qualifiedByPlan: Map<number, number>, deliveryRiskDays: number | null, now = new Date()): SalesOrderView {
  const items = order.items.map((i) => toItemView(i, qualifiedByPlan));
  const live = items.filter((i) => i.salesOrderItemStatus !== SALES_ORDER_ITEM_STATUS.CANCELLED);
  const salesOrderStatus = deriveSalesOrderStatus(items.map((i) => i.salesOrderItemStatus));
  const sum = (rows: SalesOrderItemView[], pick: (i: SalesOrderItemView) => number) => rows.reduce((s, i) => s + pick(i), 0);
  const orderedTon = order.items.reduce((s, i) => s.add(qtyTon(i.orderedQty, i.productSpec.theoreticalWeightTon)), new Prisma.Decimal(0));
  const shippedTon = order.items.reduce((s, i) => s.add(qtyTon(i.shippedQty, i.productSpec.theoreticalWeightTon)), new Prisma.Decimal(0));
  // 진행률 분모는 취소되지 않은 품목의 주문 매수. 전부 취소면 전체 주문 대비 출하 매수만 남는다.
  const basis = live.length ? live : items;
  const daysToDue = daysUntil(order.dueDate, now);
  const liveShortOfShipment = sum(live, (i) => i.shippedQty) < sum(live, (i) => i.orderedQty);
  return {
    id: order.id,
    salesOrderNo: order.salesOrderNo,
    customer: order.customer,
    dueDate: toDateOnly(order.dueDate),
    ownerEmployee: order.ownerEmployee,
    note: order.note,
    salesOrderStatus,
    isCancelled: order.isCancelled,
    cancelledAt: order.cancelledAt?.toISOString() ?? null,
    cancelReason: order.cancelReason,
    orderedQty: sum(items, (i) => i.orderedQty),
    orderedTon: tonText(orderedTon),
    shippedQty: sum(items, (i) => i.shippedQty),
    shippedTon: tonText(shippedTon),
    progressRate: percent(sum(basis, (i) => i.reservedQty + i.passedQty + i.shippedQty), sum(basis, (i) => i.orderedQty)),
    daysToDue,
    // 납기 위험(규칙): 남은 일수 ≤ 기준일이고 출하 매수 < 주문 매수 (REQ-MST-009, 용어 TRM-107). AI 판단이 아니다.
    isDeliveryRisk: deliveryRiskDays !== null && live.length > 0 && liveShortOfShipment && daysToDue <= deliveryRiskDays,
    workRoomId: order.chatRooms[0]?.id ?? null,
    createdAt: order.createdAt.toISOString(),
    items,
  };
}
