// 최근 작업 로그 (REQ-DSH-001): 최신 작업 로그 20건. 주체(사용자 이름 / '시스템') · 이벤트 · 대상 번호 · 사유.
// 시각은 날짜·시각으로 보인다("4일 전"이 줄마다 같아 구분되지 않았다). 바로 이어진 같은 주체·같은 작업은 한 줄로 묶어 ×건수를 붙인다.
import type { RecentEventsData } from '@/api/dashboard';
import { WidgetBody, WidgetEmpty, WidgetFrame, type WidgetProps } from '@/features/dashboard/components/WidgetFrame';
import { groupRepeatedEvents } from '@/features/dashboard/lib/widgetMath';
import { useDashboardWidget, useDashboardWidgetAccess } from '@/hooks/useDashboardWidget';
import { fmtDateTime, fmtMDHM, relTime } from '@/lib/format';
import { cn } from '@/lib/cn';

function EventsBody({ data }: { data: RecentEventsData }) {
  if (data.items.length === 0) return <WidgetEmpty>최근 작업 로그가 없어요</WidgetEmpty>;
  return (
    <ul className="flex flex-col px-3.5">
      {groupRepeatedEvents(data.items).map((group) => {
        const [event] = group;
        const oldest = group[group.length - 1];
        const summaries = [...new Set(group.map((row) => [row.targetNo, row.reasonText].filter(Boolean).join(' · ')).filter(Boolean))];
        const timeTitle = group.length > 1 ? `${fmtDateTime(oldest.occurredAt)} ~ ${fmtDateTime(event.occurredAt)}` : `${fmtDateTime(event.occurredAt)} · ${relTime(event.occurredAt)}`;
        return (
          <li
            key={event.id}
            data-pet-item="businessEvent"
            data-pet-item-title={event.businessEventTypeLabel}
            className="flex h-[33px] min-w-0 flex-none items-center gap-1.5 border-b border-line last:border-b-0"
          >
            <time className="min-w-[68px] flex-none whitespace-nowrap text-cap text-ink-3 tabular-nums" dateTime={event.occurredAt} title={timeTitle} data-pet-field="시각">
              {fmtMDHM(event.occurredAt)}
            </time>
            <span
              className={cn('max-w-[72px] flex-none truncate rounded-xs px-1.5 text-cap leading-relaxed font-medium', event.actorType === 'SYSTEM' ? 'bg-surface-3 text-ink-2' : 'bg-run-bg text-run')}
              title={event.actorName}
              data-pet-field="주체"
            >
              {event.actorName}
            </span>
            <span className="flex-none text-xs font-semibold" data-pet-field="유형">
              {event.businessEventTypeLabel}
            </span>
            {group.length > 1 ? (
              <span className="flex-none text-cap font-semibold text-ink-3 tabular-nums" title={`같은 작업 ${group.length}건을 한 줄로 묶었어요`}>
                ×{group.length}
              </span>
            ) : null}
            {event.isAiAssisted ? (
              <span className="flex-none rounded-xs bg-ai-bg px-1.5 text-cap leading-relaxed font-medium text-ai-strong" title="AI 어시스턴트 초안으로 확정한 작업" data-pet-field="구분">
                AI 경유
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate font-mono text-cap text-ink-2" data-pet-field="대상 · 사유" title={summaries.join('\n')}>
              {summaries.join(' · ')}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function RecentEventsWidget(props: WidgetProps) {
  const access = useDashboardWidgetAccess('RECENT_EVENTS');
  const query = useDashboardWidget('RECENT_EVENTS', access.allowed);
  return (
    <WidgetFrame widgetKey="RECENT_EVENTS" {...props} meta={query.data ? `최근 ${query.data.items.length}건` : null}>
      <WidgetBody allowed={access.allowed} permissions={access.permissions} query={query}>
        {(data) => <EventsBody data={data} />}
      </WidgetBody>
    </WidgetFrame>
  );
}
