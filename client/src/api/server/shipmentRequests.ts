// 출하요청·출하 배정 화면 ↔ 서버 API (server/src/modules/shipment, inventory의 allocations).
// 화면은 줄마다 수주 품목 정보(줄 번호·수주 매수·납기)와 LOT 정보(히트·야드)를 같이 보여 주므로,
// 출하요청 상세 + 수주 상세 + 배정 후보(작업 로그 없는 조회)를 합쳐 화면 모양을 만든다.
// 고객사·규격·야드 id는 서버 id 그대로다. 응답에 없는 규격 표시값(유형·이론중량·강종·기본 야드)은 규격 코드로 찾는다(api/server/masterIds.ts).
import type {
  AllocationRecommendation,
  AllocationView,
  CustomerView,
  MillSheetSummary,
  PageResult,
  SalesOrderDetail as ServerSalesOrderDetail,
  ShipmentAllocationCandidates,
  ShipmentRequestDetail as ServerShipmentRequestDetail,
  ShipmentRequestSummary as ServerShipmentRequestSummary,
  ShippableSalesOrderItem,
} from '@fantasteel/shared';
import { ApiError } from '@/api/errors';
import { serverRequest } from '@/api/http';
import { itemInfoReader, type ItemInfo } from '@/api/server/masterIds';
import type {
  CreateShipmentRequestForm,
  ShipmentLineDetail,
  ShipmentListRow,
  ShipmentLotOption,
  ShipmentRequestDetailView,
  ShippableCustomer,
  ShippableItem,
} from '@/api/shipmentRequests';
import type { ProductItemType, SalesOrderItemStatus } from '@/codes';
import { calcWeightTon, sumTon } from '@/lib/weight';

const PAGE_SIZE = 100;
const productType = (itemType: string): ProductItemType => (itemType === 'COIL' ? 'COIL' : 'SLAB');
/** 규격 코드 → 표시값 (한 번의 조회 안에서 만든다) */
type InfoOf = (itemCode: string) => ItemInfo | undefined;
const weightOf = (info: InfoOf, itemCode: string) => info(itemCode)?.theoreticalWeightTon ?? '0.000';

/** 권한이 없어서 못 읽는 보조 정보(밀시트·배정 후보)는 빈 값으로 둔다 */
async function orEmpty<T>(read: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await read();
  } catch (e) {
    if (e instanceof ApiError && e.code === 'COM-002') return empty;
    throw e;
  }
}

/** 수주 품목 정보: 수주 안의 줄 번호·수주 매수·출하 매수·납기·상태 (수주 상세에서 읽는다) */
interface SalesOrderLine {
  lineNo: number;
  orderedQty: number;
  shippedQty: number;
  dueDate: string;
  salesOrderItemStatus: SalesOrderItemStatus;
}

async function salesOrderLines(salesOrderIds: readonly number[]): Promise<Map<number, SalesOrderLine>> {
  const details = await Promise.all([...new Set(salesOrderIds)].map((id) => serverRequest<ServerSalesOrderDetail>('GET', `/sales-orders/${id}`)));
  const lines = new Map<number, SalesOrderLine>();
  for (const d of details) {
    d.items.forEach((i, index) =>
      lines.set(i.salesOrderItemId, { lineNo: index + 1, orderedQty: i.orderedQty, shippedQty: i.shippedQty, dueDate: i.dueDate, salesOrderItemStatus: i.salesOrderItemStatus }),
    );
  }
  return lines;
}

async function allPages<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; ; page++) {
    const result = await serverRequest<PageResult<T>>('GET', path, { query: { ...query, page, size: PAGE_SIZE } });
    rows.push(...result.items);
    if (rows.length >= result.total || result.items.length === 0) return rows;
  }
}

const millSheetsOfAll = () => orEmpty(() => allPages<MillSheetSummary>('/mill-sheets'), []);

function summaryOf(s: ServerShipmentRequestSummary, d: ServerShipmentRequestDetail, info: InfoOf) {
  const allocatedQty = (i: ServerShipmentRequestDetail['items'][number]) => i.allocations.length;
  return {
    id: s.id,
    shipmentRequestNo: s.shipmentRequestNo,
    customerId: s.customerId,
    customerName: s.customerName,
    requestedShipDate: s.shipDate ?? '',
    shipmentRequestStatus: s.shipmentRequestStatus,
    // 요청자 컬럼이 ERD에 없다 (작업 로그에만 남는다)
    requesterName: null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    issuedAt: s.issuedAt,
    issuedEmployeeName: d.issuedEmployeeName,
    cancelledAt: s.shipmentRequestStatus === 'CANCELLED' ? s.updatedAt : null,
    salesOrderNos: [...new Set(d.items.map((i) => i.salesOrderNo))],
    totalRequestQty: s.totalRequestQty,
    totalAllocatedQty: d.items.reduce((sum, i) => sum + allocatedQty(i), 0),
    waitingAllocationQty: s.shipmentRequestStatus === 'CANCELLED' ? 0 : d.items.reduce((sum, i) => sum + Math.max(0, i.requestQty - allocatedQty(i)), 0),
    totalWeightTon: sumTon(d.items.map((i) => calcWeightTon(i.requestQty, weightOf(info, i.itemCode)))),
  };
}

async function list(): Promise<ShipmentListRow[]> {
  const [summaries, millSheets, info] = await Promise.all([allPages<ServerShipmentRequestSummary>('/shipment-requests'), millSheetsOfAll(), itemInfoReader()]);
  const details = await Promise.all(summaries.map((s) => serverRequest<ServerShipmentRequestDetail>('GET', `/shipment-requests/${s.id}`)));
  return summaries.map((s, index) => {
    const d = details[index];
    return {
      ...summaryOf(s, d, info),
      itemCodes: [...new Set(d.items.map((i) => i.itemCode))],
      itemTypes: [...new Set(d.items.map((i) => productType(info(i.itemCode)?.itemType ?? 'SLAB')))],
      salesOrderIds: [...new Set(d.items.map((i) => i.salesOrderId))],
      salesOrders: [...new Map(d.items.map((i) => [i.salesOrderId, i.salesOrderNo])).entries()].map(([salesOrderId, salesOrderNo]) => ({ salesOrderId, salesOrderNo })),
      millSheets: millSheets.filter((m) => m.shipmentRequestId === s.id).map((m) => ({ id: m.id, millSheetNo: m.millSheetNo })),
    };
  });
}

/** LOT은 규격의 기본 야드에 생긴다 (REQ-MST-008) */
function lotOption(lot: { lotId: number; lotNo: string; producedDate: string | null; heatNo: string | null }, item: ItemInfo | undefined): ShipmentLotOption {
  return { lotId: lot.lotId, lotNo: lot.lotNo, producedDate: lot.producedDate ?? '', heatNo: lot.heatNo, yardId: item?.yardId ?? null, yardName: item?.yardName ?? null };
}

async function detail(id: number): Promise<ShipmentRequestDetailView> {
  const d = await serverRequest<ServerShipmentRequestDetail>('GET', `/shipment-requests/${id}`);
  const editable = d.shipmentRequestStatus === 'REQUESTED' || d.shipmentRequestStatus === 'ALLOCATED';
  const [lines, allocations, candidates, millSheets, info] = await Promise.all([
    salesOrderLines(d.items.map((i) => i.salesOrderId)),
    orEmpty(() => serverRequest<AllocationView[]>('GET', '/allocations', { query: { allocationPurpose: 'SHIPMENT', shipmentRequestId: id } }), []),
    editable ? orEmpty(() => serverRequest<ShipmentAllocationCandidates[]>('GET', '/allocations/recommendations', { query: { allocationPurpose: 'SHIPMENT', shipmentRequestId: id } }), []) : Promise.resolve([]),
    orEmpty(() => allPages<MillSheetSummary>('/mill-sheets', { shipmentRequestId: id }), []),
    itemInfoReader(),
  ]);
  const allocationById = new Map(allocations.map((a) => [a.id, a]));
  return {
    ...summaryOf(d, d, info),
    editable,
    millSheets: millSheets.map((m) => ({ id: m.id, millSheetNo: m.millSheetNo, salesOrderId: m.salesOrderId, issuedAt: m.issuedAt, pdfPath: m.pdfPath })),
    lines: d.items.map((i, index): ShipmentLineDetail => {
      const soLine = lines.get(i.salesOrderItemId);
      const item = info(i.itemCode);
      const theoreticalWeightTon = weightOf(info, i.itemCode);
      const rec = candidates.find((c) => c.shipmentRequestItemId === i.id);
      return {
        shipmentRequestItemId: i.id,
        lineNo: index + 1,
        salesOrderId: i.salesOrderId,
        salesOrderNo: i.salesOrderNo,
        salesOrderItemId: i.salesOrderItemId,
        salesOrderLineNo: soLine?.lineNo ?? 0,
        itemId: i.itemId,
        itemCode: i.itemCode,
        itemName: i.itemName,
        itemType: productType(item?.itemType ?? 'SLAB'),
        theoreticalWeightTon,
        requestQty: i.requestQty,
        requestTon: calcWeightTon(i.requestQty, theoreticalWeightTon),
        allocatedQty: i.allocations.length,
        waitingAllocationQty: Math.max(0, i.requestQty - i.allocations.length),
        steelGradeCode: item?.steelGradeCode ?? null,
        orderedQty: soLine?.orderedQty ?? 0,
        shippedQty: soLine?.shippedQty ?? 0,
        dueDate: soLine?.dueDate ?? '',
        salesOrderItemStatus: soLine?.salesOrderItemStatus ?? 'OPEN',
        allocations: i.allocations.map((a) => {
          const full = allocationById.get(a.allocationId);
          return {
            lotId: a.lotId,
            lotNo: a.lotNo,
            producedDate: full?.producedDate ?? '',
            heatNo: full?.heatNo ?? null,
            yardId: item?.yardId ?? null,
            yardName: item?.yardName ?? null,
            allocationId: a.allocationId,
            allocationStatus: a.allocationStatus,
            confirmedAt: full?.createdAt ?? '',
            // 배정 확정자 컬럼이 ERD에 없다 (작업 로그에만 남는다)
            confirmedEmployeeName: null,
          };
        }),
        recommendedLots: (rec?.candidates ?? []).filter((c) => c.isRecommended).map((c) => lotOption(c, item)),
        candidateLots: (rec?.candidates ?? []).map((c) => lotOption(c, item)),
      };
    }),
  };
}

/** 출하 가능 품목 전체 */
const shippableAll = () => serverRequest<ShippableSalesOrderItem[]>('GET', '/shipment-requests/shippable');

/**
 * 출하요청 등록 창의 고객사: 서버 고객사 목록(기준정보 조회 권한) 전부, 코드 순.
 * 권한이 없으면 출하 가능 품목이 있는 고객사만 이름 순으로 보인다(고객사 코드는 비운다).
 */
async function shippableCustomers(): Promise<ShippableCustomer[]> {
  const [items, customers] = await Promise.all([shippableAll(), orEmpty(() => serverRequest<CustomerView[]>('GET', '/customers'), [])]);
  const fromItems = [...new Map(items.map((i) => [i.customerId, i.customerName])).entries()]
    .filter(([id]) => !customers.some((c) => c.id === id))
    .map(([id, customerName]) => ({ id, customerCode: '', customerName }))
    .sort((a, b) => a.customerName.localeCompare(b.customerName));
  return [...[...customers].sort((a, b) => a.customerCode.localeCompare(b.customerCode)), ...fromItems].map((c) => {
    const mine = items.filter((i) => i.customerId === c.id);
    return { customerId: c.id, customerCode: c.customerCode, customerName: c.customerName, itemCount: mine.length, salesOrderIds: [...new Set(mine.map((i) => i.salesOrderId))] };
  });
}

async function shippableItems(customerId: number): Promise<(ShippableItem & { steelGradeCode: string | null })[]> {
  const [all, info] = await Promise.all([shippableAll(), itemInfoReader()]);
  const items = all.filter((i) => i.customerId === customerId);
  const lines = await salesOrderLines(items.map((i) => i.salesOrderId));
  return items.map((i) => ({
    salesOrderItemId: i.salesOrderItemId,
    salesOrderId: i.salesOrderId,
    salesOrderNo: i.salesOrderNo,
    lineNo: lines.get(i.salesOrderItemId)?.lineNo ?? 0,
    itemId: i.itemId,
    itemCode: i.itemCode,
    itemName: i.itemName,
    itemType: productType(i.itemType),
    theoreticalWeightTon: weightOf(info, i.itemCode),
    orderedQty: i.orderedQty,
    shippedQty: lines.get(i.salesOrderItemId)?.shippedQty ?? 0,
    dueDate: i.dueDate,
    activeReservedQty: i.activeReservedQty,
    openRequestQty: i.pendingRequestQty,
    shippableQty: i.shippableQty,
    steelGradeCode: info(i.itemCode)?.steelGradeCode ?? null,
  }));
}

/** 요청 매수: 숫자만 쓴 글자는 숫자로 보내고, 그 밖은 그대로 보내 서버가 입력 오류로 거부하게 한다 */
const qtyForServer = (qty: string): unknown => (/^\d+$/.test(qty.trim()) ? Number(qty.trim()) : qty);

/**
 * 출하요청 등록. 가짜 DB처럼 등록하면서 품목마다 FIFO 추천을 작업 로그로 남긴다(POST allocations/recommend).
 * 추천할 합격 LOT이 없으면(INV-001) 추천 로그만 건너뛴다.
 */
async function create(form: CreateShipmentRequestForm): Promise<{ id: number; shipmentRequestNo: string; recommendation: never[] }> {
  const created = await serverRequest<ServerShipmentRequestDetail>('POST', '/shipment-requests', {
    body: {
      customerId: form.customerId,
      shipDate: form.requestedShipDate || undefined,
      items: form.items.map((i) => ({ salesOrderItemId: i.salesOrderItemId, requestQty: qtyForServer(i.requestQty) })),
    },
  });
  for (const item of created.items) {
    try {
      await serverRequest<AllocationRecommendation>('POST', '/allocations/recommend', { body: { allocationPurpose: 'SHIPMENT', shipmentRequestItemId: item.id } });
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'INV-001')) throw e;
    }
  }
  return { id: created.id, shipmentRequestNo: created.shipmentRequestNo, recommendation: [] };
}

/** 배정 확정: 품목마다 POST allocations (품목 단위로 한 트랜잭션. 앞 품목이 확정된 뒤 뒤 품목이 실패하면 앞 품목 배정은 남는다) */
async function confirmAllocations(input: { shipmentRequestId: number; lines: { shipmentRequestItemId: number; lotIds: number[] }[] }) {
  let confirmedQty = 0;
  for (const line of input.lines) {
    if (line.lotIds.length === 0) continue;
    const created = await serverRequest<AllocationView[]>('POST', '/allocations', { body: { allocationPurpose: 'SHIPMENT', shipmentRequestItemId: line.shipmentRequestItemId, lotIds: line.lotIds } });
    confirmedQty += created.length;
  }
  const d = await serverRequest<ServerShipmentRequestDetail>('GET', `/shipment-requests/${input.shipmentRequestId}`);
  return { confirmedQty, shipmentRequestStatus: d.shipmentRequestStatus };
}

async function changeAllocation(input: { allocationId: number; newLotId: number; reasonText: string }) {
  const created = await serverRequest<AllocationView>('POST', `/allocations/${input.allocationId}/release`, { body: { newLotId: input.newLotId, reason: input.reasonText || undefined } });
  return { allocationId: created.id, lotNo: created.lotNo };
}

async function releaseAllocation(input: { allocationId: number; reasonText?: string | null }) {
  const released = await serverRequest<AllocationView>('POST', `/allocations/${input.allocationId}/release`, { body: { reason: input.reasonText || undefined } });
  return { allocationId: released.id, lotNo: released.lotNo };
}

async function cancel(input: { shipmentRequestId: number }) {
  const row = await serverRequest<ServerShipmentRequestDetail>('POST', `/shipment-requests/${input.shipmentRequestId}/cancel`);
  return { id: row.id, shipmentRequestNo: row.shipmentRequestNo };
}

export const serverShipmentRequestApi = { list, detail, shippableCustomers, shippableItems, create, confirmAllocations, changeAllocation, releaseAllocation, cancel };
