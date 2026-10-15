// 대시보드 위젯 조회 (REQ-DSH-001·002, BP-DSH-01 "권한 내 집계").
// - 숫자는 서버 대시보드 API와 다른 화면의 서버 목록(api/server/dashboard.ts 등)을 묶기만 한다.
//   업무 계산식(가용·검사합격·납기 위험·순소요)을 다시 만들지 않는다. 묶는 방법은 features/dashboard/lib/widgetMath.ts.
// - 위젯마다 그 데이터를 보여 주는 화면과 같은 조회 권한을 요구한다(로그인 사원 /auth/me 권한 → 없으면 COM-002, 화면은 잠금 표시).
// - 위젯 키는 화면 상수다 (공통 코드 그룹이 아니다).
import type { AgentCandidateView, AgentRiskType, AuthUser } from '@fantasteel/shared';
import { ApiError } from '@/api/errors';
import { serverRequest } from '@/api/http';
import type { PurchaseOrderView, RequisitionView } from '@/api/purchasing';
import { serverAgentCandidateApi } from '@/api/server/agentCandidates';
import { serverBusinessEventApi } from '@/api/server/businessEvents';
import { serverDashboardApi, serverDashboardSourceApi } from '@/api/server/dashboard';
import { serverMrpRequirements } from '@/api/server/mrp';
import { serverPurchaseOrderApi } from '@/api/server/purchaseOrders';
import { serverPurchaseRequisitionApi } from '@/api/server/purchaseRequisitions';
import {
  PERMISSION,
  PURCHASE_REQUISITION_STATUS,
  type ActorType,
  type DraftStatus,
  type Permission,
  type ProcessType,
  type ProductItemType,
  type PurchaseRequisitionStatus,
  type RawMaterialType,
} from '@/codes';
import { trendWindow } from '@/features/dashboard/lib/widgetMath';
import { decCmp, decSum } from '@/lib/decimal';
import { canView, permissionNeedText } from '@/lib/permissions';
import { addDays } from '@/lib/salesOrderStatus';
import { toSeoulDateString } from '@/lib/seoulDate';

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
export type SoonWidgetKey = 'AI_USAGE';
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
  /** 대응 후보 목록은 서버가 후보 업무의 조회 권한으로 걸러 준다. Agent 화면은 모든 사원이 연다 */
  AGENT_RISK: [],
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
/** 위젯을 다시 읽는 간격: 다른 사원이 바꾼 내용을 따라가도록 30초 (가정값, docs/rework/areas/dashboard.md) */
export const DASHBOARD_REFRESH_MS = 30_000;

const MRP_EARLIEST = '0001-01-01';

/** 위젯 권한: 서버 로그인 사원(/auth/me)의 역할 권한으로 본다. 서버에서 새로 만든 사원·바꾼 역할 권한도 그대로 맞는다 */
async function requireServerWidgetUser(key: DataWidgetKey): Promise<AuthUser> {
  const me = await serverRequest<AuthUser>('GET', '/auth/me');
  const view = DASHBOARD_WIDGET_VIEW[key];
  if (view.length > 0 && !canView(me, ...view)) throw new ApiError('COM-002', permissionNeedText(view, 'VIEW'));
  return me;
}

export interface DashboardQueryOptions {
  /** 기준일 YYYY-MM-DD (생략하면 오늘, 서울). 테스트에서 고정할 때 쓴다 */
  today?: string;
}

const todayOf = (options: DashboardQueryOptions = {}): string => options.today ?? toSeoulDateString(new Date());

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

/** 원료 잔량 대비 소요: 서버 MRP(GET mrp/requirements)를 같은 기간으로 읽는다 */
async function readRawMaterialBalanceFromServer(): Promise<RawMaterialBalanceData> {
  await requireServerWidgetUser('RAW_MATERIAL_BALANCE');
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

/** 구매요청·발주 목록 → 구매 진행 위젯. 조회 권한이 없는 쪽은 null */
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

/** 구매 진행: 권한은 로그인 사원(/auth/me)으로 보고, 목록은 서버에서 읽는다 */
async function readPurchaseProgressFromServer(): Promise<PurchaseProgressData> {
  const me = await requireServerWidgetUser('PURCHASE_PROGRESS');
  const [requisitions, purchaseOrders] = await Promise.all([
    canView(me, PERMISSION.PURCHASE_REQUISITION_CREATE) ? serverPurchaseRequisitionApi.list() : null,
    canView(me, PERMISSION.PURCHASE_ORDER_CONFIRM) ? serverPurchaseOrderApi.list() : null,
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

// ── 묶음 ────────────────────────────────────────────────

/** Agent 위험 감지 위젯 (REQ-AGT-005·006): 확정 대기 후보 수와 위험 유형별 건수, 최근 후보 */
export interface AgentRiskData {
  openCount: number;
  byRisk: { riskType: AgentRiskType; count: number }[];
  items: { id: number; riskType: AgentRiskType; summary: string; draftStatus: DraftStatus }[];
}

const AGENT_RISK_ITEM_LIMIT = 3;

/** 서버가 준 대응 후보(권한으로 걸러진 목록, 최근 것 먼저)를 위젯 모양으로 줄인다. 확정 전·확정했지만 실행 전 후보만 센다 */
export function agentRiskDataOf(candidates: readonly AgentCandidateView[]): AgentRiskData {
  const open = candidates.filter((c) => c.draftStatus === 'AI_GENERATED' || c.draftStatus === 'WAITING_APPROVAL' || c.draftStatus === 'APPROVED');
  const riskTypes = [...new Set(open.map((c) => c.riskType))];
  return {
    openCount: open.length,
    byRisk: riskTypes.map((riskType) => ({ riskType, count: open.filter((c) => c.riskType === riskType).length })),
    items: open.slice(0, AGENT_RISK_ITEM_LIMIT).map((c) => ({ id: c.id, riskType: c.riskType, summary: c.summary, draftStatus: c.draftStatus })),
  };
}

export interface DashboardWidgetDataMap {
  AGENT_RISK: AgentRiskData;
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

export const dashboardKeys = {
  all: ['dashboard'] as const,
  widget: (key: DataWidgetKey, employeeId: number) => ['dashboard', 'widgets', key, employeeId] as const,
};

/** 화면이 서버 API를 모아 묶는 위젯: 권한은 서버 로그인 사원으로 본다 */
function fromServer<T>(key: DataWidgetKey, read: () => Promise<T>): () => Promise<T> {
  return async () => {
    await requireServerWidgetUser(key);
    return read();
  };
}
const serverTrendWindow = () => trendWindow(todayOf(), DASHBOARD_TREND_DAYS);

/** 위젯마다 서버를 읽는 함수 (AI_USAGE는 P2라 데이터가 없다) */
const SERVER_READERS: { [K in DataWidgetKey]: () => Promise<DashboardWidgetDataMap[K]> } = {
  PROCESS_FLOW: serverDashboardApi.processFlow,
  ORDER_FULFILLMENT: serverDashboardApi.orderFulfillment,
  PRODUCT_STOCK: serverDashboardApi.productStock,
  AGENT_RISK: async () => agentRiskDataOf(await serverAgentCandidateApi.list()),
  RAW_MATERIAL_BALANCE: readRawMaterialBalanceFromServer,
  PURCHASE_PROGRESS: readPurchaseProgressFromServer,
  RECENT_EVENTS: () => serverBusinessEventApi.recentEvents(DASHBOARD_RECENT_EVENT_LIMIT),
  DELIVERY_RISK: fromServer('DELIVERY_RISK', serverDashboardSourceApi.deliveryRisk),
  REJECT_RATE: fromServer('REJECT_RATE', () => serverDashboardSourceApi.rejectRate(serverTrendWindow())),
  SHIPMENT_RESULT: serverDashboardApi.shipmentResult,
  PROCESS_YIELD: serverDashboardApi.processYield,
  SURPLUS_AGE: serverDashboardApi.surplusAge,
  PRODUCTION_VOLUME: fromServer('PRODUCTION_VOLUME', () => serverDashboardSourceApi.productionVolume(serverTrendWindow())),
};

export const dashboardApi = {
  /** 위젯 하나의 데이터 (권한이 없으면 COM-002) */
  widget: <K extends DataWidgetKey>(key: K): Promise<DashboardWidgetDataMap[K]> => SERVER_READERS[key](),
};
