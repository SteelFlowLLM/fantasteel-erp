// LOT 추적 화면이 나눠 쓰는 작은 부품·표시 규칙.
import { Link } from 'react-router';
import type { InspectionResult, LotStatus, LotType } from '@fantasteel/shared';
import { Badge, Icon, type Tone } from '@/components/ui';
import { fmtDateTime, fmtHM, fmtMDHM, fmtMD } from '@/lib/format';

export const LOT_ICON: Record<LotType, string> = { RAW_MATERIAL: 'box', HOT_METAL: 'flow', HEAT: 'flame', SLAB: 'slab', COIL: 'coil' };

export function LotTypeIcon({ type, size = 'sm' }: { type: LotType; size?: 'sm' | 'lg' }) {
  return <Icon name={LOT_ICON[type]} size={size} />;
}

const INSPECTION_TONE: Record<InspectionResult, Tone> = { PASS: 'ok', FAIL: 'danger', PENDING: 'wait' };
export function InspectionBadge({ result, label }: { result: InspectionResult | null; label?: string | null }) {
  if (!result) return null;
  return <Badge tone={INSPECTION_TONE[result]}>{label ?? result}</Badge>;
}

const STATUS_TONE: Record<LotStatus, Tone> = { IN_STOCK: 'ok', CONSUMED: 'neutral', SHIPPED: 'run' };
export function LotStatusBadge({ status, label }: { status: LotStatus; label: string }) {
  return <Badge tone={STATUS_TONE[status]}>{label}</Badge>;
}

/** LOT 추적 화면 주소. direction을 생략하면 화면이 LOT 종류에 맞춰 고른다. */
export const traceHref = (lotNo: string, direction?: 'backward' | 'forward') =>
  `/lots/trace?lot=${encodeURIComponent(lotNo)}${direction ? `&direction=${direction}` : ''}`;

export function LotLinkId({ lotNo, direction, className = 'hl-link-id' }: { lotNo: string; direction?: 'backward' | 'forward'; className?: string }) {
  return <Link className={className} to={traceHref(lotNo, direction)}>{lotNo}</Link>;
}

/** "기간 기반" 연결의 시간 범위: 같은 날이면 `09-20 19:00 ~ 03:00`, 아니면 양쪽 날짜. full이면 연도까지. */
export function fmtPeriod(start: string | null, end: string | null, full = false): string {
  if (!start && !end) return '-';
  if (!start || !end) return fmtDateTime(start ?? end);
  const sameDay = fmtMD(start) === fmtMD(end);
  if (full) return sameDay ? `${fmtDateTime(start)} ~ ${fmtHM(end)}` : `${fmtDateTime(start)} ~ ${fmtDateTime(end)}`;
  return sameDay ? `${fmtMDHM(start)} ~ ${fmtHM(end)}` : `${fmtMDHM(start)} ~ ${fmtMDHM(end)}`;
}
