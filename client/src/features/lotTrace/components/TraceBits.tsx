// LOT 추적·작업 로그가 함께 쓰는 작은 부품: LOT 종류 아이콘, 판정·LOT 상태·출하요청 상태 배지, 번호 링크, 기간 표시.
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  INSPECTION_RESULT_LABEL,
  LOT_STATUS_LABEL,
  SHIPMENT_REQUEST_STATUS_LABEL,
  type InspectionResult,
  type LotStatus,
  type LotType,
  type ShipmentRequestStatus,
} from '@/codes';
import { Badge, type BadgeTone } from '@/components/Badge';
import { Icon, type IconName } from '@/components/Icon';
import { cn } from '@/lib/cn';
import { fmtDateTime, fmtHM, fmtMD, fmtMDHM } from '@/lib/format';

export const LOT_TYPE_ICON: Record<LotType, IconName> = {
  RAW_MATERIAL: 'box',
  HOT_METAL: 'flow',
  HEAT: 'flame',
  SLAB: 'slab',
  COIL: 'coil',
};

export function LotTypeIcon({ type, className }: { type: LotType; className?: string }) {
  return <Icon name={LOT_TYPE_ICON[type]} size="sm" className={className} />;
}

const INSPECTION_TONE: Record<InspectionResult, BadgeTone> = { PASS: 'ok', FAIL: 'danger', PENDING: 'wait' };

export function InspectionBadge({ result }: { result: InspectionResult | null }) {
  if (!result) return null;
  return <Badge tone={INSPECTION_TONE[result]}>{INSPECTION_RESULT_LABEL[result]}</Badge>;
}

const LOT_STATUS_TONE: Record<LotStatus, BadgeTone> = { AVAILABLE: 'ok', CONSUMED: 'neutral', SHIPPED: 'run' };

export function LotStatusBadge({ status }: { status: LotStatus }) {
  return <Badge tone={LOT_STATUS_TONE[status]}>{LOT_STATUS_LABEL[status]}</Badge>;
}

const SHIPMENT_TONE: Record<ShipmentRequestStatus, BadgeTone> = { REQUESTED: 'wait', ALLOCATED: 'run', ISSUED: 'ok', CANCELLED: 'neutral' };

export function ShipmentStatusBadge({ status }: { status: ShipmentRequestStatus }) {
  return <Badge tone={SHIPMENT_TONE[status]}>{SHIPMENT_REQUEST_STATUS_LABEL[status]}</Badge>;
}

/** 업무 번호·LOT 번호 링크 (옛 hl-link-id) */
export function LinkId({ href, title, className, children }: { href: string; title?: string; className?: string; children: ReactNode }) {
  return (
    <Link href={href} title={title} className={cn('font-mono text-mono text-run no-underline hover:underline', className)}>
      {children}
    </Link>
  );
}

/** 번호만 (링크 없음) */
export function MonoId({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn('font-mono text-mono', className)}>{children}</span>;
}

/** '기간 기반' 연결의 시간 범위: 같은 날이면 `10-01 09:00 ~ 15:00`. full이면 연도까지. */
export function fmtPeriod(start: string | null, end: string | null, full = false): string {
  if (!start && !end) return '-';
  if (!start || !end) return fmtDateTime(start ?? end);
  const sameDay = fmtMD(start) === fmtMD(end);
  if (full) return sameDay ? `${fmtDateTime(start)} ~ ${fmtHM(end)}` : `${fmtDateTime(start)} ~ ${fmtDateTime(end)}`;
  return sameDay ? `${fmtMDHM(start)} ~ ${fmtHM(end)}` : `${fmtMDHM(start)} ~ ${fmtMDHM(end)}`;
}

/** 상세 칸의 소제목 묶음 (옛 lt-sec) */
export function PanelSection({ title, meta, children }: { title: ReactNode; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-1.5 border-t border-line pt-2.5">
      <div className="flex items-center gap-2 text-[12.5px]">
        <b className="font-semibold">{title}</b>
        {meta ? <span className="ml-auto text-cap text-ink-3">{meta}</span> : null}
      </div>
      {children}
    </section>
  );
}
