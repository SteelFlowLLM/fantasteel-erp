// 작업 로그 화면이 나눠 쓰는 부품: 주체 칩, 유형 칩, 대상 링크, 변경 전·후 비교, 타임라인 한 줄.
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { LOT_TYPE_LABEL, type EventReasonCode, type EventTargetType } from '@fantasteel/shared';
import type { BusinessEventView } from '@/api/businessEvents';
import { fmtDateTime, fmtHM } from '@/lib/format';
import { traceHref } from './traceUi';

export const TARGET_TYPE_LABEL: Record<EventTargetType, string> = {
  SALES_ORDER: '수주', SALES_ORDER_ITEM: '수주 품목', RESERVATION: '예약', ALLOCATION: '배정', PRODUCTION_PLAN: '생산계획',
  PRODUCTION_RESULT: '생산 실적', LOT: 'LOT', QUALITY_INSPECTION: '품질 검사', MRP_RUN: 'MRP 실행', PURCHASE_REQUISITION: '구매요청',
  PURCHASE_ORDER: '발주', GOODS_RECEIPT: '입고', SHIPMENT_REQUEST: '출하요청', GOODS_ISSUE: '출고', MILL_SHEET: '밀시트',
  ACTION_DRAFT: '초안', MASTER: '기준정보',
};

/** 사유 코드의 화면용 이름 (코드 값은 업무 프로세스 정의서 9.3의 제안값). */
export const REASON_CODE_LABEL: Record<EventReasonCode, string> = {
  STOCK_FIRST: '재고 우선', FIFO_RECOMMENDATION: '선입선출 추천', ORDER_SHORTAGE: '수주 부족분', ORDER_CANCELLED: '수주 취소',
  QUALITY_FAILURE: '품질 불합격', SURPLUS_CONVERSION: '여재 전환', ALLOCATION_CHANGE: '배정 변경', DRAFT_CONFIRMED: '초안 확정',
  QUALITY_PASSED: '품질 합격', GOODS_ISSUE: '출고', SIMULATION: '시뮬레이션',
};

const KEY_LABEL: Record<string, string> = { onHandQty: '재고 수량', reservedQty: '예약 수량' };

const WEEKDAY = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'short' });
export const dayLabel = (iso: string, day: string) => `${day} (${WEEKDAY.format(new Date(iso))})`;

/** 주체 칩: 사용자는 이름 + 부서, 시스템은 "시스템". */
export function ActorChip({ e, style }: { e: BusinessEventView; style?: React.CSSProperties }) {
  if (e.actorType === 'SYSTEM') return <span className="hl-actor hl-actor--system" style={style}>시스템</span>;
  return (
    <span className="hl-actor hl-actor--user" style={style} title={e.actor ? `${e.actor.employeeName} · ${e.actor.departmentName} ${e.actor.jobGrade} (${e.actor.employeeNo})` : e.actorLabel}>
      {e.actorLabel}
      {e.actor ? <span style={{ fontWeight: 400, opacity: 0.8 }}>{e.actor.departmentName}</span> : null}
    </span>
  );
}

/** 대상 번호가 갈 수 있는 화면 (없으면 null). */
export function targetHref(e: BusinessEventView): string | null {
  const id = e.targetId;
  switch (e.targetType) {
    case 'SALES_ORDER': { const so = id ?? e.salesOrderId; return so ? `/sales-orders/${so}` : null; }
    case 'SALES_ORDER_ITEM':
    case 'RESERVATION': return e.salesOrderId ? `/sales-orders/${e.salesOrderId}` : null;
    case 'LOT': return e.targetNo ? traceHref(e.targetNo) : null;
    case 'PRODUCTION_PLAN': return id ? `/production/plans?plan=${id}` : null;
    case 'PURCHASE_REQUISITION': return id ? `/purchase-requisitions/${id}` : null;
    case 'SHIPMENT_REQUEST': return id ? `/shipment-requests/${id}` : null;
    case 'MILL_SHEET': return id ? `/mill-sheets?id=${id}` : null;
    case 'ACTION_DRAFT': { const d = id ?? e.actionDraftId; return d ? `/action-drafts/${d}` : null; }
    default: return null;
  }
}

export function TargetLink({ e, className = 'hl-link-id' }: { e: BusinessEventView; className?: string }) {
  if (!e.targetNo) return null;
  const href = targetHref(e);
  return href ? <Link className={className} to={href}>{e.targetNo}</Link> : <span className="mono">{e.targetNo}</span>;
}

// ───────────── 변경 전·후 ─────────────
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** JSON을 "경로 → 값 문자열" 표로 편다. 배열은 한 줄로 합친다. */
export function flattenJson(v: unknown, prefix = '', out: Map<string, string> = new Map()): Map<string, string> {
  if (isPlain(v)) {
    const keys = Object.keys(v);
    if (!keys.length && prefix) out.set(prefix, '{}');
    for (const k of keys) flattenJson(v[k], prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.set(prefix || '값', fmtValue(v));
  }
  return out;
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'boolean') return v ? '예' : '아니오';
  if (typeof v === 'number') return v.toLocaleString('en-US', { maximumFractionDigits: 6 });
  if (typeof v === 'string') return ISO_RE.test(v) ? fmtDateTime(v) : v === '' ? '(빈 값)' : v;
  if (Array.isArray(v)) return v.every((x) => x === null || ['string', 'number', 'boolean'].includes(typeof x)) ? (v.length ? v.map(fmtValue).join(', ') : '(없음)') : JSON.stringify(v);
  return JSON.stringify(v);
}

const keyLabel = (path: string) => path.split('.').map((k) => KEY_LABEL[k] ?? k).join(' › ');

export function DiffView({ before, after }: { before: unknown; after: unknown }) {
  const b = before === null || before === undefined ? null : flattenJson(before);
  const a = after === null || after === undefined ? null : flattenJson(after);
  if (!b && !a) return <span className="hl-muted" style={{ fontSize: 12 }}>기록된 변경값이 없어요 (요약만 남아 있어요)</span>;
  const keys = [...new Set([...(b?.keys() ?? []), ...(a?.keys() ?? [])])];
  return (
    <table className="be-diff">
      <thead>
        <tr><th>항목</th><th>변경 전</th><th aria-hidden="true" /><th>변경 후</th></tr>
      </thead>
      <tbody>
        {keys.map((k) => {
          const bv = b?.get(k);
          const av = a?.get(k);
          const changed = bv !== av;
          return (
            <tr key={k} className={changed ? 'is-changed' : undefined}>
              <td className="mono" title={k}>{keyLabel(k)}</td>
              <td className={bv === undefined ? 'hl-muted' : undefined}>{bv ?? '-'}</td>
              <td className="hl-muted"><i className="ic ic-arrow-right ic--sm" aria-hidden="true" /></td>
              <td className={av === undefined ? 'hl-muted' : undefined}>{changed ? <b>{av ?? '-'}</b> : av}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ───────────── 타임라인 한 줄 ─────────────
function dotClass(e: BusinessEventView): string {
  const tone = e.eventType === 'REJECTED_JUDGED' ? 'danger' : e.eventType === 'DISPOSITION_SET' ? 'wait' : e.actorType === 'USER' ? 'run' : '';
  return `hl-tl__dot${tone ? ` hl-tl__dot--${tone}` : ''}`;
}

const MAX_LOT_CHIPS = 12;

export function EventRow({ e, open, onToggle }: { e: BusinessEventView; open: boolean; onToggle: () => void }) {
  const [allLots, setAllLots] = useState(false);
  const lots = allLots ? e.lots : e.lots.slice(0, MAX_LOT_CHIPS);
  const href = targetHref(e);
  const detailId = `be-detail-${e.id}`;
  const dim = e.isLineageOnly;
  return (
    <div className={`hl-tl be-tl${dim ? ' is-lineage' : ''}`} style={{ paddingBottom: open ? 8 : 6 }}>
      <span className={dotClass(e)} style={{ marginTop: open ? 9 : 5 }} />
      <div className={open ? 'be-ev is-open' : 'be-ev'}>
        <div className="be-ev__row" role="button" tabIndex={0} aria-expanded={open} aria-controls={open ? detailId : undefined} onClick={(ev) => { if (!(ev.target as HTMLElement).closest('a,button')) onToggle(); }} onKeyDown={(ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === ev.currentTarget) { ev.preventDefault(); onToggle(); } }}>
          <time className="tnum hl-muted" dateTime={e.occurredAt} style={{ width: 38, fontSize: 12, flex: 'none' }}>{fmtHM(e.occurredAt)}</time>
          <ActorChip e={e} style={{ flex: 'none' }} />
          <span className="hl-evt" style={{ flex: 'none' }}>{e.eventTypeLabel}</span>
          <b className="be-ev__sum" title={e.summary}>{e.summary}</b>
          {dim ? <span className="hl-tag" style={{ flex: 'none' }} title="요청한 LOT이 아니라 상·하위 LOT의 이벤트예요">상·하위 LOT</span> : null}
          {e.reasonCode ? <span className="hl-tag" style={{ flex: 'none' }} title={e.reasonCode}>{REASON_CODE_LABEL[e.reasonCode] ?? e.reasonCode}</span> : null}
          {e.targetNo ? <span className="be-ev__target"><TargetLink e={e} /></span> : null}
          <span className="hl-cap mono" style={{ marginLeft: 'auto', flex: 'none' }}>#{e.id}</span>
          <i className={`ic ic-chevron-${open ? 'up' : 'down'} ic--sm hl-muted`} aria-hidden="true" style={{ flex: 'none' }} />
        </div>
        {open ? (
          <div id={detailId}>
            <div className="be-ev__grid">
              <div className="be-ev__cell">
                <span className="hl-label" style={{ fontWeight: 600 }}><i className="ic ic-history ic--sm" style={{ color: 'var(--brand)' }} /> 당시 기록</span>
                <dl className="hl-exec__kv">
                  <dt>주체</dt>
                  <dd>{e.actor ? <>{e.actor.employeeName}<span className="hl-muted"> · {e.actor.departmentName} {e.actor.jobGrade}</span></> : '시스템 (자동)'}</dd>
                  <dt>일시</dt>
                  <dd className="tnum">{fmtDateTime(e.occurredAt)}</dd>
                  <dt>유형</dt>
                  <dd>{e.eventTypeLabel}<span className="hl-muted"> · {TARGET_TYPE_LABEL[e.targetType] ?? e.targetType}</span></dd>
                  {e.targetNo ? <><dt>대상</dt><dd>{href ? <Link className="hl-link-id" to={href}>{e.targetNo}</Link> : <span className="mono">{e.targetNo}</span>}</dd></> : null}
                  {e.salesOrderId && e.salesOrderNo ? <><dt>수주</dt><dd><Link className="hl-link-id" to={`/sales-orders/${e.salesOrderId}`}>{e.salesOrderNo}</Link></dd></> : null}
                </dl>
              </div>
              <div className="be-ev__cell">
                <span className="hl-label" style={{ fontWeight: 600 }}>사유·근거</span>
                {e.reasonCode || e.reason ? (
                  <dl className="hl-exec__kv">
                    {e.reasonCode ? <><dt>사유 코드</dt><dd><span className="hl-tag">{REASON_CODE_LABEL[e.reasonCode] ?? e.reasonCode}</span> <span className="hl-muted mono">{e.reasonCode}</span></dd></> : null}
                    {e.reason ? <><dt>사유</dt><dd style={{ fontWeight: 400 }}>{e.reason}</dd></> : null}
                  </dl>
                ) : <span className="hl-muted" style={{ fontSize: 12 }}>기록된 사유가 없어요</span>}
                {e.actionDraftId || e.messageId ? (
                  <dl className="hl-exec__kv">
                    {e.messageId ? <><dt>원본 메시지</dt><dd className="mono">#{e.messageId}</dd></> : null}
                    {e.actionDraftId ? <><dt>초안</dt><dd><Link className="hl-link-id" to={`/action-drafts/${e.actionDraftId}`}>초안 #{e.actionDraftId}</Link></dd></> : null}
                  </dl>
                ) : null}
              </div>
              <div className="be-ev__cell be-ev__cell--diff">
                <span className="hl-label" style={{ fontWeight: 600 }}>변경 전 → 변경 후</span>
                <DiffView before={e.before} after={e.after} />
              </div>
            </div>
            <div className="be-ev__foot">
              <span className="hl-cap">관련 LOT</span>
              {lots.map((l) => <Link key={l.id} className="hl-link-id" to={traceHref(l.lotNo)} title={LOT_TYPE_LABEL[l.lotType]}>{l.lotNo}</Link>)}
              {!e.lots.length ? <span className="hl-cap">없음</span> : null}
              {e.lots.length > MAX_LOT_CHIPS ? (
                <button type="button" className="hl-btn hl-btn--ghost hl-btn--sm" onClick={() => setAllLots(!allLots)}>{allLots ? '접기' : `외 ${e.lots.length - MAX_LOT_CHIPS}개 더 보기`}</button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Legend(): ReactNode {
  return (
    <>
      <span className="hl-cap">범례</span>
      <span className="hl-row" style={{ gap: 4 }}><span className="hl-tl__dot hl-tl__dot--run" style={{ width: 12, height: 12 }} />사람이 한 일</span>
      <span className="hl-row" style={{ gap: 4 }}><span className="hl-tl__dot" style={{ width: 12, height: 12 }} />시스템 자동</span>
      <span className="hl-row" style={{ gap: 4 }}><span className="hl-tl__dot hl-tl__dot--wait" style={{ width: 12, height: 12 }} />처리 상태</span>
      <span className="hl-row" style={{ gap: 4 }}><span className="hl-tl__dot hl-tl__dot--danger" style={{ width: 12, height: 12 }} />불합격</span>
    </>
  );
}
