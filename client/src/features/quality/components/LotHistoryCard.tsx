// 이 LOT의 작업 로그 (business_event_lot 기준, 최근 것부터). 검사 등록·판정은 바뀐 측정값의 전·후를 함께 보인다 (REQ-QC-003).
import Link from 'next/link';
import { Card, CardBody, CardHead } from '@/components/Card';
import { EmptyNote } from '@/components/StateView';
import { Tag } from '@/components/Tag';
import { Timeline, type TimelineTone } from '@/components/Timeline';
import { INSPECTION_RESULT_LABEL } from '@/codes';
import { inspectionResultOfSnapshot, measuredValueChanges, trimNum } from '@/features/quality/lib/qualityDisplay';
import { fmtMDHM } from '@/lib/format';
import type { TimelineEvent } from '@/mock/services';

const toneOf = (event: TimelineEvent): TimelineTone => {
  switch (event.businessEventType) {
    case 'INSPECTION_REGISTERED': {
      const result = inspectionResultOfSnapshot(event.afterData);
      return result === 'FAIL' ? 'danger' : result === 'PASS' ? 'ok' : 'wait';
    }
    case 'RESERVATION_CREATED':
      return 'ok';
    case 'RESERVATION_RELEASED':
    case 'ALLOCATION_RELEASED':
      return 'wait';
    case 'DISPOSITION_SET':
      return 'run';
    default:
      return 'neutral';
  }
};

function InspectionChange({ event, itemNames }: { event: TimelineEvent; itemNames: ReadonlyMap<string, string> }) {
  const before = inspectionResultOfSnapshot(event.beforeData);
  const after = inspectionResultOfSnapshot(event.afterData);
  const changes = measuredValueChanges(event.beforeData, event.afterData);
  return (
    <div className="flex flex-col gap-0.5 text-cap text-ink-2">
      {after ? (
        <span>
          판정 {before && before !== after ? `${INSPECTION_RESULT_LABEL[before]} → ` : ''}
          <b className="font-semibold">{INSPECTION_RESULT_LABEL[after]}</b>
        </span>
      ) : null}
      {changes.slice(0, 6).map((c) => (
        <span key={c.inspectionItemCode} className="tabular-nums">
          {itemNames.get(c.inspectionItemCode) ?? c.inspectionItemCode} {c.before === null ? '—' : trimNum(c.before)} → {c.after === null ? '—' : trimNum(c.after)}
        </span>
      ))}
      {changes.length > 6 ? <span>그 밖에 {changes.length - 6}개 항목</span> : null}
    </div>
  );
}

export function LotHistoryCard({ events, itemNames = new Map(), limit = 8 }: { events: readonly TimelineEvent[]; itemNames?: ReadonlyMap<string, string>; limit?: number }) {
  const recent = [...events].reverse().slice(0, limit);
  return (
    <Card className="flex-none">
      <CardHead
        title="이력"
        meta={`이 LOT의 작업 로그 ${events.length}건`}
        actions={
          <Link href="/business-events" className="text-cap text-run hover:underline">
            작업 로그
          </Link>
        }
      />
      <CardBody className="pb-1">
        {recent.length === 0 ? (
          <EmptyNote>기록된 작업 로그가 없어요</EmptyNote>
        ) : (
          <Timeline
            items={recent.map((event) => ({
              key: event.id,
              tone: toneOf(event),
              time: `${fmtMDHM(event.occurredAt)} · ${event.eventNo}`,
              title: (
                <span className="flex flex-wrap items-center gap-1.5">
                  <Tag size="sm" tone={event.actorType === 'SYSTEM' ? 'run' : 'outline'}>
                    {event.actorName}
                  </Tag>
                  <b className="font-semibold">{event.businessEventTypeLabel}</b>
                  {event.targetNo ? <span className="font-mono text-cap text-ink-3">{event.targetNo}</span> : null}
                </span>
              ),
              body: (
                <>
                  {event.businessEventType === 'INSPECTION_REGISTERED' ? <InspectionChange event={event} itemNames={itemNames} /> : null}
                  {event.reasonText ? <span className="text-cap text-ink-2">{event.reasonText}</span> : null}
                </>
              ),
            }))}
          />
        )}
      </CardBody>
    </Card>
  );
}
