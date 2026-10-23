// 밀시트 화면 ↔ 서버 API (server/src/modules/shipment). 화면은 서버가 출고 확정 때 저장한 스냅샷만으로 그린다.
// 서버 목록이 스냅샷에서 뽑은 고객사·매수·히트·규격을 함께 주므로 밀시트마다 상세(스냅샷)를 따로 부르지 않는다(이슈 #498).
// 스냅샷에 수주 줄 번호가 없어(ERD sales_order_item에도 없음) 수주 상세의 품목 순서로 매긴다. 다른 서버 어댑터와 같은 기준이다.
// 수주 조회 권한이 없으면(품질) 밀시트 안의 품목 순서로 매긴다.
import type { MillSheetDetail, MillSheetListItem, SalesOrderDetail } from '@fantasteel/shared';
import { serverRequest } from '@/api/http';
import type { MillSheetDetailView, MillSheetListRow, MillSheetSnapshot } from '@/api/millSheets';
import { allPages, orEmpty } from '@/api/server/inspections';
import type { ProductItemType } from '@/codes';

const isProductType = (value: string): value is ProductItemType => value === 'SLAB' || value === 'COIL';

/** 서버 스냅샷 → 화면 스냅샷. 다른 이름: 출하 예정일 shipDate → requestedShipDate. 비어 있을 수 있는 생산일은 '' */
function toSnapshot(s: MillSheetDetail['snapshot'], lineNoOf: (salesOrderItemId: number, index: number) => number): MillSheetSnapshot {
  return {
    ...s,
    shipmentRequest: {
      shipmentRequestId: s.shipmentRequest.shipmentRequestId,
      shipmentRequestNo: s.shipmentRequest.shipmentRequestNo,
      requestedShipDate: s.shipmentRequest.shipDate ?? '',
      issuedAt: s.shipmentRequest.issuedAt,
      issuedEmployeeName: s.shipmentRequest.issuedEmployeeName,
    },
    items: s.items.map((item, index) => ({
      ...item,
      lineNo: lineNoOf(item.salesOrderItemId, index),
      lots: item.lots.map((lot) => ({ ...lot, producedDate: lot.producedDate ?? '' })),
    })),
    heats: s.heats.map((heat) => ({ ...heat, producedDate: heat.producedDate ?? '' })),
  };
}

const readDetail = (id: number) => serverRequest<MillSheetDetail>('GET', `/mill-sheets/${id}`);

async function list(): Promise<MillSheetListRow[]> {
  const rows = await allPages<MillSheetListItem>('/mill-sheets');
  return rows
    .map(
      (m): MillSheetListRow => ({
        id: m.id,
        millSheetNo: m.millSheetNo,
        shipmentRequestId: m.shipmentRequestId,
        shipmentRequestNo: m.shipmentRequestNo,
        salesOrderId: m.salesOrderId,
        salesOrderNo: m.salesOrderNo,
        customerName: m.customerName,
        issuedAt: m.issuedAt,
        totalQty: m.totalQty,
        totalWeightTon: m.totalWeightTon,
        heatNos: m.heatNos,
        pdfPath: m.pdfPath,
        itemTypes: m.itemTypes.filter(isProductType),
        itemCodes: m.itemCodes,
      }),
    )
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt) || b.id - a.id);
}

async function detail(id: number): Promise<MillSheetDetailView> {
  const d = await readDetail(id);
  const salesOrder = await orEmpty<SalesOrderDetail | null>(() => serverRequest<SalesOrderDetail>('GET', `/sales-orders/${d.salesOrderId}`), null);
  const lineNos = new Map(salesOrder?.items.map((i, index) => [i.salesOrderItemId, index + 1]) ?? []);
  return {
    id: d.id,
    millSheetNo: d.millSheetNo,
    shipmentRequestId: d.shipmentRequestId,
    salesOrderId: d.salesOrderId,
    issuedAt: d.issuedAt,
    pdfPath: d.pdfPath,
    snapshot: toSnapshot(d.snapshot, (salesOrderItemId, index) => lineNos.get(salesOrderItemId) ?? index + 1),
  };
}

/** 서버가 저장된 스냅샷으로 PDF를 만들어 저장한다. 이미 만들었으면 그 경로를 그대로 돌려준다. 실패하면 SHP-001 */
async function markPdfGenerated(input: { millSheetId: number }): Promise<{ id: number; millSheetNo: string; pdfPath: string | null }> {
  const d = await serverRequest<MillSheetDetail>('POST', `/mill-sheets/${input.millSheetId}/pdf`);
  return { id: d.id, millSheetNo: d.millSheetNo, pdfPath: d.pdfPath };
}

export const serverMillSheetApi = { list, detail, markPdfGenerated };
