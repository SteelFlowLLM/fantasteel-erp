'use client';

// 업무 탭: 범위(내 업무·내가 만든 업무·전체) + 진행/완료 두 열 (업무 상태 OPEN 진행 → DONE 완료, 업무 프로세스 10장)
import { useEffect, useRef, useState } from 'react';
import { TASK_STATUS, TASK_STATUS_LABEL, type TaskStatus } from '@/codes';
import { taskApi, type TaskScope, type TaskView } from '@/api/tasks';
import { Badge, type BadgeTone } from '@/components/Badge';
import { Button, ButtonLink } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { IconButton } from '@/components/IconButton';
import { PageMain } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote } from '@/components/StateView';
import { Segmented } from '@/components/Tabs';
import { TaskFormModal } from '@/features/tasks/components/TaskFormModal';
import { taskDueStateOf, taskDueText } from '@/features/tasks/lib/taskDue';
import { useAction } from '@/hooks/useAction';
import { useMe } from '@/hooks/useMe';
import { useTaskList } from '@/hooks/useTasks';
import { cn } from '@/lib/cn';

const SCOPES: readonly { key: TaskScope; label: string }[] = [
  { key: 'mine', label: '내 업무' },
  { key: 'created', label: '내가 만든 업무' },
  { key: 'all', label: '전체' },
];

const STATUS_TONE: Record<TaskStatus, BadgeTone> = { OPEN: 'run', DONE: 'ok' };
const EMPTY_TEXT: Record<TaskStatus, string> = { OPEN: '진행 중인 업무가 없어요', DONE: '완료한 업무가 없어요' };

export function TaskBoard({ today, focusTaskId }: { today: string; focusTaskId: number | null }) {
  const [scope, setScope] = useState<TaskScope>('mine');
  const tasks = useTaskList(scope);
  const [editing, setEditing] = useState<TaskView | 'new' | null>(null);
  const [completing, setCompleting] = useState<TaskView | null>(null);
  const complete = useAction(taskApi.complete, { success: '업무를 완료했어요', onSuccess: () => setCompleting(null) });

  const open = (tasks.data ?? []).filter((task) => task.taskStatus === TASK_STATUS.OPEN);
  const overdueCount = open.filter((task) => taskDueStateOf(task, today) === 'overdue').length;
  const todayCount = open.filter((task) => taskDueStateOf(task, today) === 'today').length;

  return (
    <PageMain>
      <div className="flex flex-none flex-wrap items-center gap-2.5">
        <Segmented ariaLabel="업무 범위" items={SCOPES} active={scope} onChange={setScope} />
        {overdueCount > 0 ? <Badge tone="danger">마감 지남 {overdueCount}</Badge> : null}
        {todayCount > 0 ? <Badge tone="wait">오늘 마감 {todayCount}</Badge> : null}
        <span className="text-cap text-ink-3">정렬: 마감일 빠른 순</span>
        <Button variant="primary" icon="plus" className="ml-auto" onClick={() => setEditing('new')}>
          업무 추가
        </Button>
      </div>
      <QueryBoundary query={tasks} loadingLabel="업무를 불러오는 중…">
        {(list) => (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-2">
            {[TASK_STATUS.OPEN, TASK_STATUS.DONE].map((status) => {
              const column = list.filter((task) => task.taskStatus === status);
              return (
                <section key={status} aria-label={TASK_STATUS_LABEL[status]} className="flex min-h-[240px] flex-col rounded-md border border-line bg-surface-2">
                  <header className="flex flex-none items-center gap-2 border-b border-line px-3.5 py-2.5">
                    <Badge tone={STATUS_TONE[status]}>{TASK_STATUS_LABEL[status]}</Badge>
                    <span className="text-xs text-ink-3">{column.length}건</span>
                  </header>
                  <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto p-3">
                    {column.length === 0 ? <EmptyNote>{EMPTY_TEXT[status]}</EmptyNote> : null}
                    {column.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        today={today}
                        focused={task.id === focusTaskId}
                        onEdit={() => setEditing(task)}
                        onComplete={() => setCompleting(task)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </QueryBoundary>
      {editing ? <TaskFormModal task={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
      {completing ? (
        <ConfirmDialog
          title="업무 완료"
          confirmLabel="완료"
          pending={complete.isPending}
          onCancel={() => setCompleting(null)}
          onConfirm={() => complete.mutate({ id: completing.id, expectedUpdatedAt: completing.updatedAt })}
        >
          ‘{completing.title}’ 업무를 완료할까요? 완료한 업무는 고칠 수 없어요.
        </ConfirmDialog>
      ) : null}
    </PageMain>
  );
}

function TaskCard({ task, today, focused, onEdit, onComplete }: { task: TaskView; today: string; focused: boolean; onEdit: () => void; onComplete: () => void }) {
  const me = useMe();
  const ref = useRef<HTMLElement>(null);
  const state = taskDueStateOf(task, today);
  const done = state === 'done';
  const nameOf = (person: TaskView['assignee']) => `${person.employeeName}${person.id === me.employeeId ? ' (나)' : ''}`;

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center' });
  }, [focused]);

  return (
    <article
      ref={ref}
      className={cn(
        'flex flex-col gap-2 rounded-md border bg-surface p-3.5 shadow-1',
        state === 'overdue' ? 'border-[#f2c3be] bg-[#fff7f6]' : 'border-line',
        focused && 'ring-2 ring-brand',
      )}
    >
      <div className="flex items-start gap-2">
        <b className={cn('min-w-0 flex-1 text-base font-semibold break-words', done && 'text-ink-3 line-through')}>{task.title}</b>
        {task.canEdit && !done ? <IconButton icon="edit" label="업무 고치기" size="sm" onClick={onEdit} /> : null}
      </div>
      {task.description ? <p className="line-clamp-3 text-sm whitespace-pre-line text-ink-2">{task.description}</p> : null}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-3">
        <span>담당 {nameOf(task.assignee)}</span>
        {task.creator.id !== task.assignee.id ? <span>· 요청 {nameOf(task.creator)}</span> : null}
        <span className={cn('ml-auto font-medium', state === 'overdue' && 'text-danger', state === 'today' && 'text-wait')}>{taskDueText(task, today)}</span>
      </div>
      {(task.canEdit && !done) || task.linkPath ? (
        <div className="flex items-center gap-1.5">
          {task.canEdit && !done ? (
            <Button size="sm" icon="check" onClick={onComplete}>
              완료
            </Button>
          ) : null}
          {task.linkPath ? (
            <ButtonLink href={task.linkPath} size="sm" variant="ghost" className="ml-auto">
              화면 열기 →
            </ButtonLink>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
