// 수주 화면(목록·등록·상세)이 함께 쓰는 작은 부품. 색·모양은 B안 그대로, 이름·표시명은 공통 코드 정의서·용어 사전대로.
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  ACTOR_TYPE_LABEL,
  ITEM_TYPE_LABEL,
  PRODUCTION_PLAN_STATUS_LABEL,
  RESERVATION_STATUS_LABEL,
  SALES_ORDER_ITEM_STATUS_LABEL,
  type ProductionPlanStatus,
  type ProductItemType,
  type ReservationStatus,
  type SalesOrderItemStatus,
} from '@/codes';
import { Badge, type BadgeTone } from '@/components/Badge';
import { Icon } from '@/components/Icon';
import { cn } from '@/lib/cn';
import { dLabel, fmtDate, fmtMDHM } from '@/lib/format';
import type { ProgressMeasure } from '@/lib/inventoryMath';
import { PRODUCTION_PLAN_STATUS_TONE, SALES_ORDER_ITEM_STATUS_TONE } from '@/lib/statusTone';
import type { TimelineEvent } from '@/api/salesOrders';
import { measureText, percentOf } from '@/features/sales/lib/salesOrderForm';

export const SALES_ORDER_STATUS_KEYS: readonly SalesOrderItemStatus[] = ['OPEN', 'PARTIALLY_SHIPPED', 'SHIPPED', 'CANCELLED'];

export function SalesOrderStatusBadge({ status }: { status: SalesOrderItemStatus }) {
  return <Badge tone={SALES_ORDER_ITEM_STATUS_TONE[status]}>{SALES_ORDER_ITEM_STATUS_LABEL[status]}</Badge>;
}

/** 납기 위험 (공통 코드 비고: 계산 표시값, 납기 위험 기준일은 생산 설정값) */
export function DueRiskBadge() {
  return (
    <Badge tone="danger" title="납기까지 남은 날이 납기 위험 기준일 이하인데 아직 출하가 끝나지 않았어요">
      납기 위험
    </Badge>
  );
}

export function PlanStatusBadge({ status }: { status: ProductionPlanStatus }) {
  return <Badge tone={PRODUCTION_PLAN_STATUS_TONE[status]}>{PRODUCTION_PLAN_STATUS_LABEL[status]}</Badge>;
}

const RESERVATION_TONE: Record<ReservationStatus, BadgeTone> = { ACTIVE: 'run', CONVERTED: 'ok', RELEASED: 'neutral' };

export function ReservationStatusBadge({ status }: { status: ReservationStatus }) {
  return (
    <Badge tone={RESERVATION_TONE[status]} title={status}>
      {RESERVATION_STATUS_LABEL[status]}
    </Badge>
  );
}

/** 납기: 2026-10-20 D-3. 위험이면 빨간색 + 경고 아이콘, 출하완료·취소면 날짜만 */
export function DueText({ dueDate, risk, done }: { dueDate: string | null; risk?: boolean; done?: boolean }) {
  if (!dueDate) return <span className="text-ink-3">-</span>;
  if (risk) {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-danger tabular-nums">
        <Icon name="alert" size="sm" />
        {fmtDate(dueDate)} {dLabel(dueDate)}
      </span>
    );
  }
  return (
    <span className="tabular-nums">
      {fmtDate(dueDate)} {done ? null : <span className="text-ink-3">{dLabel(dueDate)}</span>}
    </span>
  );
}

/** 매수 + 단위: 10매 */
export function Qty({ qty, unit, muted }: { qty: number; unit: string; muted?: boolean }) {
  return (
    <span className={cn('tabular-nums', muted && qty === 0 && 'text-ink-3')}>
      {qty.toLocaleString('en-US')}
      <small className="ml-px text-cap text-ink-3">{unit}</small>
    </span>
  );
}

/** 품목 이름: [1] 슬래브 SS275 슬래브 250×1200×10000 */
export function ItemLabel({ lineNo, itemType, itemName, itemCode }: { lineNo?: number; itemType: ProductItemType; itemName: string; itemCode?: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {lineNo !== undefined ? (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-xs bg-surface-3 px-1 text-cap font-semibold text-ink-2">{lineNo}</span>
      ) : null}
      <span className="text-cap text-ink-3">{ITEM_TYPE_LABEL[itemType]}</span>
      <span className="truncate font-medium">{itemName}</span>
      {itemCode ? <span className="truncate font-mono text-[11px] text-ink-3">{itemCode}</span> : null}
    </span>
  );
}

const MEASURE_FILL = { run: 'bg-run', ok: 'bg-ok', brand: 'bg-brand', muted: 'bg-chart-3' } as const;
export type MeasureTone = keyof typeof MEASURE_FILL;

/**
 * 충족 지표 하나: 막대 + "n / 분모" (업무 프로세스 4.5: 분모를 늘 함께 보이고 지표를 더하지 않는다).
 * 분모가 0이면 막대 대신 '-'.
 */
export function MeasureBar({ measure, unit, tone = 'run', label }: { measure: ProgressMeasure; unit: string; tone?: MeasureTone; label: string }) {
  const percent = percentOf(measure);
  return (
    <div className="flex min-w-[118px] flex-col gap-1" title={`${label} ${measureText(measure, unit)}`}>
      <span className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
        <b className="font-semibold">{measure.qty.toLocaleString('en-US')}</b>
        <span className="text-cap text-ink-3">
          / {measure.denominatorQty.toLocaleString('en-US')}
          {unit} · {percent === null ? '-' : `${percent}%`}
        </span>
      </span>
      <span
        role="progressbar"
        aria-label={`${label} ${measureText(measure, unit)}`}
        aria-valuemin={0}
        aria-valuemax={measure.denominatorQty}
        aria-valuenow={measure.qty}
        className="relative h-1.5 overflow-hidden rounded-[3px] bg-surface-3"
      >
        {/* 너비는 실행 중에 정해지는 값이라 style로 준다 */}
        <span className={cn('absolute inset-y-0 left-0 rounded-[3px]', MEASURE_FILL[tone])} style={{ width: `${percent ?? 0}%` }} />
      </span>
    </div>
  );
}

/** 작업 로그 주체: 시스템 / 사용자 이름 */
export function ActorChip({ event }: { event: Pick<TimelineEvent, 'actorType' | 'actorName'> }) {
  const isSystem = event.actorType === 'SYSTEM';
  return (
    <span
      className={cn(
        'inline-flex h-5 flex-none items-center rounded-xs px-1.5 text-cap font-semibold',
        isSystem ? 'bg-surface-3 text-ink-2' : 'bg-brand-tint text-brand',
      )}
      title={ACTOR_TYPE_LABEL[event.actorType]}
    >
      {isSystem ? ACTOR_TYPE_LABEL.SYSTEM : event.actorName}
    </span>
  );
}

/** 작업 로그 한 줄 (목록 미리보기·상세 옆 칸) */
export function EventLine({ event }: { event: TimelineEvent }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs" title={event.reasonText ?? undefined}>
      <time className="w-[70px] flex-none text-cap text-ink-3 tabular-nums">{fmtMDHM(event.occurredAt)}</time>
      <ActorChip event={event} />
      <span className="flex-none font-medium">{event.businessEventTypeLabel}</span>
      <span className="min-w-0 truncate text-ink-2">{event.targetNo ?? ''}</span>
    </div>
  );
}

export function SectionTitle({ children, meta }: { children: ReactNode; meta?: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <h3 className="text-sm font-semibold">{children}</h3>
      {meta ? <span className="text-cap text-ink-3">{meta}</span> : null}
    </div>
  );
}

export function PlanLink({ productionPlanId, productionPlanNo }: { productionPlanId: number; productionPlanNo: string }) {
  return (
    <Link href={`/production/plans?plan=${productionPlanId}`} className="font-mono text-xs font-medium text-run hover:underline">
      {productionPlanNo}
    </Link>
  );
}

export const businessEventsHref = (salesOrderId: number | null) =>
  salesOrderId === null ? '/business-events' : `/business-events?salesOrderId=${salesOrderId}`;
