// 구매 화면(MRP·구매요청·초안·발주·입고·승인함)이 같이 쓰는 표시 부품과 작은 도우미.
import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  DRAFT_STATUS_LABEL, GOODS_RECEIPT_STATUS_LABEL, PURCHASE_ORDER_STATUS_LABEL, PURCHASE_REQUISITION_STATUS_LABEL, REQUISITION_SOURCE_TYPE_LABEL,
  type DraftStatus, type GoodsReceiptStatus, type PurchaseOrderStatus, type PurchaseRequisitionStatus, type RequisitionSourceType,
} from '@fantasteel/shared';
import { purchasingLookupApi, type EmployeeBrief, type PurchaseRequisitionItemView } from '@/api/purchasing';
import { Badge, Icon, type Tone } from '@/components/ui';
import { fmtMDHM, fmtTon } from '@/lib/format';

// ───────────── 날짜·톤 ─────────────
/** 날짜만 있는 값('2026-10-10T00:00:00.000Z')의 앞 10자리 */
export const d10 = (v: string | null | undefined): string => (v ? v.slice(0, 10) : '');
/** 10-10 */
export const md = (v: string | null | undefined): string => (v ? v.slice(5, 10) : '-');
export const isPositive = (v: string | number | null | undefined): boolean => Number(v ?? 0) > 0;

const TON_RE = /^\d+(\.\d{1,3})?$/;
/** 톤 입력 검사: 0보다 크고 소수 3자리 이하. max를 주면 그 값 이하. 맞으면 null. */
export function tonError(text: string, max?: string | number): string | null {
  const s = text.trim();
  if (!s) return '톤을 입력해 주세요';
  if (!TON_RE.test(s)) return '숫자로, 소수 3자리까지 입력해 주세요';
  if (Number(s) <= 0) return '0보다 커야 해요';
  if (max !== undefined && Number(s) > Number(max)) return `${fmtTon(max)} 이하로 입력해 주세요`;
  return null;
}
/** "150.000" → "150" (입력 칸 초기값용, 값은 바꾸지 않는다) */
export const tonInput = (v: string | null | undefined): string => {
  if (!v) return '';
  return v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v;
};

// ───────────── 상태 배지 ─────────────
const PR_TONE: Record<PurchaseRequisitionStatus, Tone> = { DRAFT: 'neutral', WAITING_APPROVAL: 'wait', APPROVED: 'run', REJECTED: 'danger', ORDERED: 'ok' };
const PO_TONE: Record<PurchaseOrderStatus, Tone> = { CONFIRMED: 'run', PARTIALLY_RECEIVED: 'wait', RECEIVED: 'ok' };
const GR_TONE: Record<GoodsReceiptStatus, Tone> = { DRAFT: 'wait', CONFIRMED: 'ok' };
const DRAFT_TONE: Record<DraftStatus, Tone> = { AI_GENERATED: 'ai', WAITING_APPROVAL: 'wait', APPROVED: 'run', EXECUTED: 'ok', REJECTED: 'danger' };

export function PrStatusBadge({ status }: { status: string }) {
  const s = status as PurchaseRequisitionStatus;
  return <Badge tone={PR_TONE[s] ?? 'neutral'}>{PURCHASE_REQUISITION_STATUS_LABEL[s] ?? status}</Badge>;
}
export function PoStatusBadge({ status }: { status: string }) {
  const s = status as PurchaseOrderStatus;
  return <Badge tone={PO_TONE[s] ?? 'neutral'}>{PURCHASE_ORDER_STATUS_LABEL[s] ?? status}</Badge>;
}
export function GrStatusBadge({ status }: { status: string }) {
  const s = status as GoodsReceiptStatus;
  return <Badge tone={GR_TONE[s] ?? 'neutral'}>{GOODS_RECEIPT_STATUS_LABEL[s] ?? status}</Badge>;
}
export function DraftStatusBadge({ status }: { status: string }) {
  const s = status as DraftStatus;
  return <Badge tone={DRAFT_TONE[s] ?? 'neutral'}>{DRAFT_STATUS_LABEL[s] ?? status}</Badge>;
}
export function SourceTag({ source, style }: { source: RequisitionSourceType; style?: CSSProperties }) {
  return <span className="hl-tag" style={style}>{REQUISITION_SOURCE_TYPE_LABEL[source] ?? source}</span>;
}

// ───────────── 진행 단계 (디자인의 hl-draftflow) ─────────────
function FlowSteps<T extends string>({ steps, current, tone, label, tail, style }: { steps: T[]; current: number; tone: Record<T, string>; label: (s: T) => string; tail?: ReactNode; style?: CSSProperties }) {
  return (
    <span className="hl-draftflow" style={{ fontFamily: 'inherit', fontSize: 11.5, flexWrap: 'wrap', ...style }}>
      {steps.map((s, i) => (
        <Fragment key={s}>
          {i ? <i /> : null}
          <span className={current < 0 || i > current ? undefined : i === current ? `${tone[s]} is-current` : tone[s]}>{label(s)}</span>
        </Fragment>
      ))}
      {tail}
    </span>
  );
}

const PR_FLOW: Exclude<PurchaseRequisitionStatus, 'REJECTED'>[] = ['DRAFT', 'WAITING_APPROVAL', 'APPROVED', 'ORDERED'];
const PR_FLOW_TONE = { DRAFT: 'is-ai', WAITING_APPROVAL: 'is-wait', APPROVED: 'is-run', ORDERED: 'is-ok' } as const;
const REJECT_STEP: CSSProperties = { background: 'var(--danger-bg)', color: 'var(--danger)' };

/** 작성 중 → 승인 대기 → 승인 → 발주 완료 / 반려 (반려된 요청은 작성 중 단계로 돌아온 것으로 표시) */
export function RequisitionFlow({ status, style }: { status: PurchaseRequisitionStatus; style?: CSSProperties }) {
  const rejected = status === 'REJECTED';
  return (
    <FlowSteps
      steps={PR_FLOW}
      current={rejected ? 0 : PR_FLOW.indexOf(status as (typeof PR_FLOW)[number])}
      tone={PR_FLOW_TONE}
      label={(s) => PURCHASE_REQUISITION_STATUS_LABEL[s]}
      style={style}
      tail={<><i /><span className={rejected ? 'is-current' : undefined} style={rejected ? REJECT_STEP : undefined}>{PURCHASE_REQUISITION_STATUS_LABEL.REJECTED}</span></>}
    />
  );
}

const DRAFT_FLOW: Exclude<DraftStatus, 'REJECTED'>[] = ['AI_GENERATED', 'WAITING_APPROVAL', 'APPROVED', 'EXECUTED'];
const DRAFT_FLOW_TONE = { AI_GENERATED: 'is-ai', WAITING_APPROVAL: 'is-wait', APPROVED: 'is-run', EXECUTED: 'is-ok' } as const;

/** 생성 → 확인 대기 → 확정 → ERP 반영 / 반려 */
export function DraftFlow({ status, style }: { status: DraftStatus; style?: CSSProperties }) {
  const rejected = status === 'REJECTED';
  return (
    <FlowSteps
      steps={DRAFT_FLOW}
      current={rejected ? -1 : DRAFT_FLOW.indexOf(status as (typeof DRAFT_FLOW)[number])}
      tone={DRAFT_FLOW_TONE}
      label={(s) => DRAFT_STATUS_LABEL[s]}
      style={style}
      tail={<><i /><span className={rejected ? 'is-current' : undefined} style={rejected ? REJECT_STEP : undefined}>{DRAFT_STATUS_LABEL.REJECTED}</span></>}
    />
  );
}

// ───────────── 원본 메시지 상자 (디자인의 hl-origin) ─────────────
export interface OriginMessageData {
  content: string;
  createdAt: string;
  sender: EmployeeBrief | null;
  chatRoom: { id: number; chatRoomType: string; chatRoomName: string | null };
}
export const roomLabel = (room: OriginMessageData['chatRoom']): string => room.chatRoomName ?? (room.chatRoomType === 'DIRECT' ? '1:1 대화' : '대화방');

export function OriginMessage({ message, children }: { message: OriginMessageData; children?: ReactNode }) {
  return (
    <div className="hl-origin">
      <Icon name="hash" size="sm" />
      <div className="hl-col" style={{ gap: 3, minWidth: 0 }}>
        <span><b>{roomLabel(message.chatRoom)}</b> · {message.sender ? `${message.sender.employeeName} (${message.sender.department.departmentName})` : '알 수 없음'} · {fmtMDHM(message.createdAt)}</span>
        <span style={{ color: 'var(--ink)', fontSize: 12.5, lineHeight: '19px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>“{message.content}”</span>
        <span className="hl-row" style={{ gap: 12 }}>
          <Link to={`/messenger?room=${message.chatRoom.id}`} style={{ fontWeight: 600 }}>
            원본 메시지로 이동 <Icon name="chevron-right" size="sm" />
          </Link>
          {children}
        </span>
      </div>
    </div>
  );
}

// ───────────── 기타 ─────────────
export const personLabel = (e: EmployeeBrief | null | undefined): string => (e ? `${e.employeeName} ${e.jobGrade}` : '-');

/** "철광석 150.000 t 외 1종" */
export function itemsSummary(items: PurchaseRequisitionItemView[]): string {
  if (!items.length) return '품목 없음';
  const first = items[0];
  return `${first.rawMaterial.itemName} ${fmtTon(first.requiredTon)}${items.length > 1 ? ` 외 ${items.length - 1}종` : ''}`;
}

/** 원료·공급업체·야드 선택 목록. 사용 중인 것만 온다. */
export function usePurchasingLookups() {
  return useQuery({ queryKey: ['master-data', 'lookups'], queryFn: purchasingLookupApi.get, staleTime: 60_000 });
}
