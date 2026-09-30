// 출하 화면(출하요청 목록·등록·배정, 출고 확정, 밀시트)이 같이 쓰는 표시 부품과 작은 도우미.
import { Fragment, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  ALLOCATION_STATUS_LABEL, ITEM_TYPE_LABEL, SHIPMENT_REQUEST_ITEM_STATUS_LABEL, SHIPMENT_REQUEST_STATUS_LABEL,
  type AllocationStatus, type PdfStatus, type ShipmentRequestItemStatus, type ShipmentRequestStatus,
} from '@fantasteel/shared';
import type { ShipmentRequestView } from '@/api/shipments';
import { Badge, Icon, Modal, type Tone } from '@/components/ui';
import { fmtDate, fmtMDdow } from '@/lib/format';

// ───────────── 상태 표시 ─────────────
const REQUEST_TONE: Record<ShipmentRequestStatus, Tone> = { REQUESTED: 'wait', ALLOCATED: 'run', PARTIALLY_ISSUED: 'run', ISSUED: 'ok', CANCELLED: 'neutral' };
const ITEM_TONE: Record<ShipmentRequestItemStatus, Tone> = { WAITING_ALLOCATION: 'wait', ALLOCATED: 'run', ISSUED: 'ok' };
const ALLOCATION_TONE: Record<AllocationStatus, Tone> = { CONFIRMED: 'run', CONSUMED: 'ok', RELEASED: 'neutral' };
/** PDF 상태는 shared에 라벨 상수가 없어 화면 문구로 둔다 (docs/api/shipment.md 3-2) */
const PDF_LABEL: Record<PdfStatus, string> = { PENDING: 'PDF 미생성', READY: 'PDF 준비됨', FAILED: 'PDF 생성 실패' };
const PDF_TONE: Record<PdfStatus, Tone> = { PENDING: 'neutral', READY: 'ok', FAILED: 'danger' };

export function ShipmentStatusBadge({ status }: { status: ShipmentRequestStatus }) {
  return <Badge tone={REQUEST_TONE[status] ?? 'neutral'}>{SHIPMENT_REQUEST_STATUS_LABEL[status] ?? status}</Badge>;
}
export function ShipmentItemStatusBadge({ status }: { status: ShipmentRequestItemStatus }) {
  return <Badge tone={ITEM_TONE[status] ?? 'neutral'}>{SHIPMENT_REQUEST_ITEM_STATUS_LABEL[status] ?? status}</Badge>;
}
export function AllocationStatusBadge({ status }: { status: AllocationStatus }) {
  return <Badge tone={ALLOCATION_TONE[status] ?? 'neutral'}>{ALLOCATION_STATUS_LABEL[status] ?? status}</Badge>;
}
export function PdfStatusBadge({ status }: { status: PdfStatus }) {
  return <Badge tone={PDF_TONE[status] ?? 'neutral'}>{PDF_LABEL[status] ?? status}</Badge>;
}

// ───────────── 링크 ─────────────
export function LotLink({ lotNo }: { lotNo: string }) {
  return <Link className="hl-link-id" to={`/lots/trace?lot=${encodeURIComponent(lotNo)}`}>{lotNo}</Link>;
}
export function SalesOrderLink({ id, no, lineNo }: { id: number; no: string; lineNo?: number }) {
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <Link className="hl-link-id" to={`/sales-orders/${id}`}>{no}</Link>
      {lineNo !== undefined ? <span className="hl-muted tnum"> #{lineNo}</span> : null}
    </span>
  );
}
/** 출하요청에 들어 있는 수주 (중복 제거, 품목 순서) */
export function requestOrders(r: Pick<ShipmentRequestView, 'items'>): { id: number; no: string }[] {
  const seen = new Map<number, string>();
  for (const it of r.items) if (!seen.has(it.salesOrderId)) seen.set(it.salesOrderId, it.salesOrderNo);
  return [...seen].map(([id, no]) => ({ id, no }));
}
export function OrderLinks({ request }: { request: Pick<ShipmentRequestView, 'items'> }) {
  const orders = requestOrders(request);
  return <>{orders.map((o, i) => <Fragment key={o.id}>{i ? ' · ' : ''}<SalesOrderLink id={o.id} no={o.no} /></Fragment>)}</>;
}

// ───────────── 요약 문구 ─────────────
export const itemTypeLabel = (t: 'SLAB' | 'COIL') => ITEM_TYPE_LABEL[t] ?? t;
/** 품목들의 단위. 슬래브(매)와 코일(개)이 섞이면 "매·개" */
export function unitOf(items: { qtyUnit: string }[]): string {
  const units = [...new Set(items.map((it) => it.qtyUnit))];
  return units.length ? units.join('·') : '매';
}
/** "SL-SS275-250x1200x10000 외 1" */
export function itemsSummary(items: { specCode: string }[]): string {
  if (!items.length) return '-';
  return items.length > 1 ? `${items[0].specCode} 외 ${items.length - 1}` : items[0].specCode;
}
/** 날짜만 있는 값('YYYY-MM-DD')을 "10-02 (금)"으로 */
export const shipDateLabel = (v: string | null | undefined) => (v ? fmtMDdow(`${v.slice(0, 10)}T00:00:00+09:00`) : '-');
export const date10 = (v: string | null | undefined) => (v ? (v.length > 10 ? fmtDate(v) : v) : '-');

// ───────────── 요약 띠 (v1 B안의 페이지 머리 아래 한 줄 요약) ─────────────
export function InfoStrip({ cells }: { cells: { label: string; value: ReactNode; grow?: boolean }[] }) {
  return (
    <div className="hl-row" style={{ gap: 0, background: '#FFFFFF', border: '1px solid #DDE2E7', borderRadius: 6, flex: 'none', flexWrap: 'wrap' }}>
      {cells.map((c, i) => (
        <div key={c.label} className={`hl-col${c.grow ? ' hl-grow' : ''}`} style={{ padding: '10px 16px', gap: 2, borderRight: i < cells.length - 1 ? '1px solid #DDE2E7' : undefined }}>
          <span className="hl-cap">{c.label}</span>
          <b style={{ fontSize: 13 }}>{c.value}</b>
        </div>
      ))}
    </div>
  );
}

/** 요청 → 배정 → 출고 → 밀시트 진행 표시 */
export function ShipmentSteps({ status }: { status: ShipmentRequestStatus }) {
  if (status === 'CANCELLED') return <span className="hl-muted" style={{ fontSize: 12, fontWeight: 500 }}>취소된 요청</span>;
  const at = status === 'REQUESTED' ? 1 : status === 'ALLOCATED' ? 2 : 4;
  const steps = ['출하요청', 'LOT 배정', '출고 확정', '밀시트'];
  return (
    <div className="hl-steps">
      {steps.map((label, i) => {
        const state = i < at ? 'done' : i === at ? 'run' : 'todo';
        return (
          <Fragment key={label}>
            {i ? <span className={`hl-step__line${state === 'done' ? ' is-done' : ''}`} /> : null}
            <span className={`hl-step${state === 'done' ? ' is-done' : state === 'run' ? ' is-run' : ''}`}>
              <span className="hl-step__dot">{state === 'done' ? <Icon name="check" size="sm" style={{ width: 10, height: 10 }} /> : null}</span>
              {label}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

// ───────────── 사유를 받는 확인 창 (배정 해제·출하요청 취소) ─────────────
export function ReasonModal({ title, children, confirmLabel, danger, pending, onConfirm, onClose, placeholder }: {
  title: string; children: ReactNode; confirmLabel: string; danger?: boolean; pending: boolean;
  onConfirm: (reason: string) => void; onClose: () => void; placeholder?: string;
}) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={460}
      footer={(
        <>
          <button type="button" className="hl-btn" onClick={onClose} disabled={pending}>닫기</button>
          <button type="button" className={`hl-btn ${danger ? 'hl-btn--danger' : 'hl-btn--primary'}`} onClick={() => onConfirm(reason.trim())} disabled={pending}>{confirmLabel}</button>
        </>
      )}
    >
      <div className="hl-col" style={{ gap: 12 }}>
        <div style={{ fontSize: 13, lineHeight: '20px' }}>{children}</div>
        <label className="hl-field">
          <span className="hl-field__label">사유 (선택)</span>
          <textarea className="hl-input" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={placeholder ?? '작업 로그에 남아요'} />
        </label>
      </div>
    </Modal>
  );
}
