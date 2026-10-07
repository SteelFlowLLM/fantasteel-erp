// 대시보드 위젯 ↔ 서버 API (server/src/modules/dashboard). 서버가 데이터를 주는 영업 위젯 3개를 바꾼다.
// 납기 위험·강종별 불합격률·생산량은 이미 있는 서버 API(수주 충족·검사·LOT·기준정보)를 읽어 화면에서 묶는다 (구매 위젯과 같은 방식).
// 구매 위젯 2개(원료 잔량 대비 소요·구매 진행)는 api/dashboard.ts가 구매·MRP 어댑터로 읽는다. 나머지(작업 로그·수율·불합격률 …)는 아직 가짜 DB를 읽는다.
import type { ItemView, LotSummary, OrderFulfillmentWidget, PageResult, ProcessFlowWidget, ProcessYieldWidget, ProductStockWidget, QualityInspectionListItem, ShipmentResultWidget, SteelGradeView } from '@fantasteel/shared';
import type { DeliveryRiskData, OrderFulfillmentData, ProcessFlowData, ProcessYieldData, ProductionVolumeData, ProductStockData, RejectRateData } from '@/api/dashboard';
import { serverRequest } from '@/api/http';
import { mockItemOf } from '@/api/server/masterIds';
import type { ProductItemType, SalesOrderItemStatus } from '@/codes';
import { bucketByDate, countRatio, isWithin, type TrendWindow } from '@/features/dashboard/lib/widgetMath';
import { toSeoulDateString } from '@/lib/seoulDate';
import { calcWeightTon, sumTon } from '@/lib/weight';

const productType = (itemType: string): ProductItemType => (itemType === 'COIL' ? 'COIL' : 'SLAB');

/** 공정 흐름 현황: 서버도 단계마다 권한을 보고 없으면 null을 준다 */
async function processFlow(): Promise<ProcessFlowData> {
  return serverRequest<ProcessFlowWidget>('GET', '/dashboard/widgets/process-flow');
}

/** 수주 충족 현황: 진행 중 수주, 가장 이른 납기 순. 납기 위험은 서버가 생산 설정값(기준일)으로 계산한다 */
async function orderFulfillment(): Promise<OrderFulfillmentData> {
  const w = await serverRequest<OrderFulfillmentWidget>('GET', '/dashboard/widgets/order-fulfillment');
  return {
    today: w.today,
    deliveryRiskDays: w.deliveryRiskDays,
    salesOrders: w.salesOrders.map((so) => ({
      salesOrderId: so.salesOrderId,
      salesOrderNo: so.salesOrderNo,
      customerName: so.customerName,
      earliestDueDate: so.earliestDueDate,
      isDueRisk: so.isDueRisk,
      items: so.items.map((i, index) => ({
        salesOrderItemId: i.salesOrderItemId,
        lineNo: index + 1,
        itemCode: i.itemCode,
        itemType: productType(i.itemType),
        orderedQty: i.orderedQty,
        orderedTon: i.orderedTon,
        inProductionQty: i.inProductionQty,
        passedQty: i.passedQty,
        reservedQty: i.activeReservedQty,
        unshippedQty: i.unshippedQty,
        shippedQty: i.shippedQty,
        shippedRatio: i.progress.ratio,
        dueDate: i.dueDate,
        daysToDue: i.daysToDue,
        isDueRisk: i.isDueRisk,
      })),
    })),
  };
}

/** 제품 재고: 서버 on_hand가 곧 합격 재고(적격·미소진·미출고)라 passedQty에 같은 값을 둔다 */
async function productStock(): Promise<ProductStockData> {
  const w = await serverRequest<ProductStockWidget>('GET', '/dashboard/widgets/product-stock');
  return {
    totals: w.totals.map((t) => ({
      itemType: productType(t.itemType),
      onHandQty: t.onHandQty,
      passedQty: t.onHandQty,
      reservedQty: t.reservedQty,
      availableQty: t.availableQty,
      onHandTon: t.onHandTon,
      availableTon: t.availableTon,
    })),
    items: w.items.map((r) => ({
      itemId: mockItemOf(r.itemCode)?.id ?? r.itemId,
      itemCode: r.itemCode,
      itemType: productType(r.itemType),
      steelGradeCode: r.steelGradeCode,
      onHandQty: r.onHandQty,
      passedQty: r.onHandQty,
      reservedQty: r.reservedQty,
      availableQty: r.availableQty,
      onHandTon: r.onHandTon,
      availableTon: r.availableTon,
    })),
  };
}

/** 출하 실적: 서버가 출고 확정 시각(서울 날짜)으로 최근 30일을 묶어 준다 */
const shipmentResult = () => serverRequest<ShipmentResultWidget>('GET', '/dashboard/widgets/shipment-result');

/** 공정별 수율: 서버가 작업 실적·계획 수율로 계산한다. 연주 계획 대비 매수는 서버에 손실 매수가 없어 비운다 */
async function processYield(): Promise<ProcessYieldData> {
  const w = await serverRequest<ProcessYieldWidget>('GET', '/dashboard/widgets/process-yield');
  return { processes: w.processes.map((p) => ({ ...p, qtyAttainmentRate: null })) };
}

export const serverDashboardApi = { processFlow, orderFulfillment, productStock, shipmentResult, processYield };

// ── 서버 API를 모아 화면에서 묶는 위젯 ──────────────────────

const PAGE_SIZE = 100;
const INSPECTED_PROCESSES = ['STEELMAKING', 'CONTINUOUS_CASTING', 'HOT_ROLLING'] as const;
/** 진행 중 수주 품목 (진행중·부분출하) */
const OPEN_ITEM_STATUSES: ReadonlySet<SalesOrderItemStatus> = new Set<SalesOrderItemStatus>(['OPEN', 'PARTIALLY_SHIPPED']);

/** 최신순 목록을 기간 시작일 전까지만 읽는다 (서버 목록에 날짜 거르기가 없다) */
async function pagesUntil<T>(path: string, query: Record<string, string>, dateOf: (row: T) => string | null, from: string): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; ; page++) {
    const result = await serverRequest<PageResult<T>>('GET', path, { query: { ...query, page, size: PAGE_SIZE } });
    rows.push(...result.items);
    const last = result.items.at(-1);
    const lastDate = last ? dateOf(last) : null;
    if (rows.length >= result.total || result.items.length === 0 || (lastDate !== null && lastDate < from)) break;
  }
  return rows;
}

/** 납기 위험 수주: 수주 충족 위젯 API의 진행 중 품목 중 isDueRisk (REQ-AGT-004, TRM-107 — 서버가 계산) */
async function deliveryRisk(): Promise<DeliveryRiskData> {
  const w = await serverRequest<OrderFulfillmentWidget>('GET', '/dashboard/widgets/order-fulfillment');
  const open = w.salesOrders.flatMap((so) => so.items.map((item, index) => ({ so, item, lineNo: index + 1 }))).filter(({ item }) => OPEN_ITEM_STATUSES.has(item.salesOrderItemStatus));
  const items = open
    .filter(({ item }) => item.isDueRisk)
    .map(({ so, item, lineNo }) => ({
      salesOrderId: so.salesOrderId,
      salesOrderNo: so.salesOrderNo,
      customerName: so.customerName,
      salesOrderItemId: item.salesOrderItemId,
      lineNo,
      itemCode: item.itemCode,
      itemType: productType(item.itemType),
      orderedQty: item.orderedQty,
      shippedQty: item.shippedQty,
      unshippedQty: item.unshippedQty,
      unshippedTon: calcWeightTon(item.unshippedQty, item.theoreticalWeightTon),
      dueDate: item.dueDate,
      daysToDue: item.daysToDue,
      isOverdue: item.daysToDue < 0,
    }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.salesOrderNo.localeCompare(b.salesOrderNo) || a.lineNo - b.lineNo);
  return { today: w.today, deliveryRiskDays: w.deliveryRiskDays, openItemCount: open.length, items };
}

/** 강종별 불합격률: 판정 시각이 기간 안인 PASS·FAIL 검사 중 FAIL (가정값, docs/rework/areas/dashboard.md 5장) */
async function rejectRate(window: TrendWindow): Promise<RejectRateData> {
  const seoulDate = (iso: string | null) => (iso === null ? null : toSeoulDateString(new Date(iso)));
  const [grades, done] = await Promise.all([
    serverRequest<SteelGradeView[]>('GET', '/steel-grades'),
    pagesUntil<QualityInspectionListItem>('/quality-inspections', { status: 'done' }, (r) => seoulDate(r.inspectedAt), window.from),
  ]);
  const judged = done.filter((r) => (r.inspectionResult === 'PASS' || r.inspectionResult === 'FAIL') && isWithin(seoulDate(r.inspectedAt) ?? '', window));
  const cell = (rows: typeof judged) => {
    const failedCount = rows.filter((r) => r.inspectionResult === 'FAIL').length;
    return { inspectedCount: rows.length, failedCount, rejectRate: countRatio(failedCount, rows.length) };
  };
  return {
    from: window.from,
    to: window.to,
    days: window.dates.length,
    grades: [...grades]
      .sort((a, b) => a.id - b.id)
      .map((grade) => {
        const ofGrade = judged.filter((r) => r.steelGradeCode === grade.steelGradeCode);
        return {
          steelGradeId: grade.id,
          steelGradeCode: grade.steelGradeCode,
          ...cell(ofGrade),
          byProcess: INSPECTED_PROCESSES.map((processType) => ({ processType, ...cell(ofGrade.filter((r) => r.processType === processType)) })),
        };
      }),
  };
}

/** 생산량: 기간 안에 만든 슬래브·코일 LOT(생산완료일) 하루 단위. 톤 = 매수 × 1매 이론중량 */
async function productionVolume(window: TrendWindow): Promise<ProductionVolumeData> {
  const [items, slabs, coils] = await Promise.all([
    serverRequest<ItemView[]>('GET', '/items'),
    pagesUntil<LotSummary>('/lots', { lotType: 'SLAB' }, (l) => l.producedDate, window.from),
    pagesUntil<LotSummary>('/lots', { lotType: 'COIL' }, (l) => l.producedDate, window.from),
  ]);
  const weightOf = new Map(items.map((i) => [i.id, i.theoreticalWeightTon ?? '0']));
  const lots = [...slabs, ...coils].filter((l) => l.producedDate !== null && isWithin(l.producedDate, window));
  const series = [...bucketByDate(lots, (l) => l.producedDate ?? '', window)].map(([date, rows]) => ({
    date,
    slabQty: rows.filter((l) => l.lotType === 'SLAB').length,
    coilQty: rows.filter((l) => l.lotType === 'COIL').length,
    ton: sumTon(rows.map((l) => (l.itemId === null ? '0' : (weightOf.get(l.itemId) ?? '0')))),
  }));
  return {
    from: window.from,
    to: window.to,
    days: window.dates.length,
    totalSlabQty: series.reduce((s, p) => s + p.slabQty, 0),
    totalCoilQty: series.reduce((s, p) => s + p.coilQty, 0),
    totalTon: sumTon(series.map((p) => p.ton)),
    series,
  };
}

export const serverDashboardSourceApi = { deliveryRisk, rejectRate, productionVolume };
