'use client';

// 내 일정 /schedule[?week=YYYY-MM-DD] (Voice2ERP 6단계). 한 주(월~일)를 날짜별 목록으로 보인다:
// 내가 참석하거나 등록한 일정(회의록에서 등록한 것 포함)과 이 주에 마감인 내 진행 업무.
import Link from 'next/link';
import type { ScheduleEventView } from '@fantasteel/shared';
import type { TaskView } from '@/api/tasks';
import { Button } from '@/components/Button';
import { PageHead, PageMain } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { Spinner } from '@/components/StateView';
import { addDays, mondayOf, seoulDayOf, weekDays, weekFromParam } from '@/features/schedule/lib/week';
import { useShellTitle } from '@/features/shell/useShellTitle';
import { useUrlParams } from '@/features/purchasing/hooks/useUrlParams';
import { useScheduleEvents } from '@/hooks/useScheduleEvents';
import { useTaskList } from '@/hooks/useTasks';
import { cn } from '@/lib/cn';
import { fmtHM, fmtMD, fmtMDdow, todayStr } from '@/lib/format';

function EventRow({ event }: { event: ScheduleEventView }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
      <span className="w-28 flex-none font-mono text-xs text-ink-2">
        {fmtHM(event.startAt)}–{fmtHM(event.endAt)}
      </span>
      <span className="font-medium text-ink">{event.scheduleEventTitle}</span>
      <span className="text-cap text-ink-3">{event.attendees.map((a) => a.employeeName).join(', ')}</span>
      {event.meetingMinutes ? (
        <Link href={`/meetings?id=${event.meetingMinutes.id}`} className="ml-auto text-xs text-brand hover:underline">
          회의록
        </Link>
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
  useShellTitle(undefined, `${fmtMD(monday)} – ${fmtMD(sunday)}`);

  const goTo = (date: string) => set({ week: mondayOf(date) });

  return (
    <PageMain>
      <PageHead
        title="내 일정"
        actions={
          <>
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
              const dayEvents = list.filter((event) => seoulDayOf(event.startAt) === day);
              const dayTasks = (tasks.data ?? []).filter((task) => task.taskStatus === 'OPEN' && task.dueDate === day);
              const empty = dayEvents.length === 0 && dayTasks.length === 0;
              const isToday = day === today;
              return (
                <li key={day} className={cn('rounded-md border px-4 py-3', isToday ? 'border-brand bg-brand-tint' : 'border-line bg-surface', empty && 'opacity-60')}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <b className="text-sm font-semibold">{fmtMDdow(day)}</b>
                    {isToday ? <span className="text-cap font-medium text-brand">오늘</span> : null}
                  </div>
                  {empty ? (
                    <div className="text-sm text-ink-3">일정 없음</div>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {dayEvents.map((event) => (
                        <EventRow key={`e${event.id}`} event={event} />
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
    </PageMain>
  );
}
