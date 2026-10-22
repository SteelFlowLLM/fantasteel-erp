// 출고 확정 화면 ↔ 서버 API (server/src/modules/shipment). 출고 확정은 POST shipment-requests/:id/issue.
// 서버에는 출고 전 재검증만 하는 API가 없어서, 화면에 보일 ready·problems는 출하요청·수주 상세로 출고 확정과 같은 규칙을 계산한다.
// 배정 LOT의 상태·생산완료일·검사 판정·상위 히트는 출하요청 응답이 함께 주므로 LOT 상세를 따로 부르지 않는다(이슈 #519).
// 이 값은 보여 주기만 하고, 확정할 때 서버가 같은 규칙을 다시 확인한다(INV-001·INV-002·INV-004·SHP-002·COM-001).
// 수주 조회 권한이 없는 사원이면 수주 매수·출하 매수는 비우고, 이론중량·품목 유형은 출하요청 품목의 값을 쓴다.
// 출고 완료 줄은 재검증하지 않으므로 목록에서 수주를 읽지 않는다.
import type { InspectionResult, MillSheetSummary, SalesOrderDetail, SalesOrderItemFulfillment, ShipmentRequestAllocation, ShipmentRequestDetail } from '@fantasteel/shared';
import type { GoodsIssueLineView, GoodsIssueLotRow, GoodsIssueProblem, GoodsIssueQueueRow, GoodsIssueView } from '@/api/goodsIssues';
import { serverRequest } from '@/api/http';
import { allPages, orEmpty } from '@/api/server/inspections';
import type { ProductItemType } from '@/codes';
import { productEligibility } from '@/lib/eligibility';
import { calcWeightTon, sumTon } from '@/lib/weight';

/** 출하요청 품목 하나의 수주 품목 정보. 수주를 못 읽으면 so는 null */
interface ItemFacts {
  itemType: ProductItemType;
  theoreticalWeightTon: string;
  salesOrderLineNo: number;
  so: SalesOrderItemFulfillment | null;
}

const productType = (itemType: string | undefined): ProductItemType => (itemType === 'COIL' ? 'COIL' : 'SLAB');
const passedOf = (result: InspectionResult | null): boolean | null => (result === 'PASS' ? true : result === 'FAIL' ? false : null);

/** 한 번의 화면 조회 안에서 같은 수주를 두 번 읽지 않도록 모아 둔다 */
class Reader {
  private readonly salesOrders = new Map<number, Promise<SalesOrderDetail | null>>();

  private salesOrder(id: number): Promise<SalesOrderDetail | null> {
    let found = this.salesOrders.get(id);
    if (!found) {
      found = orEmpty<SalesOrderDetail | null>(() => serverRequest<SalesOrderDetail>('GET', `/sales-orders/${id}`), null);
      this.salesOrders.set(id, found);
    }
    return found;
  }

  /** shipment_request_item id → 수주 품목 정보. readSalesOrders가 false면 수주를 읽지 않고 출하요청 품목의 값만 쓴다 */
  async itemFacts(detail: ShipmentRequestDetail, readSalesOrders = true): Promise<Map<number, ItemFacts>> {
    const salesOrders = readSalesOrders ? await Promise.all([...new Set(detail.items.map((i) => i.salesOrderId))].map((id) => this.salesOrder(id))) : [];
    const soItems = new Map<number, { item: SalesOrderItemFulfillment; lineNo: number }>();
    for (const so of salesOrders) so?.items.forEach((item, index) => soItems.set(item.salesOrderItemId, { item, lineNo: index + 1 }));
    return new Map(
      detail.items.map((i) => {
        const found = soItems.get(i.salesOrderItemId);
        return [
          i.id,
          {
            itemType: productType(found?.item.itemType ?? i.itemType),
            theoreticalWeightTon: found?.item.theoreticalWeightTon ?? i.theoreticalWeightTon ?? '0.000',
            salesOrderLineNo: found?.lineNo ?? 0,
            so: found?.item ?? null,
          },
        ];
      }),
    );
  }
}

const eligibilityOf = (a: ShipmentRequestAllocation) =>
  productEligibility({ lotStatus: a.lotStatus, isPassed: passedOf(a.inspectionResult) }, a.heat ? { isPassed: passedOf(a.heat.inspectionResult) } : null);

/** 출고 확정 전 재검증 (서버 출고 확정과 같은 순서·규칙) */
function checkOf(detail: ShipmentRequestDetail, items: Map<number, ItemFacts>): { ready: boolean; problems: GoodsIssueProblem[] } {
  if (detail.shipmentRequestStatus === 'ISSUED') return { ready: false, problems: [] };
  const problems: GoodsIssueProblem[] = [];
  if (detail.shipmentRequestStatus === 'CANCELLED') problems.push({ code: 'COM-003', message: '취소된 출하요청이에요', lotNo: null });
  for (const line of detail.items) {
    const confirmed = line.allocations.filter((a) => a.allocationStatus === 'CONFIRMED');
    if (confirmed.length < line.requestQty) problems.push({ code: 'INV-001', message: `배정 대기 ${line.requestQty - confirmed.length}매`, lotNo: null });
    const so = items.get(line.id)?.so;
    if (so && (line.requestQty > so.unshippedQty || line.requestQty > so.activeReservedQty)) {
      problems.push({ code: 'SHP-002', message: '예약·수주 잔량보다 많아요', lotNo: null });
    }
    for (const a of confirmed) {
      if (a.lotStatus !== 'AVAILABLE') problems.push({ code: 'INV-004', message: '이미 투입·출고된 LOT', lotNo: a.lotNo });
      else if (eligibilityOf(a) !== 'ELIGIBLE') problems.push({ code: 'INV-002', message: '미검사·불합격 LOT은 출고할 수 없어요', lotNo: a.lotNo });
    }
  }
  return { ready: problems.length === 0, problems };
}

function linesOf(detail: ShipmentRequestDetail, items: Map<number, ItemFacts>): GoodsIssueLineView[] {
  return detail.items.map((i, index) => {
    const facts = items.get(i.id);
    const theoreticalWeightTon = facts?.theoreticalWeightTon ?? '0.000';
    return {
      shipmentRequestItemId: i.id,
      lineNo: index + 1,
      salesOrderId: i.salesOrderId,
      salesOrderNo: i.salesOrderNo,
      salesOrderLineNo: facts?.salesOrderLineNo ?? 0,
      itemCode: i.itemCode,
      itemType: facts?.itemType ?? 'SLAB',
      requestQty: i.requestQty,
      requestTon: calcWeightTon(i.requestQty, theoreticalWeightTon),
      theoreticalWeightTon,
      orderedQty: facts?.so?.orderedQty ?? 0,
      shippedQty: facts?.so?.shippedQty ?? 0,
      salesOrderItemStatus: facts?.so?.salesOrderItemStatus ?? 'OPEN',
      // 서버의 출하 매수가 곧 CONVERTED 예약 합계다 (SalesOrderItemFulfillment.shippedQty)
      convertedQty: facts?.so?.shippedQty ?? 0,
      lots: i.allocations.map(
        (a): GoodsIssueLotRow => ({
          allocationId: a.allocationId,
          allocationStatus: a.allocationStatus,
          lotId: a.lotId,
          lotNo: a.lotNo,
          producedDate: a.producedDate ?? '',
          heatNo: a.heat?.lotNo ?? null,
          lotStatus: a.lotStatus,
          productInspectionResult: a.inspectionResult,
          heatInspectionResult: a.heat?.inspectionResult ?? null,
          eligibility: eligibilityOf(a),
        }),
      ),
    };
  });
}

function totalWeightOf(detail: ShipmentRequestDetail, items: Map<number, ItemFacts>): string {
  return sumTon(detail.items.map((i) => calcWeightTon(i.requestQty, items.get(i.id)?.theoreticalWeightTon ?? '0.000')));
}

const allocatedQtyOf = (detail: ShipmentRequestDetail) => detail.items.reduce((sum, i) => sum + i.allocations.length, 0);

const millSheetsOf = (shipmentRequestId: number) => orEmpty(() => allPages<MillSheetSummary>('/mill-sheets', { shipmentRequestId }), []);

async function detail(shipmentRequestId: number): Promise<GoodsIssueView> {
  const reader = new Reader();
  const d = await serverRequest<ShipmentRequestDetail>('GET', `/shipment-requests/${shipmentRequestId}`);
  const [items, millSheets] = await Promise.all([reader.itemFacts(d), millSheetsOf(d.id)]);
  const check = checkOf(d, items);
  return {
    id: d.id,
    shipmentRequestNo: d.shipmentRequestNo,
    customerId: d.customerId,
    customerName: d.customerName,
    requestedShipDate: d.shipDate ?? '',
    shipmentRequestStatus: d.shipmentRequestStatus,
    // 요청자 컬럼이 ERD에 없다 (작업 로그에만 남는다)
    requesterName: null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    issuedAt: d.issuedAt,
    issuedEmployeeName: d.issuedEmployeeName,
    cancelledAt: d.shipmentRequestStatus === 'CANCELLED' ? d.updatedAt : null,
    salesOrderNos: [...new Set(d.items.map((i) => i.salesOrderNo))],
    totalRequestQty: d.totalRequestQty,
    totalAllocatedQty: allocatedQtyOf(d),
    waitingAllocationQty: d.shipmentRequestStatus === 'CANCELLED' ? 0 : d.items.reduce((sum, i) => sum + Math.max(0, i.requestQty - i.allocations.length), 0),
    totalWeightTon: totalWeightOf(d, items),
    millSheets: millSheets.map((m) => ({ id: m.id, millSheetNo: m.millSheetNo, salesOrderId: m.salesOrderId, issuedAt: m.issuedAt, pdfPath: m.pdfPath })),
    lines: linesOf(d, items),
    ready: check.ready,
    problems: check.problems,
  };
}

const QUEUE_RANK: Record<string, number> = { ALLOCATED: 0, REQUESTED: 1 };

/** 목록 순서: 배정 확정 → 배정 대기 → 출고 완료, 그 안에서 출하 요청일 → 최근 등록 */
async function queue(): Promise<GoodsIssueQueueRow[]> {
  const reader = new Reader();
  // 줄마다 상세(품목·배정)를 함께 받는다: 건마다 상세를 따로 부르던 N+1을 없앤다 (이슈 #476, 서버 목록 withItems)
  const details = (await allPages<ShipmentRequestDetail>('/shipment-requests', { withItems: 'true' })).filter((s) => s.shipmentRequestStatus !== 'CANCELLED');
  const rows = await Promise.all(
    details.map(async (d): Promise<GoodsIssueQueueRow> => {
      // 출고 완료 줄은 재검증하지 않으므로 수주를 읽지 않는다 (톤은 출하요청 품목의 이론중량으로 계산한다)
      const items = await reader.itemFacts(d, d.shipmentRequestStatus !== 'ISSUED');
      const check = checkOf(d, items);
      return {
        shipmentRequestId: d.id,
        shipmentRequestNo: d.shipmentRequestNo,
        shipmentRequestStatus: d.shipmentRequestStatus,
        customerName: d.customerName,
        requestedShipDate: d.shipDate ?? '',
        totalRequestQty: d.totalRequestQty,
        totalAllocatedQty: allocatedQtyOf(d),
        totalWeightTon: totalWeightOf(d, items),
        issuedAt: d.issuedAt,
        issuedEmployeeName: d.issuedEmployeeName,
        ready: check.ready,
        problems: check.problems,
      };
    }),
  );
  return rows.sort(
    (a, b) =>
      (QUEUE_RANK[a.shipmentRequestStatus] ?? 2) - (QUEUE_RANK[b.shipmentRequestStatus] ?? 2) ||
      a.requestedShipDate.localeCompare(b.requestedShipDate) ||
      b.shipmentRequestId - a.shipmentRequestId,
  );
}

/** 출고 확정. 서버가 한 트랜잭션에서 재검증·전환·밀시트 발행을 하고, 이미 출고했으면 COM-001이다 */
async function confirm(input: { shipmentRequestId: number }): Promise<{ shipmentRequestNo: string; issuedLotNos: string[]; millSheets: { id: number; millSheetNo: string }[] }> {
  const issued = await serverRequest<ShipmentRequestDetail>('POST', `/shipment-requests/${input.shipmentRequestId}/issue`);
  const millSheets = await millSheetsOf(issued.id);
  return {
    shipmentRequestNo: issued.shipmentRequestNo,
    issuedLotNos: issued.items.flatMap((i) => i.allocations.filter((a) => a.allocationStatus === 'CONSUMED').map((a) => a.lotNo)),
    millSheets: millSheets.map((m) => ({ id: m.id, millSheetNo: m.millSheetNo })),
  };
}

export const serverGoodsIssueApi = { queue, detail, confirm };
