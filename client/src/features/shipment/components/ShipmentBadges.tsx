// 출하 화면 공통 배지·링크. 문구는 공통 코드 표시명(@/codes) 그대로, 색은 상태별로 통일한다 (보고서 1 A-11).
import Link from 'next/link';
import {
  ALLOCATION_STATUS_LABEL,
  INSPECTION_RESULT_LABEL,
  ITEM_TYPE_LABEL,
  SALES_ORDER_ITEM_STATUS_LABEL,
  SHIPMENT_REQUEST_STATUS_LABEL,
  type AllocationStatus,
  type InspectionResult,
  type ProductItemType,
  type SalesOrderItemStatus,
  type ShipmentRequestStatus,
} from '@/codes';
import { Badge, type BadgeTone } from '@/components/Badge';
import { Tag } from '@/components/Tag';

export const SHIPMENT_REQUEST_STATUS_TONE: Record<ShipmentRequestStatus, BadgeTone> = {
  REQUESTED: 'wait',
  ALLOCATED: 'run',
  ISSUED: 'ok',
  CANCELLED: 'neutral',
};

const SALES_ORDER_ITEM_STATUS_TONE: Record<SalesOrderItemStatus, BadgeTone> = {
  OPEN: 'run',
  PARTIALLY_SHIPPED: 'wait',
  SHIPPED: 'ok',
  CANCELLED: 'danger',
};

const ALLOCATION_STATUS_TONE: Record<AllocationStatus, BadgeTone> = { CONFIRMED: 'run', CONSUMED: 'ok', RELEASED: 'neutral' };

const INSPECTION_RESULT_TONE: Record<InspectionResult, BadgeTone> = { PENDING: 'wait', PASS: 'ok', FAIL: 'danger' };

export function ShipmentRequestStatusBadge({ status }: { status: ShipmentRequestStatus }) {
  return <Badge tone={SHIPMENT_REQUEST_STATUS_TONE[status]}>{SHIPMENT_REQUEST_STATUS_LABEL[status]}</Badge>;
}

export function SalesOrderItemStatusBadge({ status }: { status: SalesOrderItemStatus }) {
  return <Badge tone={SALES_ORDER_ITEM_STATUS_TONE[status]}>{SALES_ORDER_ITEM_STATUS_LABEL[status]}</Badge>;
}

export function AllocationStatusBadge({ status }: { status: AllocationStatus }) {
  return <Badge tone={ALLOCATION_STATUS_TONE[status]}>{ALLOCATION_STATUS_LABEL[status]}</Badge>;
}

/** 검사 판정. 검사 행이 없으면 '—' */
export function InspectionResultBadge({ result }: { result: InspectionResult | null }) {
  if (!result) return <span className="text-ink-3">—</span>;
  return <Badge tone={INSPECTION_RESULT_TONE[result]}>{INSPECTION_RESULT_LABEL[result]}</Badge>;
}

/** 밀시트 PDF 생성 여부 = pdf_path 유무 (공통 코드 없음, 공통 코드 정의서 4장) */
export function PdfBadge({ pdfPath }: { pdfPath: string | null }) {
  return pdfPath ? (
    <Badge tone="ok" title={pdfPath}>
      PDF 생성됨
    </Badge>
  ) : (
    <Badge tone="outline">PDF 미생성</Badge>
  );
}

export function ItemTypeTag({ itemType }: { itemType: ProductItemType }) {
  return (
    <Tag tone="outline" size="sm">
      {ITEM_TYPE_LABEL[itemType]}
    </Tag>
  );
}

const LINK = 'font-mono text-mono text-run hover:underline';

export function SalesOrderLink({ salesOrderId, salesOrderNo, lineNo }: { salesOrderId: number; salesOrderNo: string; lineNo?: number }) {
  return (
    <Link href={`/sales-orders/${salesOrderId}`} className={LINK} onClick={(e) => e.stopPropagation()}>
      {salesOrderNo}
      {lineNo !== undefined ? ` #${lineNo}` : ''}
    </Link>
  );
}

/** LOT 추적 화면으로 (LOT 번호·출하요청 번호로 찾는다, REQ-LOT-005). 출하요청 번호(DR-)는 ?shipmentRequestNo=, 그 밖은 ?lot= */
export function TraceLink({ no }: { no: string }) {
  const href = no.startsWith('DR-') ? `/lots/trace?shipmentRequestNo=${encodeURIComponent(no)}` : `/lots/trace?lot=${encodeURIComponent(no)}`;
  return (
    <Link href={href} className={LINK} onClick={(e) => e.stopPropagation()}>
      {no}
    </Link>
  );
}

export function ShipmentRequestLink({ id, no }: { id: number; no: string }) {
  return (
    <Link href={`/shipment-requests/${id}`} className={LINK} onClick={(e) => e.stopPropagation()}>
      {no}
    </Link>
  );
}

export function MillSheetLink({ id, no }: { id: number; no: string }) {
  return (
    <Link href={`/mill-sheets?id=${id}`} className={LINK} onClick={(e) => e.stopPropagation()}>
      {no}
    </Link>
  );
}
