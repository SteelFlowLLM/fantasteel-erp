// 대시보드 위젯 조회 (REQ-DSH-001·002, BP-DSH-01 "권한 내 집계").
// - 숫자는 모두 core 읽기 모델(@/mock/services: 수주 충족 현황·재고·검사·MRP·구매·여재·작업 로그)과 테이블 행에서 가져와 묶기만 한다.
//   업무 계산식(가용·검사합격·납기 위험·순소요)을 다시 만들지 않는다. 묶는 방법은 features/dashboard/lib/widgetMath.ts.
// - 위젯마다 그 데이터를 보여 주는 화면과 같은 조회 권한을 요구한다(requireActor view → 없으면 COM-002, 화면은 잠금 표시).
// - 위젯 키는 화면 상수다 (공통 코드 그룹이 아니다).
import { requireActor, type Actor } from '@/api/actor';
import { mockQuery } from '@/api/client';
import { isServerDataSource } from '@/api/http';
import type { PurchaseOrderView, RequisitionView } from '@/api/purchasing';
import { serverBusinessEventApi } from '@/api/server/businessEvents';
import { serverDashboardApi } from '@/api/server/dashboard';
import { serverMrpRequirements } from '@/api/server/mrp';
import { serverPurchaseOrderApi } from '@/api/server/purchaseOrders';
import { serverPurchaseRequisitionApi } from '@/api/server/purchaseRequisitions';
import {
  PERMISSION,
  PROCESS_TYPE,
  PURCHASE_REQUISITION_STATUS,
  SALES_ORDER_ITEM_STATUS,
  type ActorType,
  type Permission,
  type ProcessType,
  type ProductItemType,
  type PurchaseRequisitionStatus,
  type RawMaterialType,
  type SalesOrderItemStatus,
} from '@/codes';
import { ageDays, bucketByDate, countRatio, isWithin, ratioText, trendWindow, weightedPlannedYield } from '@/features/dashboard/lib/widgetMath';
import { decCmp, decSum } from '@/lib/decimal';
import { canView } from '@/lib/permissions';
import { addDays, daysBetween } from '@/lib/salesOrderStatus';
import { toSeoulDateString } from '@/lib/seoulDate';
import { calcWeightTon, sumTon } from '@/lib/weight';
import { getMockDb } from '@/mock/db';
import type { LotRow, MockTables } from '@/mock/schema';
import {
  computeMrp,
  findById,
  hotRollingYieldOf,
  inspectionQueue,
  listPurchaseOrders,
  listPurchaseRequisitions,
  listSalesOrders,
  productInventory,
  productionSettingOf,
  productItemTypeOf,
  routingYieldOf,
  salesOrderDetail,
  surplusSlabs,
  timelineEventOf,
  theoreticalWeightOf,
} from '@/mock/services';

type Tables = Readonly<MockTables>;

// ── 위젯 키·권한 ─────────────────────────────────────────

/** 위젯 키 (화면 상수). 앞의 6개가 기본 위젯(REQ-DSH-001), 뒤의 8개가 추가 후보(REQ-DSH-002) */
export const DASHBOARD_WIDGET_KEYS = [
  'PROCESS_FLOW',
  'ORDER_FULFILLMENT',
  'AGENT_RISK',
  'RECENT_EVENTS',
  'PRODUCT_STOCK',
  'PROCESS_YIELD',
  'RAW_MATERIAL_BALANCE',
  'REJECT_RATE',
  'DELIVERY_RISK',
  'PURCHASE_PROGRESS',
  'SHIPMENT_RESULT',
  'SURPLUS_AGE',
  'PRODUCTION_VOLUME',
  'AI_USAGE',
] as const;
export type DashboardWidgetKey = (typeof DASHBOARD_WIDGET_KEYS)[number];

/** P2(2등급 AI) 위젯: 데이터 없이 '준비 중' 디자인만 (BP-DSH-01 "P2 미구현 시 Agent 영역은 비활성") */
export type SoonWidgetKey = 'AGENT_RISK' | 'AI_USAGE';
export type DataWidgetKey = Exclude<DashboardWidgetKey, SoonWidgetKey>;

const SALES_ORDER_VIEW = [PERMISSION.SALES_ORDER_CREATE, PERMISSION.SALES_ORDER_CANCEL] as const;

/**
 * 위젯을 볼 때 필요한 조회 권한 (하나라도 조회 이상). 빈 배열 = 모든 사원.
 * 그 데이터를 보여 주는 화면의 여는 조건(features/shell/screens.ts)과 같게 둔다.
 */
export const DASHBOARD_WIDGET_VIEW: Record<DataWidgetKey, readonly Permission[]> = {
  /** 모든 사원이 6단계 건수를 모두 본다. 단계를 눌러 화면으로 가는 것만 그 화면을 열 권한이 있을 때 (2026-10-07 사용자 결정) */
  PROCESS_FLOW: [],
  ORDER_FULFILLMENT: SALES_ORDER_VIEW,
  /** 작업 로그 화면은 모든 사원이 연다 */
  RECENT_EVENTS: [],
  /** 재고 화면은 모든 사원이 연다 */
  PRODUCT_STOCK: [],
  PROCESS_YIELD: [PERMISSION.PRODUCTION_RESULT_CONFIRM],
  RAW_MATERIAL_BALANCE: [PERMISSION.PURCHASE_REQUISITION_CREATE],
  REJECT_RATE: [PERMISSION.INSPECTION_REGISTER],
  DELIVERY_RISK: SALES_ORDER_VIEW,
  PURCHASE_PROGRESS: [PERMISSION.PURCHASE_REQUISITION_CREATE, PERMISSION.PURCHASE_ORDER_CONFIRM],
  SHIPMENT_RESULT: [PERMISSION.GOODS_ISSUE_CONFIRM],
  /** 여재는 재고 화면의 한 탭 → 모든 사원 */
  SURPLUS_AGE: [],
  PRODUCTION_VOLUME: [PERMISSION.PRODUCTION_RESULT_CONFIRM],
};

/** 추이 위젯(강종별 불합격률·출하 실적·생산량)의 기간: 오늘 포함 최근 30일 (가정값, docs/rework/areas/dashboard.md) */
export const DASHBOARD_TREND_DAYS = 30;
/** 원료 잔량 대비 소요: 필요일이 오늘부터 30일 안인 계획까지 (지난 필요일 포함, 가정값) */
export const DASHBOARD_MRP_HORIZON_DAYS = 30;
/** 최근 작업 로그 줄 수 */
export const DASHBOARD_RECENT_EVENT_LIMIT = 20;

const MRP_EARLIEST = '0001-01-01';

/** 위젯 권한 확인: 로그인 사원 + 그 위젯의 조회 권한 (없으면 COM-002) */
function requireWidgetActor(tables: Tables, key: DataWidgetKey): Actor {
  const view = DASHBOARD_WIDGET_VIEW[key];
  return requireActor(tables, view.length > 0 ? { view } : {});
}

export interface DashboardQueryOptions {
  /** 기준일 YYYY-MM-DD (생략하면 오늘, 서울). 테스트에서 고정할 때 쓴다 */
  today?: string;
}

const todayOf = (options: DashboardQueryOptions = {}): string => options.today ?? toSeoulDateString(new Date());
const seoulDate = (iso: string): string => toSeoulDateString(new Date(iso));
/** 진행 중 수주·수주 품목 상태 (진행중·부분출하) */
const OPEN_SALES_ORDER_STATUSES: ReadonlySet<SalesOrderItemStatus> = new Set<SalesOrderItemStatus>([
  SALES_ORDER_ITEM_STATUS.OPEN,
  SALES_ORDER_ITEM_STATUS.PARTIALLY_SHIPPED,
]);

// ── 공정 흐름 현황 ───────────────────────────────────────

export interface ProcessFlowData {
  today: string;
  /** 진행 중 수주 (진행중·부분출하). 서버 타입과 같이 null을 허용하지만 지금은 늘 채운다 */
  salesOrders: { openCount: number; dueRiskCount: number } | null;
  productionPlans: { plannedCount: number; inProgressCount: number } | null;
  /** 판정 대기 LOT (히트·슬래브·코일) */
  inspections: { pendingCount: number; heatCount: number; slabCount: number; coilCount: number } | null;
  /** 제품 가용 매수 (4.2, 재고 화면과 같은 값) */
  inventories: { slabAvailableQty: number; coilAvailableQty: number };
  shipmentRequests: { requestedCount: number; allocatedCount: number } | null;
  /** 오늘 출고 확정 */
  goodsIssues: { issuedRequestCount: number; issuedLotCount: number } | null;
}

function readProcessFlow(tables: Tables, options: DashboardQueryOptions): ProcessFlowData {
  requireWidgetActor(tables, 'PROCESS_FLOW');
  const today = todayOf(options);
  const inventory = productInventory(tables);
  const availableOf = (type: ProductItemType) => inventory.filter((r) => r.itemType === type).reduce((s, r) => s + r.availableQty, 0);

  const open = listSalesOrders(tables, { today }).filter((so) => OPEN_SALES_ORDER_STATUSES.has(so.status));
  const pending = inspectionQueue(tables).filter((r) => r.inspectionResult === 'PENDING');
  const countOf = (type: LotRow['lotType']) => pending.filter((r) => r.lotType === type).length;
  return {
    today,
    salesOrders: { openCount: open.length, dueRiskCount: open.filter((so) => so.isDueRisk).length },
    productionPlans: {
      plannedCount: tables.productionPlan.filter((p) => p.productionPlanStatus === 'PLANNED').length,
      inProgressCount: tables.productionPlan.filter((p) => p.productionPlanStatus === 'IN_PROGRESS').length,
    },
    inspections: { pendingCount: pending.length, heatCount: countOf('HEAT'), slabCount: countOf('SLAB'), coilCount: countOf('COIL') },
    inventories: { slabAvailableQty: availableOf('SLAB'), coilAvailableQty: availableOf('COIL') },
    shipmentRequests: {
      requestedCount: tables.shipmentRequest.filter((r) => r.shipmentRequestStatus === 'REQUESTED').length,
      allocatedCount: tables.shipmentRequest.filter((r) => r.shipmentRequestStatus === 'ALLOCATED').length,
    },
    goodsIssues: {
      issuedRequestCount: tables.shipmentRequest.filter((r) => r.issuedAt !== null && seoulDate(r.issuedAt) === today).length,
      issuedLotCount: tables.lot.filter((l) => l.shippedAt !== null && seoulDate(l.shippedAt) === today).length,
    },
  };
}

// ── 수주 충족 현황 ───────────────────────────────────────

export interface FulfillmentItemRow {
  salesOrderItemId: number;
  lineNo: number;
  itemCode: string;
  itemType: ProductItemType;
  orderedQty: number;
  orderedTon: string;
  /** 생산중 = 진행중·완료 연결 계획의 잔여 목표 (분모: 수주 매수) */
  inProductionQty: number;
  /** 검사합격 = ACTIVE 예약 + 출고 (분모: 수주 매수) */
  passedQty: number;
  /** 예약 = ACTIVE 예약 (분모: 미출하 매수) */
  reservedQty: number;
  unshippedQty: number;
  shippedQty: number;
  /** 진행률 = 출하 ÷ 수주 매수 (0~1) */
  shippedRatio: number | null;
  dueDate: string;
  daysToDue: number;
  isDueRisk: boolean;
}

export interface FulfillmentSalesOrderRow {
  salesOrderId: number;
  salesOrderNo: string;
  customerName: string;
  earliestDueDate: string | null;
  isDueRisk: boolean;
  items: FulfillmentItemRow[];
}

export interface OrderFulfillmentData {
  today: string;
  deliveryRiskDays: number;
  salesOrders: FulfillmentSalesOrderRow[];
}

function readOrderFulfillment(tables: Tables, options: DashboardQueryOptions): OrderFulfillmentData {
  requireWidgetActor(tables, 'ORDER_FULFILLMENT');
  const today = todayOf(options);
  const open = listSalesOrders(tables, { today })
    .filter((so) => OPEN_SALES_ORDER_STATUSES.has(so.status))
    .sort((a, b) => (a.earliestDueDate ?? '9999').localeCompare(b.earliestDueDate ?? '9999') || a.id - b.id);
  return {
    today,
    deliveryRiskDays: productionSettingOf(tables).deliveryRiskDays,
    salesOrders: open.map((so) => {
      const detail = salesOrderDetail(tables, so.id, { today });
      return {
        salesOrderId: so.id,
        salesOrderNo: so.salesOrderNo,
        customerName: so.customerName,
        earliestDueDate: so.earliestDueDate,
        isDueRisk: so.isDueRisk,
        items: detail.items
          .filter((i) => i.salesOrderItemStatus !== 'CANCELLED')
          .map((i) => ({
            salesOrderItemId: i.salesOrderItemId,
            lineNo: i.lineNo,
            itemCode: i.itemCode,
            itemType: i.itemType,
            orderedQty: i.orderedQty,
            orderedTon: i.orderedTon,
            inProductionQty: i.inProductionQty,
            passedQty: i.securedQty,
            reservedQty: i.activeReservedQty,
            unshippedQty: i.shortage.unshippedQty,
            shippedQty: i.shippedQty,
            shippedRatio: i.measures.shipped.ratio,
            dueDate: i.dueDate,
            daysToDue: daysBetween(today, i.dueDate),
            isDueRisk: i.isDueRisk,
          })),
      };
    }),
  };
}

// ── 최근 작업 로그 ───────────────────────────────────────

export interface RecentEventRow {
  id: number;
  eventNo: string;
  occurredAt: string;
  actorType: ActorType;
  actorName: string;
  businessEventTypeLabel: string;
  targetNo: string | null;
  reasonText: string | null;
  /** AI 경유 (P2, 지금은 늘 false) */
  isAiAssisted: boolean;
}

export interface RecentEventsData {
  totalCount: number;
  items: RecentEventRow[];
}

function readRecentEvents(tables: Tables): RecentEventsData {
  requireWidgetActor(tables, 'RECENT_EVENTS');
  const latest = [...tables.businessEvent].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id - a.id).slice(0, DASHBOARD_RECENT_EVENT_LIMIT);
  return {
    totalCount: tables.businessEvent.length,
    items: latest.map((row) => {
      const event = timelineEventOf(tables, row);
      return {
        id: event.id,
        eventNo: event.eventNo,
        occurredAt: event.occurredAt,
        actorType: event.actorType,
        actorName: event.actorName,
        businessEventTypeLabel: event.businessEventTypeLabel,
        targetNo: event.targetNo,
        reasonText: event.reasonText,
        isAiAssisted: row.isAiAssisted,
      };
    }),
  };
}

// ── 제품 재고 ───────────────────────────────────────────

export interface ProductStockRow {
  itemId: number;
  itemCode: string;
  itemType: ProductItemType;
  steelGradeCode: string | null;
  onHandQty: number;
  passedQty: number;
  reservedQty: number;
  availableQty: number;
  onHandTon: string;
  availableTon: string;
}

export interface ProductStockTotal {
  itemType: ProductItemType;
  onHandQty: number;
  passedQty: number;
  reservedQty: number;
  availableQty: number;
  onHandTon: string;
  availableTon: string;
}

export interface ProductStockData {
  totals: ProductStockTotal[];
  /** 재고(미소진 LOT)가 있는 규격만 */
  items: ProductStockRow[];
}

function readProductStock(tables: Tables): ProductStockData {
  requireWidgetActor(tables, 'PRODUCT_STOCK');
  const rows = productInventory(tables);
  const totals = (['SLAB', 'COIL'] as const).map((itemType): ProductStockTotal => {
    const ofType = rows.filter((r) => r.itemType === itemType);
    return {
      itemType,
      onHandQty: ofType.reduce((s, r) => s + r.onHandQty, 0),
      passedQty: ofType.reduce((s, r) => s + r.passedQty, 0),
      reservedQty: ofType.reduce((s, r) => s + r.reservedQty, 0),
      availableQty: ofType.reduce((s, r) => s + r.availableQty, 0),
      onHandTon: sumTon(ofType.map((r) => r.onHandTon)),
      availableTon: sumTon(ofType.map((r) => r.availableTon)),
    };
  });
  return {
    totals,
    items: rows
      .filter((r) => r.onHandQty > 0)
      .map((r) => ({
        itemId: r.itemId,
        itemCode: r.itemCode,
        itemType: r.itemType,
        steelGradeCode: r.steelGradeCode,
        onHandQty: r.onHandQty,
        passedQty: r.passedQty,
        reservedQty: r.reservedQty,
        availableQty: r.availableQty,
        onHandTon: r.onHandTon,
        availableTon: r.availableTon,
      })),
  };
}

// ── 공정별 수율 ─────────────────────────────────────────

export interface ProcessYieldRow {
  processType: ProcessType;
  /** 완료된 작업 실적 수 */
  resultCount: number;
  inputTon: string;
  outputTon: string;
  /** 실적 수율 = 산출 ÷ 투입. 제선은 계획 수율을 쓰지 않아 null */
  actualYieldRate: string | null;
  /** 계획 수율 (라우팅·규격 매핑, 투입량 가중). 제선은 null */
  plannedYieldRate: string | null;
  /** 연주: 실적 매수 ÷ 계획 매수(실적 + 손실). 그 밖은 null */
  qtyAttainmentRate: string | null;
}

export interface ProcessYieldData {
  processes: ProcessYieldRow[];
}

function readProcessYield(tables: Tables): ProcessYieldData {
  requireWidgetActor(tables, 'PROCESS_YIELD');
  const processes = Object.values(PROCESS_TYPE).map((processType): ProcessYieldRow => {
    const results = tables.productionResult.filter((r) => r.processType === processType && r.completedAt !== null && r.inputTon !== null && r.outputTon !== null);
    const inputTon = decSum(results.map((r) => r.inputTon ?? '0'));
    const outputTon = decSum(results.map((r) => r.outputTon ?? '0'));
    if (processType === 'IRONMAKING') {
      return { processType, resultCount: results.length, inputTon, outputTon, actualYieldRate: null, plannedYieldRate: null, qtyAttainmentRate: null };
    }
    const plannedYieldRate = weightedPlannedYield(
      results.map((r) => {
        const plan = findById(tables, 'productionPlan', r.productionPlanId);
        const item = findById(tables, 'item', plan?.itemId);
        const rate = !item ? null : processType === 'HOT_ROLLING' ? hotRollingYieldOf(tables, item) : routingYieldOf(tables, productItemTypeOf(item), processType);
        return { inputTon: r.inputTon ?? '0', plannedYieldRate: rate };
      }),
    );
    const outputQty = results.reduce((s, r) => s + (r.outputQty ?? 0), 0);
    const lossQty = results.reduce((s, r) => s + (r.lossQty ?? 0), 0);
    return {
      processType,
      resultCount: results.length,
      inputTon,
      outputTon,
      actualYieldRate: ratioText(outputTon, inputTon),
      plannedYieldRate,
      qtyAttainmentRate: processType === 'CONTINUOUS_CASTING' ? ratioText(outputQty, outputQty + lossQty) : null,
    };
  });
  return { processes };
}

// ── 원료 잔량 대비 소요 ─────────────────────────────────

export interface RawMaterialBalanceRow {
  itemId: number;
  itemCode: string;
  itemName: string;
  rawMaterialType: RawMaterialType | null;
  onHandTon: string;
  /** 입고예정 합계 (확정 발주의 미입고량) */
  scheduledReceiptTon: string;
  /** 입고예정 중 이 계획들이 필요일까지 받아 쓰는 몫 (MRP 화면 입고예정 칸과 같은 값 — 다른 계획 몫·필요일 뒤 도착분 제외) */
  coveredScheduledTon: string;
  grossTon: string;
  netTon: string;
  firstShortageDate: string | null;
}

export interface RawMaterialBalanceData {
  /** MRP 기간 끝 (필요일) */
  to: string;
  planCount: number;
  materials: RawMaterialBalanceRow[];
}

function readRawMaterialBalance(tables: Tables, options: DashboardQueryOptions): RawMaterialBalanceData {
  requireWidgetActor(tables, 'RAW_MATERIAL_BALANCE');
  const to = addDays(todayOf(options), DASHBOARD_MRP_HORIZON_DAYS);
  const mrp = computeMrp(tables, { from: MRP_EARLIEST, to });
  return {
    to,
    planCount: mrp.plans.length,
    materials: mrp.materials.map((m) => ({
      itemId: m.itemId,
      itemCode: m.itemCode,
      itemName: m.itemName,
      rawMaterialType: m.rawMaterialType,
      onHandTon: m.onHandTon,
      scheduledReceiptTon: m.scheduledReceiptTon,
      coveredScheduledTon: m.coveredScheduledTon,
      grossTon: m.grossTon,
      netTon: m.netTon,
      firstShortageDate: m.firstShortageDate,
    })),
  };
}

/** 서버 모드 원료 잔량 대비 소요: 서버 MRP(GET mrp/requirements)를 같은 기간으로 읽는다 */
async function readRawMaterialBalanceFromServer(): Promise<RawMaterialBalanceData> {
  getMockDb().read((tables) => requireWidgetActor(tables, 'RAW_MATERIAL_BALANCE'));
  const to = addDays(todayOf(), DASHBOARD_MRP_HORIZON_DAYS);
  const mrp = await serverMrpRequirements({ from: MRP_EARLIEST, to });
  return {
    to,
    planCount: mrp.plans.length,
    materials: mrp.materials.map((m) => ({
      itemId: m.itemId,
      itemCode: m.itemCode,
      itemName: m.itemName,
      rawMaterialType: m.rawMaterialType,
      onHandTon: m.remainingTon,
      scheduledReceiptTon: m.scheduledReceiptTon,
      coveredScheduledTon: m.usedScheduledReceiptTon,
      grossTon: m.requiredTon,
      netTon: m.netRequirementTon,
      firstShortageDate: m.firstShortageDate,
    })),
  };
}

// ── 강종별 불합격률 ─────────────────────────────────────

const INSPECTED_PROCESSES = ['STEELMAKING', 'CONTINUOUS_CASTING', 'HOT_ROLLING'] as const satisfies readonly ProcessType[];

export interface RejectRateCell {
  inspectedCount: number;
  failedCount: number;
  /** 불합격 ÷ 판정된 검사 (0~1). 검사가 없으면 null */
  rejectRate: number | null;
}

export interface RejectRateRow extends RejectRateCell {
  steelGradeId: number;
  steelGradeCode: string;
  byProcess: ({ processType: (typeof INSPECTED_PROCESSES)[number] } & RejectRateCell)[];
}

export interface RejectRateData {
  from: string;
  to: string;
  days: number;
  grades: RejectRateRow[];
}

function readRejectRate(tables: Tables, options: DashboardQueryOptions): RejectRateData {
  requireWidgetActor(tables, 'REJECT_RATE');
  const window = trendWindow(todayOf(options), DASHBOARD_TREND_DAYS);
  const judged = tables.qualityInspection
    .filter((q) => (q.inspectionResult === 'PASS' || q.inspectionResult === 'FAIL') && q.inspectedAt !== null && isWithin(seoulDate(q.inspectedAt), window))
    .map((q) => ({ inspection: q, lot: findById(tables, 'lot', q.lotId) }));
  const cell = (rows: typeof judged): RejectRateCell => {
    const failedCount = rows.filter((r) => r.inspection.inspectionResult === 'FAIL').length;
    return { inspectedCount: rows.length, failedCount, rejectRate: countRatio(failedCount, rows.length) };
  };
  return {
    from: window.from,
    to: window.to,
    days: DASHBOARD_TREND_DAYS,
    grades: [...tables.steelGrade]
      .sort((a, b) => a.id - b.id)
      .map((grade) => {
        const ofGrade = judged.filter((r) => r.lot?.steelGradeId === grade.id);
        return {
          steelGradeId: grade.id,
          steelGradeCode: grade.steelGradeCode,
          ...cell(ofGrade),
          byProcess: INSPECTED_PROCESSES.map((processType) => ({ processType, ...cell(ofGrade.filter((r) => r.inspection.processType === processType)) })),
        };
      }),
  };
}

// ── 납기 위험 수주 ───────────────────────────────────────

export interface DeliveryRiskRow {
  salesOrderId: number;
  salesOrderNo: string;
  customerName: string;
  salesOrderItemId: number;
  lineNo: number;
  itemCode: string;
  itemType: ProductItemType;
  orderedQty: number;
  shippedQty: number;
  unshippedQty: number;
  unshippedTon: string;
  dueDate: string;
  daysToDue: number;
  isOverdue: boolean;
}

export interface DeliveryRiskData {
  today: string;
  deliveryRiskDays: number;
  /** 진행 중 수주 품목 수 */
  openItemCount: number;
  items: DeliveryRiskRow[];
}

function readDeliveryRisk(tables: Tables, options: DashboardQueryOptions): DeliveryRiskData {
  requireWidgetActor(tables, 'DELIVERY_RISK');
  const today = todayOf(options);
  const rows: DeliveryRiskRow[] = [];
  let openItemCount = 0;
  for (const so of listSalesOrders(tables, { today }).filter((s) => OPEN_SALES_ORDER_STATUSES.has(s.status))) {
    for (const item of salesOrderDetail(tables, so.id, { today }).items) {
      if (!OPEN_SALES_ORDER_STATUSES.has(item.salesOrderItemStatus)) continue;
      openItemCount += 1;
      if (!item.isDueRisk) continue;
      const daysToDue = daysBetween(today, item.dueDate);
      rows.push({
        salesOrderId: so.id,
        salesOrderNo: so.salesOrderNo,
        customerName: so.customerName,
        salesOrderItemId: item.salesOrderItemId,
        lineNo: item.lineNo,
        itemCode: item.itemCode,
        itemType: item.itemType,
        orderedQty: item.orderedQty,
        shippedQty: item.shippedQty,
        unshippedQty: item.shortage.unshippedQty,
        unshippedTon: calcWeightTon(item.shortage.unshippedQty, item.theoreticalWeightTon),
        dueDate: item.dueDate,
        daysToDue,
        isOverdue: daysToDue < 0,
      });
    }
  }
  rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.salesOrderNo.localeCompare(b.salesOrderNo) || a.lineNo - b.lineNo);
  return { today, deliveryRiskDays: productionSettingOf(tables).deliveryRiskDays, openItemCount, items: rows };
}

// ── 구매 진행 ───────────────────────────────────────────

export interface OpenPurchaseOrderRow {
  purchaseOrderId: number;
  purchaseOrderNo: string;
  supplierName: string;
  /** 남은 품목 중 가장 이른 입고 예정일 (발주 단위 납기는 ERD에 없다) */
  expectedReceiptDate: string | null;
  /** 입고예정 (미입고량 합계) */
  scheduledReceiptTon: string;
  lineCount: number;
}

export interface PurchaseProgressData {
  /** 구매요청 상태별 건수 — 구매요청 조회 권한이 없으면 null */
  requisitionsByStatus: { status: PurchaseRequisitionStatus; count: number }[] | null;
  /** 입고가 남은 발주 — 발주 조회 권한이 없으면 null */
  openPurchaseOrders: { count: number; scheduledReceiptTon: string; purchaseOrders: OpenPurchaseOrderRow[] } | null;
}

/** 구매요청·발주 목록 → 구매 진행 위젯 (가짜 DB·서버 모드가 같이 쓴다). 조회 권한이 없는 쪽은 null */
function purchaseProgressOf(requisitions: readonly RequisitionView[] | null, purchaseOrders: readonly PurchaseOrderView[] | null): PurchaseProgressData {
  const requisitionsByStatus = requisitions
    ? Object.values(PURCHASE_REQUISITION_STATUS).map((status) => ({ status, count: requisitions.filter((r) => r.purchaseRequisitionStatus === status).length }))
    : null;
  if (!purchaseOrders) return { requisitionsByStatus, openPurchaseOrders: null };
  const open = purchaseOrders
    .filter((po) => po.purchaseOrderStatus !== 'RECEIVED')
    .map((po) => ({
      purchaseOrderId: po.id,
      purchaseOrderNo: po.purchaseOrderNo,
      supplierName: po.supplierName,
      expectedReceiptDate: po.items.filter((i) => decCmp(i.remainingTon, 0) > 0).map((i) => i.expectedReceiptDate).filter((d): d is string => d !== null).sort()[0] ?? null,
      scheduledReceiptTon: decSum(po.items.map((i) => i.remainingTon)),
      lineCount: po.items.length,
    }))
    .sort((a, b) => (a.expectedReceiptDate ?? '9999').localeCompare(b.expectedReceiptDate ?? '9999') || a.purchaseOrderNo.localeCompare(b.purchaseOrderNo));
  return { requisitionsByStatus, openPurchaseOrders: { count: open.length, scheduledReceiptTon: decSum(open.map((po) => po.scheduledReceiptTon)), purchaseOrders: open } };
}

function readPurchaseProgress(tables: Tables): PurchaseProgressData {
  const actor = requireWidgetActor(tables, 'PURCHASE_PROGRESS');
  return purchaseProgressOf(
    canView(actor, PERMISSION.PURCHASE_REQUISITION_CREATE) ? listPurchaseRequisitions(tables) : null,
    canView(actor, PERMISSION.PURCHASE_ORDER_CONFIRM) ? listPurchaseOrders(tables) : null,
  );
}

/** 서버 모드 구매 진행: 권한은 가짜 DB 모드와 같이 보고(계정 선택이 가짜 DB 사원), 목록은 서버에서 읽는다 */
async function readPurchaseProgressFromServer(): Promise<PurchaseProgressData> {
  const actor = getMockDb().read((tables) => requireWidgetActor(tables, 'PURCHASE_PROGRESS'));
  const [requisitions, purchaseOrders] = await Promise.all([
    canView(actor, PERMISSION.PURCHASE_REQUISITION_CREATE) ? serverPurchaseRequisitionApi.list() : null,
    canView(actor, PERMISSION.PURCHASE_ORDER_CONFIRM) ? serverPurchaseOrderApi.list() : null,
  ]);
  return purchaseProgressOf(requisitions, purchaseOrders);
}

// ── 출하 실적 · 생산량 (하루 단위) ────────────────────────

export interface DailyProductPoint {
  date: string;
  slabQty: number;
  coilQty: number;
  ton: string;
}

export interface ShipmentResultData {
  from: string;
  to: string;
  days: number;
  /** 기간 안 출고 확정 출하요청 수 */
  issuedRequestCount: number;
  totalSlabQty: number;
  totalCoilQty: number;
  totalTon: string;
  series: DailyProductPoint[];
}

export interface ProductionVolumeData {
  from: string;
  to: string;
  days: number;
  totalSlabQty: number;
  totalCoilQty: number;
  totalTon: string;
  series: DailyProductPoint[];
}

/** 제품 LOT(슬래브·코일)을 날짜별로 센다. 톤 = 매수 × 1매 이론중량 */
function dailyProductSeries(tables: Tables, lots: readonly LotRow[], dateOf: (lot: LotRow) => string, window: ReturnType<typeof trendWindow>): DailyProductPoint[] {
  const tonOf = (lot: LotRow) => {
    const item = findById(tables, 'item', lot.itemId);
    return item ? theoreticalWeightOf(item) : '0';
  };
  return [...bucketByDate(lots, dateOf, window)].map(([date, rows]) => ({
    date,
    slabQty: rows.filter((l) => l.lotType === 'SLAB').length,
    coilQty: rows.filter((l) => l.lotType === 'COIL').length,
    ton: sumTon(rows.map(tonOf)),
  }));
}

const totalsOf = (series: readonly DailyProductPoint[]) => ({
  totalSlabQty: series.reduce((s, p) => s + p.slabQty, 0),
  totalCoilQty: series.reduce((s, p) => s + p.coilQty, 0),
  totalTon: sumTon(series.map((p) => p.ton)),
});

function readShipmentResult(tables: Tables, options: DashboardQueryOptions): ShipmentResultData {
  requireWidgetActor(tables, 'SHIPMENT_RESULT');
  const window = trendWindow(todayOf(options), DASHBOARD_TREND_DAYS);
  const shipped = tables.lot.filter((l) => (l.lotType === 'SLAB' || l.lotType === 'COIL') && l.shippedAt !== null);
  const series = dailyProductSeries(tables, shipped, (l) => seoulDate(l.shippedAt ?? ''), window);
  return {
    from: window.from,
    to: window.to,
    days: DASHBOARD_TREND_DAYS,
    issuedRequestCount: tables.shipmentRequest.filter((r) => r.issuedAt !== null && isWithin(seoulDate(r.issuedAt), window)).length,
    ...totalsOf(series),
    series,
  };
}

function readProductionVolume(tables: Tables, options: DashboardQueryOptions): ProductionVolumeData {
  requireWidgetActor(tables, 'PRODUCTION_VOLUME');
  const window = trendWindow(todayOf(options), DASHBOARD_TREND_DAYS);
  const products = tables.lot.filter((l) => l.lotType === 'SLAB' || l.lotType === 'COIL');
  const series = dailyProductSeries(tables, products, (l) => l.producedDate, window);
  return { from: window.from, to: window.to, days: DASHBOARD_TREND_DAYS, ...totalsOf(series), series };
}

// ── 여재 보유 기간 ───────────────────────────────────────

export interface SurplusAgeRow {
  itemId: number;
  itemCode: string;
  steelGradeCode: string | null;
  /** 여재 매수 (TRM-048) = core `surplusSlabs`의 여재 매수 — 재고 화면 여재 탭과 같은 값 */
  surplusQty: number;
  surplusTon: string;
  /** 여재 슬래브가 여재로 바뀐 날(surplus_at, 없으면 생산완료일) 중 가장 이른 날 */
  oldestSinceDate: string;
  /** 최장 보유 일수 = 오늘 − oldestSinceDate */
  maxAgeDays: number;
}

export interface SurplusAgeData {
  today: string;
  totalQty: number;
  totalTon: string;
  maxAgeDays: number | null;
  items: SurplusAgeRow[];
}

function readSurplusAge(tables: Tables, options: DashboardQueryOptions): SurplusAgeData {
  requireWidgetActor(tables, 'SURPLUS_AGE');
  const today = todayOf(options);
  // 재고 화면 여재 탭과 같은 core 읽기 모델(surplusSlabs: 여재 매수·여재 슬래브)을 그대로 쓴다 → 두 화면의 여재 숫자가 같다
  const items = surplusSlabs(tables)
    .filter((row) => row.surplusQty > 0)
    .map((row): SurplusAgeRow => {
      const sinceDates = row.lots.map((l) => (l.surplusAt !== null ? seoulDate(l.surplusAt) : l.producedDate)).sort();
      const oldestSinceDate = sinceDates[0] ?? today;
      const item = findById(tables, 'item', row.itemId);
      return {
        itemId: row.itemId,
        itemCode: row.itemCode,
        steelGradeCode: row.steelGradeCode,
        surplusQty: row.surplusQty,
        surplusTon: item ? calcWeightTon(row.surplusQty, theoreticalWeightOf(item)) : '0.000',
        oldestSinceDate,
        maxAgeDays: ageDays(oldestSinceDate, today),
      };
    })
    .sort((a, b) => b.maxAgeDays - a.maxAgeDays || a.itemCode.localeCompare(b.itemCode));
  return {
    today,
    totalQty: items.reduce((s, r) => s + r.surplusQty, 0),
    totalTon: sumTon(items.map((r) => r.surplusTon)),
    maxAgeDays: items.length > 0 ? Math.max(...items.map((r) => r.maxAgeDays)) : null,
    items,
  };
}

// ── 묶음 ────────────────────────────────────────────────

export interface DashboardWidgetDataMap {
  PROCESS_FLOW: ProcessFlowData;
  ORDER_FULFILLMENT: OrderFulfillmentData;
  RECENT_EVENTS: RecentEventsData;
  PRODUCT_STOCK: ProductStockData;
  PROCESS_YIELD: ProcessYieldData;
  RAW_MATERIAL_BALANCE: RawMaterialBalanceData;
  REJECT_RATE: RejectRateData;
  DELIVERY_RISK: DeliveryRiskData;
  PURCHASE_PROGRESS: PurchaseProgressData;
  SHIPMENT_RESULT: ShipmentResultData;
  SURPLUS_AGE: SurplusAgeData;
  PRODUCTION_VOLUME: ProductionVolumeData;
}

type WidgetReaders = { [K in DataWidgetKey]: (tables: Tables, options: DashboardQueryOptions) => DashboardWidgetDataMap[K] };

const READERS: WidgetReaders = {
  PROCESS_FLOW: readProcessFlow,
  ORDER_FULFILLMENT: readOrderFulfillment,
  RECENT_EVENTS: readRecentEvents,
  PRODUCT_STOCK: readProductStock,
  PROCESS_YIELD: readProcessYield,
  RAW_MATERIAL_BALANCE: readRawMaterialBalance,
  REJECT_RATE: readRejectRate,
  DELIVERY_RISK: readDeliveryRisk,
  PURCHASE_PROGRESS: readPurchaseProgress,
  SHIPMENT_RESULT: readShipmentResult,
  SURPLUS_AGE: readSurplusAge,
  PRODUCTION_VOLUME: readProductionVolume,
};

export const dashboardKeys = {
  all: ['dashboard'] as const,
  widget: (key: DataWidgetKey, employeeId: number) => ['dashboard', 'widgets', key, employeeId] as const,
};

/** 서버 모드에서 서버를 읽는 위젯 (영업·구매 위젯, 최근 작업 로그). 나머지는 서버 모드에서도 가짜 DB를 읽는다 */
type ServerWidgetKey = 'PROCESS_FLOW' | 'ORDER_FULFILLMENT' | 'PRODUCT_STOCK' | 'RAW_MATERIAL_BALANCE' | 'PURCHASE_PROGRESS' | 'RECENT_EVENTS';
const SERVER_READERS: { [K in ServerWidgetKey]: () => Promise<DashboardWidgetDataMap[K]> } = {
  PROCESS_FLOW: serverDashboardApi.processFlow,
  ORDER_FULFILLMENT: serverDashboardApi.orderFulfillment,
  PRODUCT_STOCK: serverDashboardApi.productStock,
  RAW_MATERIAL_BALANCE: readRawMaterialBalanceFromServer,
  PURCHASE_PROGRESS: readPurchaseProgressFromServer,
  RECENT_EVENTS: () => serverBusinessEventApi.recentEvents(DASHBOARD_RECENT_EVENT_LIMIT),
};
const isServerWidget = (key: DataWidgetKey): key is ServerWidgetKey => key in SERVER_READERS;

export const dashboardApi = {
  /** 위젯 하나의 데이터 (권한이 없으면 COM-002). today 옵션은 가짜 DB 테스트용이라 서버 모드에서는 쓰지 않는다 */
  widget: <K extends DataWidgetKey>(key: K, options: DashboardQueryOptions = {}): Promise<DashboardWidgetDataMap[K]> => {
    if (isServerDataSource() && isServerWidget(key)) {
      // key가 ServerWidgetKey로 좁혀져도 K는 좁혀지지 않아 같은 위젯 키의 반환 타입으로 맞춘다
      return (SERVER_READERS[key] as () => Promise<DashboardWidgetDataMap[K]>)();
    }
    return mockQuery((tables) => {
      const reader: WidgetReaders[K] = READERS[key];
      return reader(tables, options);
    });
  },
};
