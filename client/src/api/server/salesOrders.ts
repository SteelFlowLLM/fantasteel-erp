// 수주 화면 ↔ 서버 API (server/src/modules/sales-order). 서버 응답을 화면이 쓰는 모양(가짜 DB와 같은 타입)으로 바꾼다.
// 고객사·규격 id는 서버 id 그대로다 (수주 등록의 선택 목록도 서버, api/server/lookups.ts).
// 생산 연결 탭은 수주 상세의 계획 id로 생산계획 상세를 읽는다. 서버에 아직 없는 것(취소 창의 구매 진행 영향)은 빈 값이다.
// 재생산 계획은 생산계획 어댑터, 이력 타임라인은 작업 로그 어댑터, 업무방은 메신저 어댑터가 맡는다.
import type {
  CancelSalesOrderResult,
  CreateSalesOrderResult,
  ItemView as ServerItemView,
  MillSheetSummary,
  PageResult,
  ProductionSettingView,
  ProductStockWidget,
  RoutingView,
  SalesOrderDetail as ServerSalesOrderDetail,
  SalesOrderItemFulfillment,
  SalesOrderReservationView,
  SalesOrderSummary as ServerSalesOrderSummary,
  SpecificConsumptionView,
  SpecMappingView,
} from '@fantasteel/shared';
import { ApiError } from '@/api/errors';
import { serverRequest } from '@/api/http';
import { serverProductionPlanApi } from '@/api/server/production';
import type {
  CreateSalesOrderInput,
  CreateSalesOrderResultView,
  ItemFulfillment,
  SalesOrderDetail,
  SalesOrderListRow,
  SalesOrderPlanLink,
  SalesOrderPreviewInputLine,
  SalesOrderPreviewLine,
} from '@/api/salesOrders';
import { ITEM_TYPE_LABEL, PROCESS_TYPE_LABEL, type ProcessType, type ProductItemType } from '@/codes';
import { planHeats, type HeatPlan } from '@/lib/heatPlanning';
import { stockFirstSplit, progressOf } from '@/lib/inventoryMath';
import { calcHotRollingYieldRate, calcWeightTon } from '@/lib/weight';
import { requirePositiveQty } from '@/mock/services';

/** 목록은 화면이 한 번에 다 보여 주고 거르므로 서버 최대 페이지 크기로 읽는다 (수주가 100건을 넘으면 페이지를 더 읽는다) */
const PAGE_SIZE = 100;

const productType = (itemType: string): ProductItemType => (itemType === 'COIL' ? 'COIL' : 'SLAB');

function toItemFulfillment(i: SalesOrderItemFulfillment, lineNo: number, plans: ServerSalesOrderDetail['productionPlans']): ItemFulfillment {
  return {
    salesOrderItemId: i.salesOrderItemId,
    lineNo,
    itemId: i.itemId,
    itemCode: i.itemCode,
    itemName: i.itemName,
    itemType: productType(i.itemType),
    theoreticalWeightTon: i.theoreticalWeightTon,
    orderedQty: i.orderedQty,
    orderedTon: i.orderedTon,
    dueDate: i.dueDate,
    salesOrderItemStatus: i.salesOrderItemStatus,
    isDueRisk: i.isDueRisk,
    shippedQty: i.shippedQty,
    activeReservedQty: i.activeReservedQty,
    securedQty: i.passedQty,
    inProductionQty: i.inProductionQty,
    plannedQty: i.plannedQty,
    shortage: {
      unshippedQty: i.unshippedQty,
      unsecuredQty: i.unsecuredQty,
      additionalPlanQty: i.additionalPlanQty,
      activeReservedQty: i.activeReservedQty,
      openPlanRemainingQty: i.openPlanRemainingQty,
      reservationAvailableQty: i.reservationAvailableQty,
      reproductionNeedQty: i.reproductionNeedQty,
    },
    measures: {
      reserved: progressOf(i.activeReservedQty, i.unshippedQty),
      inProduction: progressOf(i.inProductionQty, i.orderedQty),
      passed: progressOf(i.passedQty, i.orderedQty),
      shipped: i.progress,
    },
    plans: plans
      .filter((p) => p.salesOrderItemId === i.salesOrderItemId)
      .map((p) => ({
        productionPlanId: p.id,
        productionPlanNo: p.productionPlanNo,
        productionPlanStatus: p.productionPlanStatus,
        isReproduction: p.isReproduction,
        shortageQty: p.shortageQty,
        heatCount: p.heatCount,
        remainingTargetQty: p.remainingTargetQty,
      })),
  };
}

/** 목록 한 줄. 취소 시각·사유는 목록 응답에 없어 상세에서만 채운다 (취소된 수주는 마지막 수정 시각이 취소 시각이다) */
function toListRow(s: ServerSalesOrderSummary): SalesOrderListRow {
  return {
    id: s.id,
    salesOrderNo: s.salesOrderNo,
    customerId: s.customerId,
    customerName: s.customerName,
    ownerEmployeeId: s.ownerEmployeeId,
    ownerName: s.ownerEmployeeName,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    cancelledAt: s.salesOrderStatus === 'CANCELLED' ? s.updatedAt : null,
    cancelReason: null,
    status: s.salesOrderStatus,
    itemCount: s.itemCount,
    itemTypes: [...new Set(s.items.map((i) => productType(i.itemType)))],
    totalOrderedQty: s.totalOrderedQty,
    totalOrderedTon: s.totalOrderedTon,
    totalShippedQty: s.totalShippedQty,
    totalActiveReservedQty: s.totalActiveReservedQty,
    earliestDueDate: s.earliestDueDate,
    isDueRisk: s.isDueRisk,
    hasReproductionNeed: s.hasReproductionNeed,
    workRoomId: null,
    itemLines: s.items.map((i, index) => ({ lineNo: index + 1, itemType: productType(i.itemType), itemName: i.itemName, orderedQty: i.orderedQty })),
  };
}

async function listAll(): Promise<SalesOrderListRow[]> {
  const rows: ServerSalesOrderSummary[] = [];
  for (let page = 1; ; page++) {
    const result = await serverRequest<PageResult<ServerSalesOrderSummary>>('GET', '/sales-orders', { query: { page, size: PAGE_SIZE } });
    rows.push(...result.items);
    if (rows.length >= result.total || result.items.length === 0) break;
  }
  return rows.map(toListRow);
}

/** 밀시트 목록 (출고 확정 뒤에 생긴다). 밀시트 조회 권한이 없으면 빈 목록 */
async function millSheetsOf(salesOrderId: number): Promise<SalesOrderDetail['millSheets']> {
  try {
    const page = await serverRequest<PageResult<MillSheetSummary>>('GET', '/mill-sheets', { query: { salesOrderId, page: 1, size: 100 } });
    return page.items.map((m) => ({ id: m.id, millSheetNo: m.millSheetNo, shipmentRequestId: m.shipmentRequestId, issuedAt: m.issuedAt, pdfPath: m.pdfPath }));
  } catch (e) {
    if (e instanceof ApiError && e.code === 'COM-002') return [];
    throw e;
  }
}

async function detail(salesOrderId: number): Promise<SalesOrderDetail> {
  const [d, reservations, millSheets] = await Promise.all([
    serverRequest<ServerSalesOrderDetail>('GET', `/sales-orders/${salesOrderId}`),
    serverRequest<SalesOrderReservationView[]>('GET', `/sales-orders/${salesOrderId}/reservations`),
    millSheetsOf(salesOrderId),
  ]);
  const lineNoOf = (salesOrderItemId: number) => d.items.findIndex((i) => i.salesOrderItemId === salesOrderItemId) + 1;
  const { itemLines: _lines, ...listRow } = toListRow(d);
  const items = d.items.map((i, index) => toItemFulfillment(i, index + 1, d.productionPlans));
  return {
    ...listRow,
    cancelledAt: d.cancellation?.cancelledAt ?? listRow.cancelledAt,
    cancelReason: d.cancellation?.reason ?? null,
    items,
    reservations: reservations.map((r) => ({
      id: r.id,
      salesOrderItemId: r.salesOrderItemId,
      lineNo: lineNoOf(r.salesOrderItemId),
      itemCode: r.itemCode,
      reservedQty: r.reservedQty,
      reservationStatus: r.reservationStatus,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    shipmentRequests: d.shipmentRequests.map((r) => ({
      id: r.id,
      shipmentRequestNo: r.shipmentRequestNo,
      shipmentRequestStatus: r.shipmentRequestStatus,
      requestedShipDate: r.shipDate ?? '',
      issuedAt: r.issuedAt,
      lines: r.items.map((l) => ({ salesOrderItemId: l.salesOrderItemId, lineNo: lineNoOf(l.salesOrderItemId), requestQty: l.requestQty, allocatedQty: l.allocatedQty })),
    })),
    millSheets,
    cancelBlock: d.cancelBlock,
    cancellation: d.cancellation
      ? {
          releasedReserved: d.cancellation.releasedReservations.map((r) => ({
            lineNo: lineNoOf(r.salesOrderItemId),
            itemType: items.find((i) => i.salesOrderItemId === r.salesOrderItemId)?.itemType ?? 'SLAB',
            qty: r.releasedQty,
          })),
          cancelledPlanNos: d.cancellation.cancelledPlanNos,
          unlinkedPlanNos: d.cancellation.unlinkedPlanNos,
        }
      : null,
  };
}

/** 미리보기에 쓰는 서버 기준정보 (규격·라우팅·규격 매핑·배합 원단위·생산 설정값) */
interface PreviewMaster {
  items: ServerItemView[];
  routings: RoutingView[];
  mappings: SpecMappingView[];
  consumptions: SpecificConsumptionView[];
  setting: ProductionSettingView;
}

type ProductItem = ServerItemView & { itemType: ProductItemType; theoreticalWeightTon: string };
const isProductItem = (item: ServerItemView | undefined): item is ProductItem =>
  item !== undefined && (item.itemType === 'SLAB' || item.itemType === 'COIL') && item.theoreticalWeightTon !== null;

/** 라우팅 계획 수율. 없으면 MST-001 (가짜 DB core routingYieldOf와 같은 문구) */
function routingYield(master: PreviewMaster, itemType: ProductItemType, processType: ProcessType): string {
  const rate = master.routings.find((r) => r.itemType === itemType && r.processType === processType)?.plannedYieldRate;
  if (!rate) throw new ApiError('MST-001', `라우팅 계획 수율(${ITEM_TYPE_LABEL[itemType]} ${PROCESS_TYPE_LABEL[processType]})`);
  return rate;
}

/** 배합 원단위 확인: 철광석·석탄·석회석(공통)과 강종의 합금철이 있어야 한다 (core assertConsumptionsReady와 같은 규칙) */
function assertConsumptionsReady(master: PreviewMaster, item: ProductItem): void {
  for (const material of master.items.filter((i) => i.itemType === 'RAW_MATERIAL' && i.rawMaterialType !== 'FERROALLOY')) {
    if (!master.consumptions.some((c) => c.rawMaterialItemId === material.id && c.steelGradeId === null)) throw new ApiError('MST-001', `배합 원단위(${material.itemName})`);
  }
  if (!master.consumptions.some((c) => c.steelGradeId === item.steelGradeId && c.rawMaterialType === 'FERROALLOY')) {
    throw new ApiError('MST-001', `합금철 원단위(${item.steelGradeCode ?? '강종'})`);
  }
}

/** 부족분 히트 편성 (업무 프로세스 4.4): 서버 기준정보로 화면 공통 계산(planHeats)을 부른다 */
function formationOf(master: PreviewMaster, item: ProductItem, shortageQty: number): HeatPlan {
  routingYield(master, item.itemType, 'STEELMAKING');
  const castingYieldRate = routingYield(master, item.itemType, 'CONTINUOUS_CASTING');
  let slabWeightTon = item.theoreticalWeightTon;
  let hotRollingYieldRate: string | null = null;
  if (item.itemType === 'COIL') {
    const slab = master.mappings.find((m) => m.coilItem.id === item.id)?.slabItem;
    if (!slab) throw new ApiError('MST-001', `규격 매핑(${item.itemCode})`);
    slabWeightTon = slab.theoreticalWeightTon;
    hotRollingYieldRate = calcHotRollingYieldRate(item.theoreticalWeightTon, slab.theoreticalWeightTon);
  }
  assertConsumptionsReady(master, item);
  return planHeats({
    productType: item.itemType,
    shortageQty,
    theoreticalWeightTon: item.theoreticalWeightTon,
    castingYieldRate,
    hotRollingYieldRate,
    heatCapacityTon: master.setting.heatCapacityTon,
    slabTheoreticalWeightTon: slabWeightTon,
  });
}

/**
 * 등록 미리보기 (저장 안 함). 업무 프로세스대로 화면에서 계산하되, 규격·라우팅·규격 매핑·배합 원단위·히트 용량은 서버 기준정보,
 * 예약 가용은 서버 재고(제품 재고 위젯)를 쓴다. 실제 예약·계획은 저장할 때 서버가 다시 계산한다.
 */
async function preview(lines: readonly SalesOrderPreviewInputLine[]): Promise<SalesOrderPreviewLine[]> {
  const [items, routings, mappings, consumptions, setting, stock] = await Promise.all([
    serverRequest<ServerItemView[]>('GET', '/items'),
    serverRequest<RoutingView[]>('GET', '/routings'),
    serverRequest<SpecMappingView[]>('GET', '/spec-mappings'),
    serverRequest<SpecificConsumptionView[]>('GET', '/specific-consumptions'),
    serverRequest<ProductionSettingView>('GET', '/production-settings'),
    serverRequest<ProductStockWidget>('GET', '/dashboard/widgets/product-stock'),
  ]);
  const master: PreviewMaster = { items, routings, mappings, consumptions, setting };
  const checked = lines.map((line, index) => {
    const item = items.find((i) => i.id === line.itemId);
    if (!isProductItem(item)) throw new ApiError('SO-001', `${index + 1}번째 품목`);
    return { item, orderedQty: requirePositiveQty(line.orderedQty, `${index + 1}번째 품목`) };
  });
  const used = new Map<number, number>();
  return checked.map(({ item, orderedQty }) => {
    const serverAvailable = stock.items.find((r) => r.itemId === item.id)?.availableQty ?? 0;
    const availableQty = Math.max(0, serverAvailable - (used.get(item.id) ?? 0));
    const { reserveQty, shortageQty } = stockFirstSplit(orderedQty, availableQty);
    used.set(item.id, (used.get(item.id) ?? 0) + reserveQty);
    return {
      itemId: item.id,
      itemCode: item.itemCode,
      itemName: item.itemName,
      itemType: item.itemType,
      orderedQty,
      theoreticalWeightTon: item.theoreticalWeightTon,
      weightTon: calcWeightTon(orderedQty, item.theoreticalWeightTon),
      availableQty,
      reserveQty,
      shortageQty,
      formation: shortageQty > 0 ? formationOf(master, item, shortageQty) : null,
    };
  });
}

/**
 * 저장 버튼 중복 방지 키: 같은 입력을 짧은 시간에 다시 보내면(두 번 누름) 같은 키를 써서 서버가 수주를 한 건만 만든다.
 * 성공하면 키를 지워, 같은 내용을 일부러 다시 등록할 때는 새 수주가 된다.
 */
const IDEMPOTENCY_WINDOW_MS = 10_000;
const pendingKeys = new Map<string, { key: string; at: number }>();

function idempotencyKeyOf(body: string): string {
  const now = Date.now();
  for (const [b, v] of pendingKeys) if (now - v.at > IDEMPOTENCY_WINDOW_MS) pendingKeys.delete(b);
  const found = pendingKeys.get(body);
  if (found) return found.key;
  const key = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${now}-${Math.random().toString(36).slice(2)}`;
  pendingKeys.set(body, { key, at: now });
  return key;
}

/** 매수: 숫자만 쓴 글자는 숫자로 보내고, 그 밖(10.5·빈칸 등)은 그대로 보내 서버가 SO-002로 거부하게 한다 */
const qtyForServer = (qty: number | string): unknown => (typeof qty === 'string' && /^\d+$/.test(qty.trim()) ? Number(qty.trim()) : qty);

async function create(input: CreateSalesOrderInput): Promise<CreateSalesOrderResultView> {
  if (input.items.length === 0) throw new ApiError('SO-001', '품목을 하나 이상 넣어 주세요');
  const body = {
    customerId: input.customerId,
    items: input.items.map((line) => ({ itemId: line.itemId, orderedQty: qtyForServer(line.orderedQty), dueDate: line.dueDate })),
  };
  const bodyText = JSON.stringify(body);
  const result = await serverRequest<CreateSalesOrderResult>('POST', '/sales-orders', { body, headers: { 'Idempotency-Key': idempotencyKeyOf(bodyText) } });
  pendingKeys.delete(bodyText);
  return {
    salesOrderId: result.salesOrderId,
    salesOrderNo: result.salesOrderNo,
    reservedQty: result.totalReservedQty,
    shortageQty: result.totalShortageQty,
    productionPlanNos: result.items.flatMap((i) => (i.productionPlanNo ? [i.productionPlanNo] : [])),
  };
}

async function cancel(input: { salesOrderId: number; cancelReason: string }): Promise<{ salesOrderId: number; salesOrderNo: string }> {
  const result = await serverRequest<CancelSalesOrderResult>('POST', `/sales-orders/${input.salesOrderId}/cancel`, { body: { reason: input.cancelReason } });
  return { salesOrderId: result.salesOrderId, salesOrderNo: result.salesOrderNo };
}

/**
 * 생산 연결 탭: 수주 품목에 연결된 계획과, 수주 취소로 연결이 풀린 진행 계획(취소 기록의 계획 번호)의 생산계획 상세.
 * 생산계획 조회 권한이 없으면(물류) 빈 목록이다.
 */
async function productionLinks(salesOrderId: number): Promise<SalesOrderPlanLink[]> {
  const d = await serverRequest<ServerSalesOrderDetail>('GET', `/sales-orders/${salesOrderId}`);
  const lineNoOf = (salesOrderItemId: number) => d.items.findIndex((i) => i.salesOrderItemId === salesOrderItemId) + 1;
  const lineNoByPlan = new Map<number, number | null>(d.productionPlans.map((p) => [p.id, lineNoOf(p.salesOrderItemId)]));
  try {
    const unlinkedNos = new Set(d.cancellation?.unlinkedPlanNos ?? []);
    if (unlinkedNos.size > 0) for (const p of await serverProductionPlanApi.list()) if (unlinkedNos.has(p.productionPlanNo) && !lineNoByPlan.has(p.id)) lineNoByPlan.set(p.id, null);
    const planIds = [...lineNoByPlan.keys()].sort((a, b) => a - b);
    return await Promise.all(
      planIds.map(async (id) => {
        const { results: _results, salesOrderItemStatus: _status, salesOrderOwnerName: _owner, lots: _lots, reproduction: _reproduction, ...plan } = await serverProductionPlanApi.detail(id);
        return { lineNo: lineNoByPlan.get(id) ?? null, plan };
      }),
    );
  } catch (e) {
    if (e instanceof ApiError && e.code === 'COM-002') return [];
    throw e;
  }
}

export const serverSalesOrderApi = { listAll, detail, productionLinks, preview, create, cancel };
