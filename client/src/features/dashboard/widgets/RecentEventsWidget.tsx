// 최근 작업 로그 (REQ-DSH-001): 최신 작업 로그 20건. 주체(사용자 이름 / '시스템') · 이벤트 · 대상 번호 · 사유.
import type { RecentEventsData } from '@/api/dashboard';
import { WidgetBody, WidgetEmpty, WidgetFrame, type WidgetProps } from '@/features/dashboard/components/WidgetFrame';
import { useDashboardWidget, useDashboardWidgetAccess } from '@/hooks/useDashboardWidget';
import { fmtDateTime, relTime } from '@/lib/format';
import { cn } from '@/lib/cn';

function EventsBody({ data }: { data: RecentEventsData }) {
  if (data.items.length === 0) return <WidgetEmpty>최근 작업 로그가 없어요</WidgetEmpty>;
  return (
    <ul className="flex flex-col px-3.5">
      {data.items.map((event) => {
        const summary = [event.targetNo, event.reasonText].filter(Boolean).join(' · ');
        return (
          <li key={event.id} className="flex h-[33px] min-w-0 flex-none items-center gap-1.5 border-b border-line last:border-b-0">
            <time className="w-14 flex-none text-cap text-ink-3 tabular-nums" dateTime={event.occurredAt} title={fmtDateTime(event.occurredAt)}>
              {relTime(event.occurredAt)}
            </time>
            <span
              className={cn('max-w-[72px] flex-none truncate rounded-xs px-1.5 text-cap leading-[18px] font-medium', event.actorType === 'SYSTEM' ? 'bg-surface-3 text-ink-2' : 'bg-run-bg text-run')}
              title={event.actorName}
            >
              {event.actorName}
            </span>
            <span className="flex-none text-xs font-semibold">{event.businessEventTypeLabel}</span>
            {event.isAiAssisted ? (
              <span className="flex-none rounded-xs bg-ai-bg px-1.5 text-cap leading-[18px] font-medium text-ai-strong" title="AI 어시스턴트 초안으로 확정한 작업">
                AI 경유
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate font-mono text-cap text-ink-2" title={summary}>
              {summary}
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
