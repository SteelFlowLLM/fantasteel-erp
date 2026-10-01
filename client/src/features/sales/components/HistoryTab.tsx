'use client';

// 수주 상세 · 이력 탭 (REQ-LOG-003): 이 수주의 작업 로그를 시간순으로. 전체 검색·필터는 작업 로그 화면에서 한다.
import Link from 'next/link';
import type { TimelineEvent } from '@/api/salesOrders';
import { ButtonLink } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote } from '@/components/StateView';
import { Timeline, type TimelineTone } from '@/components/Timeline';
import { useSalesOrderTimeline } from '@/hooks/useSalesOrders';
import { fmtDateTime } from '@/lib/format';
import { ActorChip, businessEventsHref } from '@/features/sales/components/SalesOrderParts';

const toneOf = (event: TimelineEvent): TimelineTone => {
  const type = event.businessEventType;
  if (type.endsWith('CANCELLED') || type.endsWith('REJECTED')) return 'danger';
  if (type.endsWith('RELEASED')) return 'neutral';
  if (type.startsWith('DRAFT_')) return 'ai';
  if (type.endsWith('CONFIRMED') || type.endsWith('ISSUED') || type.endsWith('CONVERTED')) return 'ok';
  if (type.startsWith('REPRODUCTION') || type === 'SURPLUS_CONVERTED') return 'wait';
  return 'run';
};

export function HistoryTab({ salesOrderId }: { salesOrderId: number }) {
  const timeline = useSalesOrderTimeline(salesOrderId);
  return (
    <Card>
      <CardHead
        title="이력"
        meta="시간순 · 이 수주에 남은 작업 로그"
        actions={
          <ButtonLink size="sm" icon="history" href={businessEventsHref(salesOrderId)}>
            작업 로그에서 보기
          </ButtonLink>
        }
      />
      <CardBody>
        <QueryBoundary query={timeline} loadingLabel="이력을 불러오는 중…">
          {(events) =>
            events.length === 0 ? (
              <EmptyNote>기록된 작업이 없어요</EmptyNote>
            ) : (
              <Timeline
                items={events.map((event) => ({
                  key: event.id,
                  tone: toneOf(event),
                  time: `${fmtDateTime(event.occurredAt)} · ${event.eventNo}`,
                  title: (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <ActorChip event={event} />
                      <b className="font-semibold">{event.businessEventTypeLabel}</b>
                      {event.targetNo ? <span className="font-mono text-xs text-ink-2">{event.targetNo}</span> : null}
                    </span>
                  ),
                  body:
                    event.reasonText || event.lotNos.length > 0 ? (
                      <span className="flex flex-col gap-0.5 text-xs text-ink-2">
                        {event.reasonText ? <span title={event.reasonCode ?? undefined}>{event.reasonText}</span> : null}
                        {event.lotNos.length > 0 ? (
                          <span className="flex flex-wrap gap-x-2">
                            <span className="text-ink-3">LOT</span>
                            {event.lotNos.map((lotNo) => (
                              <Link key={lotNo} href={`/lots/trace?lot=${encodeURIComponent(lotNo)}`} className="font-mono text-run hover:underline">
                                {lotNo}
                              </Link>
                            ))}
                          </span>
                        ) : null}
                      </span>
                    ) : undefined,
                }))}
              />
            )
          }
        </QueryBoundary>
      </CardBody>
    </Card>
  );
}
