'use client';

// 작업 로그 타임라인 (다시 쓰는 부품). 이력 재현(REQ-LOG-003)은 수주·LOT을 넘기면 오래된 순, 같은 시각은 id 순으로 보인다.
// 수주 상세의 '이력' 탭에서도 그대로 쓴다: <EventTimeline filter={{ salesOrderId }} />
import { Fragment, useMemo, useState } from 'react';
import { ACTOR_TYPE_LABEL, INSPECTION_RESULT_LABEL } from '@/codes';
import { BUSINESS_EVENT_PAGE_SIZE, type BusinessEventFilter, type BusinessEventPage, type BusinessEventView } from '@/api/businessEvents';
import { Button } from '@/components/Button';
import { ComingSoon } from '@/components/ComingSoon';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote, Spinner } from '@/components/StateView';
import { EventRow } from '@/features/businessEvents/components/EventRow';
import { EVENT_TONE_DOT } from '@/features/businessEvents/lib/eventTone';
import { useBusinessEvents } from '@/hooks/useBusinessEvents';
import { cn } from '@/lib/cn';
import { fmtDate } from '@/lib/format';
import { SEOUL_TIME_ZONE } from '@/lib/seoulDate';

const WEEKDAY = new Intl.DateTimeFormat('ko-KR', { timeZone: SEOUL_TIME_ZONE, weekday: 'short' });

interface DayGroup {
  day: string;
  label: string;
  items: BusinessEventView[];
}

function groupByDay(events: readonly BusinessEventView[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const event of events) {
    const day = fmtDate(event.occurredAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(event);
    else groups.push({ day, label: `${day} (${WEEKDAY.format(new Date(event.occurredAt))})`, items: [event] });
  }
  return groups;
}

/** 점 색 범례 (화면 공통) */
export function EventLegend() {
  const dot = (tone: keyof typeof EVENT_TONE_DOT) => <span className={cn('size-3 rounded-full border-2', EVENT_TONE_DOT[tone])} />;
  return (
    <span className="inline-flex flex-wrap items-center gap-3 text-xs">
      <span className="text-cap text-ink-3">범례</span>
      <span className="inline-flex items-center gap-1">
        {dot('run')}
        {ACTOR_TYPE_LABEL.USER}
      </span>
      <span className="inline-flex items-center gap-1">
        {dot('neutral')}
        {ACTOR_TYPE_LABEL.SYSTEM}
      </span>
      <span className="inline-flex items-center gap-1">
        {dot('danger')}
        {INSPECTION_RESULT_LABEL.FAIL}
      </span>
      <span className="inline-flex items-center gap-1">
        AI 경유 <ComingSoon grade="P2" />
      </span>
    </span>
  );
}

/** 이미 불러온 작업 로그를 날짜별로 그린다 */
export function EventList({ page, showSalesOrder = true, emptyText }: { page: BusinessEventPage; showSalesOrder?: boolean; emptyText?: string }) {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const groups = useMemo(() => groupByDay(page.items), [page.items]);
  const toggle = (id: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  if (!page.items.length) return <EmptyNote>{emptyText ?? (page.sort === 'asc' ? '이 수주·LOT에 기록된 작업 로그가 없어요' : '조건에 맞는 작업 로그가 없어요')}</EmptyNote>;
  return (
    <div className="flex flex-col">
      {groups.map((group, index) => (
        <Fragment key={group.day}>
          <div className={cn('mb-1.5 flex items-center gap-2 text-cap font-semibold text-ink-3 after:h-px after:flex-1 after:bg-line after:content-[\'\']', index > 0 && 'mt-1')}>
            {group.label}
          </div>
          <ol className="m-0 flex list-none flex-col p-0">
            {group.items.map((event) => (
              <EventRow key={event.id} event={event} open={open.has(event.id)} onToggle={() => toggle(event.id)} showSalesOrder={showSalesOrder} />
            ))}
          </ol>
        </Fragment>
      ))}
    </div>
  );
}

export interface EventTimelineProps {
  /** 수주(salesOrderId)·LOT(lotId)을 넘기면 이력 재현, 아니면 최신순 목록. limit은 이 부품이 관리한다. */
  filter: Omit<BusinessEventFilter, 'limit'>;
  emptyText?: string;
  className?: string;
}

export function EventTimeline({ filter, emptyText, className }: EventTimelineProps) {
  const [limit, setLimit] = useState(BUSINESS_EVENT_PAGE_SIZE);
  const query = useBusinessEvents({ ...filter, limit });
  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <QueryBoundary query={query} loadingLabel="작업 로그를 불러오는 중…">
        {(page) => (
          <>
            <EventList page={page} showSalesOrder={filter.salesOrderId === undefined} emptyText={emptyText} />
            {page.total > page.items.length ? (
              <Button size="sm" className="mx-auto mt-1 mb-2" disabled={query.isFetching} onClick={() => setLimit(limit + BUSINESS_EVENT_PAGE_SIZE)}>
                {query.isFetching ? <Spinner label="불러오는 중…" /> : `더 보기 (${page.total - page.items.length}건 남음)`}
              </Button>
            ) : null}
          </>
        )}
      </QueryBoundary>
    </div>
  );
}

