// 이 LOT의 작업 로그 (business_event_lot 기준, 최근 것부터). 검사 등록·판정은 바뀐 측정값의 전·후를 함께 보인다 (REQ-QC-003).
// '작업 로그' 링크는 이 LOT의 이력 재현(/business-events?lotId=)으로 간다 (REQ-LOG-003).
import Link from 'next/link';
import type { TimelineEvent } from '@/api/businessEvents';
import { Card, CardBody, CardHead } from '@/components/Card';
import { EmptyNote } from '@/components/StateView';
import { Tag } from '@/components/Tag';
import { Timeline, type TimelineTone } from '@/components/Timeline';
import { INSPECTION_RESULT_LABEL } from '@/codes';
import { inspectionResultOfSnapshot, measuredValueChanges, trimNum, UNKNOWN_ITEM_NAME } from '@/features/quality/lib/qualityDisplay';
import { fmtMDHM } from '@/lib/format';

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

function InspectionChange({ event, itemNames }: { event: TimelineEvent; itemNames: Readonly<Record<string, string>> }) {
  const before = inspectionResultOfSnapshot(event.beforeData);
  const after = inspectionResultOfSnapshot(event.afterData);
  const changes = measuredValueChanges(event.beforeData, event.afterData);
  return (
    <div className="flex flex-col gap-0.5 text-cap text-ink-2">
      {after ? (
        <span>
          {/* 칸 이름 "판정"과 값 "판정 대기"가 붙으면 "판정 판정 대기"로 읽힌다: 쌍점으로 나눈다 */}
          <span className="text-ink-3">판정 결과:</span> {before && before !== after ? `${INSPECTION_RESULT_LABEL[before]} → ` : ''}
          <b className="font-semibold">{INSPECTION_RESULT_LABEL[after]}</b>
        </span>
      ) : null}
      {changes.slice(0, 6).map((c) => (
        <span key={c.inspectionItemCode} className="tabular-nums">
          {/* 처음 넣은 값은 이전 값이 없어 "— → 0.06"처럼 보였다: 그때는 값만, 고친 값이면 이전 → 이후 */}
          {`${itemNames[c.inspectionItemCode] ?? UNKNOWN_ITEM_NAME} ${c.before === null ? '' : `${trimNum(c.before)} → `}${c.after === null ? '—' : trimNum(c.after)}`}
        </span>
      ))}
      {changes.length > 6 ? <span>그 밖에 {changes.length - 6}개 항목</span> : null}
    </div>
  );
}

export function LotHistoryCard({
  lotId,
  events,
  itemNames,
  limit = 8,
  petKey,
}: {
  lotId: number;
  events: readonly TimelineEvent[];
  /** 검사 항목 코드 → 검사 항목명 (api가 작업 로그에서 모은 것) */
  itemNames: Readonly<Record<string, string>>;
  limit?: number;
  /** 화면 도우미 펫 설명 키 (검사 입력·불합격 관리가 따로 준다) */
  petKey?: string;
}) {
  const recent = [...events].reverse().slice(0, limit);
  return (
    <Card className="flex-none" petKey={petKey}>
      <CardHead
        title="이력"
        meta={`이 LOT의 작업 로그 ${events.length}건`}
        actions={
          <Link href={`/business-events?lotId=${lotId}`} className="text-cap text-run hover:underline">
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
              // Timeline은 공유 컴포넌트라 기록 한 줄의 제목 칸에 화면 도우미 펫 항목 속성(data-pet-item)을 단다
              title: (
                <span className="flex flex-wrap items-center gap-1.5" data-pet-item="businessEvent" data-pet-item-title={event.eventNo}>
                  <span className="inline-flex" data-pet-field="주체">
                    {/* Tag는 글자만 받으면 그 글자를 펫 용어(data-pet-term)로 단다. 사람 이름은 용어가 아니라 이 기록의 값이라 요소로 감싸 넘긴다 */}
                    <Tag size="sm" tone={event.actorType === 'SYSTEM' ? 'run' : 'outline'}>
                      <span>{event.actorName}</span>
                    </Tag>
                  </span>
                  <b className="font-semibold" data-pet-field="작업">
                    {event.businessEventTypeLabel}
                  </b>
                  {event.targetNo ? (
                    <span className="font-mono text-cap text-ink-3" data-pet-field="대상">
                      {event.targetNo}
                    </span>
                  ) : null}
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
