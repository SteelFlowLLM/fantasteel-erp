'use client';

// 내 일정 /schedule[?week=YYYY-MM-DD] (Voice2ERP 6단계). 한 주(월~일)를 날짜별 목록으로 보인다:
// 내가 참석하거나 등록한 일정(회의록에서 등록한 것 포함)과 이 주에 마감인 내 진행 업무.
// 2026-10-16부터 내 일정을 직접 추가·수정한다(문서에 없는 기능). 회의록 일정과 남이 등록한 일정은 고치지 않는다.
import Link from 'next/link';
import { useState } from 'react';
import type { ScheduleEventView } from '@fantasteel/shared';
import { scheduleEventApi, scheduleEventKeys } from '@/api/scheduleEvents';
import type { TaskView } from '@/api/tasks';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageHead, PageMain } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { Spinner } from '@/components/StateView';
import { NOTION_REMOVAL_HINT } from '@/features/schedule/NotionSyncToggle';
import { ScheduleEventModal } from '@/features/schedule/ScheduleEventModal';
import { canEditEvent, canToggleNotion, notionRemovalPending } from '@/features/schedule/lib/scheduleForm';
import { addDays, mondayOf, overlapsDay, weekDays, weekFromParam } from '@/features/schedule/lib/week';
import { useShellTitle } from '@/features/shell/useShellTitle';
import { useUrlParams } from '@/features/purchasing/hooks/useUrlParams';
import { useAction } from '@/hooks/useAction';
import { useMe } from '@/hooks/useMe';
import { useScheduleEvents } from '@/hooks/useScheduleEvents';
import { useTaskList } from '@/hooks/useTasks';
import { cn } from '@/lib/cn';
import { safeExternalUrl } from '@/lib/integrations';
import { fmtHM, fmtMD, fmtMDdow, todayStr } from '@/lib/format';

/** 열린 창: 새 일정(그날) 또는 고칠 일정 */
type Editing = { date: string; event?: ScheduleEventView } | null;

/** 회의록 일정의 등록자가 Notion에 넣을지 바꾸는 단추 (이슈 #434). 끌 때는 이미 올라간 Notion 일정을 치운다고 확인받는다 */
function NotionSyncButton({ event }: { event: ScheduleEventView }) {
  const [confirming, setConfirming] = useState(false);
  const toggle = useAction(scheduleEventApi.updateNotionSync, {
    success: (e) => (e.notionSync ? 'Notion에 넣기로 했어요. 다음 반영 때 올라가요' : 'Notion에서 빼기로 했어요'),
    invalidate: [scheduleEventKeys.all],
    onSuccess: () => setConfirming(false),
    onError: () => setConfirming(false),
  });
  const flip = () => {
    if (event.notionSync && event.notionPageUrl) setConfirming(true);
    else toggle.mutate({ id: event.id, notionSync: !event.notionSync });
  };
  return (
    <>
      {/* 넣기는 확인 창 없이 바로 바뀌고 Notion·캘린더 초대로 이어져 철강맨AI 화면 조작이 누르지 않는다 (이슈 #479) */}
      <button type="button" onClick={flip} disabled={toggle.isPending} data-ai-block="" className="text-xs text-brand hover:underline disabled:opacity-50">
        {event.notionSync ? 'Notion에서 빼기' : 'Notion에 넣기'}
      </button>
      {confirming ? (
        <ConfirmDialog title="Notion에서 뺄까요?" confirmLabel="Notion에서 빼기" pending={toggle.isPending} onConfirm={() => toggle.mutate({ id: event.id, notionSync: false })} onCancel={() => setConfirming(false)}>
          <p>{NOTION_REMOVAL_HINT}.</p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

function EventRow({ event, onEdit, canToggle }: { event: ScheduleEventView; onEdit: (() => void) | null; canToggle: boolean }) {
  const notionUrl = safeExternalUrl(event.notionPageUrl);
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
      <span className="w-28 flex-none font-mono text-xs text-ink-2">
        {fmtHM(event.startAt)}–{fmtHM(event.endAt)}
      </span>
      <span className="font-medium text-ink" title={event.scheduleEventDescription ?? undefined}>
        {event.scheduleEventTitle}
      </span>
      {event.scheduleEventDescription ? <span className="max-w-80 truncate text-cap text-ink-2">{event.scheduleEventDescription}</span> : null}
      <span className="text-cap text-ink-3">{event.attendees.map((a) => a.employeeName).join(', ')}</span>
      {notionUrl ? (
        <a href={notionUrl} target="_blank" rel="noreferrer" className="ml-auto text-xs text-brand hover:underline">
          {notionRemovalPending(event) ? 'Notion (빼는 중)' : 'Notion'}
        </a>
      ) : null}
      {event.meetingMinutes ? (
        <Link href={`/meetings?id=${event.meetingMinutes.id}`} className={cn('text-xs text-brand hover:underline', !notionUrl && 'ml-auto')}>
          회의록
        </Link>
      ) : null}
      {canToggle ? <NotionSyncButton event={event} /> : null}
      {onEdit ? (
        <button type="button" onClick={onEdit} className="ml-auto text-xs text-brand hover:underline">
          고치기
        </button>
      ) : null}
    </li>
  );
}

function TaskRow({ task }: { task: TaskView }) {
  return (
    <li className="flex items-baseline gap-3 text-sm">
      <span className="w-28 flex-none text-xs text-ink-3">업무 마감</span>
      <Link href="/tasks" className="text-ink hover:underline">
        {task.title}
      </Link>
    </li>
  );
}

export function ScheduleScreen() {
  const { get, set } = useUrlParams();
  const today = todayStr();
  const monday = weekFromParam(get('week'), today);
  const days = weekDays(monday);
  const sunday = days[6];
  const events = useScheduleEvents(monday, sunday);
  const tasks = useTaskList('mine');
  const me = useMe();
  const [editing, setEditing] = useState<Editing>(null);
  useShellTitle(undefined, `${fmtMD(monday)} – ${fmtMD(sunday)}`);

  const goTo = (date: string) => set({ week: mondayOf(date) });
  // 이번 주를 보고 있으면 오늘, 다른 주면 그 주 월요일에 새 일정을 놓는다
  const defaultDate = days.includes(today) ? today : monday;

  return (
    <PageMain>
      <PageHead
        title="내 일정"
        actions={
          <>
            <Button size="sm" variant="primary" icon="plus" onClick={() => setEditing({ date: defaultDate })}>
              일정 추가
            </Button>
            <Button size="sm" icon="chevron-left" aria-label="이전 주" onClick={() => goTo(addDays(monday, -7))} />
            <Button size="sm" onClick={() => goTo(today)} disabled={monday === mondayOf(today)}>
              이번 주
            </Button>
            <Button size="sm" icon="chevron-right" aria-label="다음 주" onClick={() => goTo(addDays(monday, 7))} />
          </>
        }
      />
      <QueryBoundary query={events} loadingLabel="일정을 불러오는 중…">
        {(list) => (
          <ol className="flex flex-col gap-2">
            {days.map((day) => {
              const dayEvents = list.filter((event) => overlapsDay(event, day));
              const dayTasks = (tasks.data ?? []).filter((task) => task.taskStatus === 'OPEN' && task.dueDate === day);
              const empty = dayEvents.length === 0 && dayTasks.length === 0;
              const isToday = day === today;
              return (
                <li key={day} className={cn('rounded-md border px-4 py-3', isToday ? 'border-brand bg-brand-tint' : 'border-line bg-surface', empty && 'opacity-60')}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <b className="text-sm font-semibold">{fmtMDdow(day)}</b>
                    {isToday ? <span className="text-cap font-medium text-brand">오늘</span> : null}
                    <button type="button" onClick={() => setEditing({ date: day })} className="ml-auto text-xs text-ink-3 hover:text-brand hover:underline" aria-label={`${fmtMDdow(day)} 일정 추가`}>
                      + 추가
                    </button>
                  </div>
                  {empty ? (
                    <div className="text-sm text-ink-3">일정 없음</div>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {dayEvents.map((event) => (
                        <EventRow key={`e${event.id}`} event={event} onEdit={canEditEvent(event, me.employeeId) ? () => setEditing({ date: day, event }) : null} canToggle={canToggleNotion(event, me.employeeId)} />
                      ))}
                      {dayTasks.map((task) => (
                        <TaskRow key={`t${task.id}`} task={task} />
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </QueryBoundary>
      {tasks.isPending ? <Spinner label="업무를 불러오는 중…" className="text-cap" /> : null}
      {editing ? <ScheduleEventModal key={editing.event?.id ?? `new-${editing.date}`} event={editing.event} date={editing.date} onClose={() => setEditing(null)} /> : null}
    </PageMain>
  );
}
