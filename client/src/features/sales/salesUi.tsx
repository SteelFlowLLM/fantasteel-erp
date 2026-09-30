// 수주 화면(목록·등록·상세)이 나눠 쓰는 부품과 훅. 모양은 v1 B안(s10~s12)의 클래스·색을 그대로 쓴다.
import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { ITEM_TYPE_LABEL, LOT_STATUS_LABEL, PRODUCTION_PLAN_STATUS_LABEL, SALES_ORDER_STATUS_LABEL, type LotStatus, type ProductionPlanStatus, type SalesOrderStatus } from '@fantasteel/shared';
import { businessEventApi, type BusinessEventView } from '@/api/businessEvents';
import { lookupApi } from '@/api/lookups';
import { salesOrderApi, type SalesOrderItemView, type SalesOrderView } from '@/api/salesOrders';
import { Badge, Icon, type Tone } from '@/components/ui';
import { useAction } from '@/hooks/useApi';
import { fmtDims, fmtMDHM } from '@/lib/format';

/** 충족 막대 색 (v1 g-sales COLOR 그대로). */
export const FILL_COLOR = {
  reserved: '#23507F', inProd: '#9DB6D1', passed: '#17794A', shipped: '#173A5E', rest: '#EEF1F4',
  need: '#F5D9B8',
} as const;

export const STATUS_TONE: Record<SalesOrderStatus, Tone> = {
  REGISTERED: 'neutral', IN_PROGRESS: 'run', PARTIALLY_SHIPPED: 'wait', SHIPPED: 'ok', CANCELLED: 'danger',
};
export const STATUS_KEYS: SalesOrderStatus[] = ['REGISTERED', 'IN_PROGRESS', 'PARTIALLY_SHIPPED', 'SHIPPED', 'CANCELLED'];

export function StatusBadge({ status }: { status: SalesOrderStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{SALES_ORDER_STATUS_LABEL[status]}</Badge>;
}
export function RiskBadge() {
  return <Badge tone="danger" title="납기가 가까운데 아직 출하가 끝나지 않았어요 (규칙으로 판단해요)">납기 위험</Badge>;
}

/** 서버가 준 남은 일수로 만든 라벨: D-3 / D-day / D+2 */
export const dueLabel = (daysToDue: number) => (daysToDue === 0 ? 'D-day' : daysToDue > 0 ? `D-${daysToDue}` : `D+${-daysToDue}`);

/** 품목들의 수량 단위. 슬래브(매)와 코일(개)이 섞이면 "매·개". */
export function unitOf(items: { qtyUnit: string }[]): string {
  const units = [...new Set(items.map((i) => i.qtyUnit))];
  return units.length === 1 ? units[0] : units.length ? '매·개' : '매';
}

export const sumOf = <T,>(rows: T[], pick: (r: T) => number) => rows.reduce((s, r) => s + pick(r), 0);

export function LockHint({ children }: { children: ReactNode }) {
  return <span className="hl-lockhint"><Icon name="lock" size="sm" />{children}</span>;
}

/** 수량 + 단위: 10매 */
export function Qty({ n, unit, ok, muted }: { n: number; unit: string; ok?: boolean; muted?: boolean }) {
  if (muted && !n) return <span className="hl-muted">0{unit}</span>;
  return <span className={`hl-sheets${ok ? ' hl-ok-text' : ''}`}>{n.toLocaleString('en-US')}<small>{unit}</small></span>;
}

/** 진행률 막대 (서버가 준 % 그대로, 소수는 버림 표시). */
export function ProgressCell({ rate, risk, barStyle }: { rate: number; risk?: boolean; barStyle?: CSSProperties }) {
  const v = Math.max(0, Math.min(100, rate));
  const tone = v >= 100 ? 'ok' : risk ? 'danger' : '';
  return (
    <div className="hl-progress-cell">
      <div className={`hl-progress${tone ? ` hl-progress--${tone}` : ''}`} style={barStyle}><span style={{ width: `${v}%` }} /></div>
      <b className={tone === 'ok' ? 'hl-ok-text' : tone === 'danger' ? 'hl-danger-text' : undefined}>{Math.floor(v)}%</b>
    </div>
  );
}

const w = (n: number, qty: number) => `${qty ? Math.min(100, (n / qty) * 100) : 0}%`;

/** 품목 충족 누적 막대: 예약 / 생산중 / 검사합격 / 출하 (합이 주문 수량을 넘지 않는다 — 서버 규칙). */
export function FulfillStack({ it, height = 14 }: { it: SalesOrderItemView; height?: number }) {
  const q = it.orderedQty;
  return (
    <div className="hl-stack" style={{ height }} role="img" aria-label={`주문 ${q} 중 예약 ${it.reservedQty}, 생산중 ${it.inProductionQty}, 검사합격 ${it.passedQty}, 출하 ${it.shippedQty}`}>
      {it.reservedQty ? <span style={{ width: w(it.reservedQty, q), background: FILL_COLOR.reserved }} /> : null}
      {it.inProductionQty ? <span style={{ width: w(it.inProductionQty, q), background: FILL_COLOR.inProd }} /> : null}
      {it.passedQty ? <span style={{ width: w(it.passedQty, q), background: FILL_COLOR.passed }} /> : null}
      {it.shippedQty ? <span style={{ width: w(it.shippedQty, q), background: FILL_COLOR.shipped, opacity: 0.35 }} /> : null}
    </div>
  );
}

export function FulfillLegend({ style }: { style?: CSSProperties }) {
  return (
    <div className="hl-legend" style={style}>
      <span><i style={{ background: FILL_COLOR.reserved }} />예약</span>
      <span><i style={{ background: FILL_COLOR.inProd }} />생산중</span>
      <span><i style={{ background: FILL_COLOR.passed }} />검사합격</span>
      <span><i style={{ background: FILL_COLOR.shipped, opacity: 0.35 }} />출하</span>
      <span><i style={{ background: FILL_COLOR.rest, boxShadow: 'inset 0 0 0 1px #C3CBD4' }} />남음</span>
    </div>
  );
}

/** 품목 이름: [1] 슬래브 SS275 250 × 1,200 × 10,000 */
export function ItemTitle({ it }: { it: Pick<SalesOrderItemView, 'lineNo' | 'itemType' | 'steelGradeCode' | 'thicknessMm' | 'widthMm' | 'lengthMm'> }) {
  return (
    <>
      <span className="hl-tag">{it.lineNo}</span>{' '}
      {ITEM_TYPE_LABEL[it.itemType]}{' '}
      <span className="mono">{it.steelGradeCode}</span>{' '}
      {fmtDims(it.thicknessMm, it.widthMm, it.lengthMm)}
    </>
  );
}

/** 품목 요약: "슬래브 SS275 250 × 1,200 × 10,000 10매" / "슬래브 SS275 5매 + 코일 SS275 4개" */
export function SummaryCell({ items }: { items: SalesOrderItemView[] }) {
  if (items.length === 1) {
    const s = items[0];
    return <>{ITEM_TYPE_LABEL[s.itemType]} <span className="mono">{s.steelGradeCode}</span> {fmtDims(s.thicknessMm, s.widthMm, s.lengthMm)} {s.orderedQty}{s.qtyUnit}</>;
  }
  return (
    <>
      {items.map((s, i) => (
        <Fragment key={s.id}>
          {i ? ' + ' : ''}
          {ITEM_TYPE_LABEL[s.itemType]} <span className="mono">{s.steelGradeCode}</span> {s.orderedQty}{s.qtyUnit}
        </Fragment>
      ))}
    </>
  );
}

export function ActorChip({ e }: { e: BusinessEventView }) {
  return <span className={`hl-actor hl-actor--${e.actorType === 'SYSTEM' ? 'system' : 'user'}`}>{e.actorLabel}</span>;
}

/** 작업 로그 한 줄 (목록 미리보기·상세 옆 칸). */
export function EventLine({ e }: { e: BusinessEventView }) {
  return (
    <div className="hl-row" style={{ fontSize: 12, gap: 6 }} title={e.reason ?? e.summary}>
      <time className="hl-cap tnum" style={{ width: 64, flex: 'none' }}>{fmtMDHM(e.occurredAt)}</time>
      <ActorChip e={e} />
      <span className="hl-evt">{e.eventTypeLabel}</span>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.summary}</span>
    </div>
  );
}

/** 수주 헤더의 납기 표시: 09-30 D-3 (위험이면 빨간색 + 경고 아이콘). */
export function DueCell({ o, date }: { o: Pick<SalesOrderView, 'dueDate' | 'daysToDue' | 'isDeliveryRisk' | 'salesOrderStatus'>; date: string }) {
  const done = o.salesOrderStatus === 'SHIPPED' || o.salesOrderStatus === 'CANCELLED';
  if (o.isDeliveryRisk) return <span className="hl-risk tnum"><Icon name="alert" size="sm" />{date} {dueLabel(o.daysToDue)}</span>;
  if (done) return <span className="tnum">{date}</span>;
  return <span className="tnum">{date} <span className="hl-muted">{dueLabel(o.daysToDue)}</span></span>;
}

// ───────────── 생산 연결 (생산계획·LOT) ─────────────
export const planTone = (s: string): Tone => (s === 'COMPLETED' ? 'ok' : s === 'CANCELLED' ? 'danger' : s === 'PLANNED' ? 'wait' : 'run');
export const planLabel = (s: string) => PRODUCTION_PLAN_STATUS_LABEL[s as ProductionPlanStatus] ?? s;

type LotState = { lotStatus: string; isPassed: boolean | null; heatNo: string | null; isHeatPassed: boolean | null };
const lotFailed = (l: LotState) => l.isPassed === false || l.isHeatPassed === false;
const lotPending = (l: LotState) => l.isPassed === null || (l.heatNo !== null && l.isHeatPassed === null);
/** LOT 상태 라벨: 불합격 > 출고·투입 > 검사 대기 > 합격 (자기 검사 + 상위 히트 성분 검사). */
export function lotLabel(l: LotState): string {
  if (lotFailed(l)) return '불합격';
  if (l.lotStatus !== 'IN_STOCK') return LOT_STATUS_LABEL[l.lotStatus as LotStatus] ?? l.lotStatus;
  return lotPending(l) ? '검사 대기' : '합격';
}
export function lotTone(l: LotState): Tone {
  if (lotFailed(l)) return 'danger';
  if (l.lotStatus !== 'IN_STOCK') return 'neutral';
  return lotPending(l) ? 'wait' : 'ok';
}
export const lotHref = (lotNo: string) => `/lots/trace?lot=${encodeURIComponent(lotNo)}`;
export const planHref = (planId: number) => `/production/plans?plan=${planId}`;

// ───────────── 훅 ─────────────
export function useLookups() {
  return useQuery({ queryKey: ['master-data', 'lookups'], queryFn: lookupApi.get, staleTime: 60_000 });
}

/** 수주의 최근 작업 로그 (최근순). */
export function useOrderEvents(salesOrderId: number | null, limit: number) {
  return useQuery({
    queryKey: ['business-events', 'sales-order', salesOrderId, limit],
    queryFn: () => businessEventApi.list({ salesOrderId: salesOrderId!, order: 'desc', limit }),
    enabled: salesOrderId !== null,
  });
}

/** 업무방 버튼: 수주 업무방을 찾거나 만들고(부른 사람을 멤버로 넣고) 메신저로 간다. */
export function WorkRoomButton({ salesOrderId, className = 'hl-btn hl-btn--sm', children }: { salesOrderId: number; className?: string; children?: ReactNode }) {
  const navigate = useNavigate();
  const open = useAction((id: number) => salesOrderApi.openWorkRoom(id), {
    invalidate: ['chat-rooms'],
    onSuccess: (room) => navigate(`/messenger?room=${room.id}`),
  });
  return (
    <button type="button" className={className} disabled={open.isPending} onClick={() => open.mutate(salesOrderId)}>
      {children ?? <><Icon name="hash" />업무방</>}
    </button>
  );
}

export const eventsHref = (salesOrderId: number) => `/business-events?salesOrderId=${salesOrderId}`;
export const shipmentNewHref = (salesOrderId: number) => `/shipment-requests/new?salesOrderId=${salesOrderId}`;

export function OrderNoLink({ o, style }: { o: Pick<SalesOrderView, 'id' | 'salesOrderNo'>; style?: CSSProperties }) {
  return <Link className="hl-link-id" to={`/sales-orders/${o.id}`} style={style}>{o.salesOrderNo}</Link>;
}
