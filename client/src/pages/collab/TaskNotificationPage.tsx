// 업무·알림 (REQ-NTF-001~002, BP-MSG-01). 모양은 v1 B안 30(업무·알림)의 카드·배지·문구를 따른다.
// 주소: /tasks?tab=tasks|notifications, ?notification=<id> 는 그 알림으로 스크롤하고 강조한다.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { NOTIFICATION_TYPE_LABEL, TASK_STATUS_LABEL, type NotificationType, type TaskStatus } from '@fantasteel/shared';
import { notificationApi, type NotificationItem } from '@/api/notifications';
import { taskApi, type TaskScope, type TaskView } from '@/api/tasks';
import { Badge, EmptyNote, Icon, QueryBoundary, type Tone } from '@/components/ui';
import { dayLabel } from '@/features/collab/ChatParts';
import { TaskFormModal } from '@/features/collab/TaskFormModal';
import { useAction } from '@/hooks/useApi';
import { dLabel, fmtDate, fmtHM, fmtMD, fmtMDHM, todayStr } from '@/lib/format';
import { useShellTitle } from '@/shell/shellTitle';
import { useMe } from '@/stores/auth';
import './TaskNotificationPage.css';

type Tab = 'tasks' | 'notifications';

const STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'DONE'];
const TASK_STATUS_TONE: Record<TaskStatus, Tone> = { TODO: 'wait', IN_PROGRESS: 'run', DONE: 'ok' };
const SCOPES: [TaskScope, string][] = [['mine', '내 업무'], ['created', '내가 만든 업무'], ['all', '전체']];
const NOTIFICATION_TONE: Record<NotificationType, Tone> = {
  MENTION: 'run', WORK_ROOM_MESSAGE: 'run', APPROVAL_REQUEST: 'wait', APPROVAL_RESULT: 'ok', TASK: 'neutral',
  PRODUCTION: 'neutral', QUALITY: 'neutral', SHIPMENT: 'neutral', PURCHASE: 'neutral', SALES: 'neutral', SYSTEM: 'neutral',
};
const NOTIFICATION_PAGE = 20;
/** ?notification=<id> 를 찾으려고 자동으로 더 불러오는 페이지 수 한도 */
const FOCUS_MAX_PAGES = 5;

const isOverdue = (t: TaskView, today: string) => t.taskStatus !== 'DONE' && !!t.dueDate && t.dueDate < today;
const isDueToday = (t: TaskView, today: string) => t.taskStatus !== 'DONE' && t.dueDate === today;

// ───────────────────────────── 업무 ─────────────────────────────
function TaskCard({ task, today, myEmployeeId, onEdit }: { task: TaskView; today: string; myEmployeeId: number; onEdit: (t: TaskView) => void }) {
  const setStatus = useAction(taskApi.setStatus, { invalidate: ['tasks'] });
  const overdue = isOverdue(task, today);
  const dueToday = isDueToday(task, today);
  const done = task.taskStatus === 'DONE';
  const move = (taskStatus: TaskStatus) => setStatus.mutate({ id: task.id, taskStatus });
  return (
    <article className={`hl-heatcard tn-task${overdue ? ' is-warn' : ''}`} style={overdue ? { background: '#FFF7F6' } : undefined}>
      <div className="hl-row" style={{ gap: 6, alignItems: 'flex-start' }}>
        {done ? <span className="hl-grow" style={{ fontSize: 13, color: 'var(--ink-3)', textDecoration: 'line-through' }}>{task.title}</span> : <b className="hl-grow" style={{ fontWeight: 600, fontSize: 13 }}>{task.title}</b>}
        <button type="button" className="hl-iconbtn hl-iconbtn--sm" style={{ margin: '-4px -6px 0 0' }} aria-label={`${task.title} 수정`} onClick={() => onEdit(task)}><Icon name="edit" size="sm" /></button>
      </div>
      {task.description ? <p className="tn-task__desc">{task.description}</p> : null}
      <span className="hl-row hl-cap" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span>담당 {task.assigneeName}{task.assigneeId === myEmployeeId ? ' (나)' : ''}</span>
        {task.creatorId !== task.assigneeId ? <span>· 요청 {task.creatorName}{task.creatorId === myEmployeeId ? ' (나)' : ''}</span> : null}
        {done ? (
          <span style={{ marginLeft: 'auto' }}>완료 {fmtMDHM(task.completedAt)}</span>
        ) : overdue ? (
          <span className="hl-risk" style={{ fontSize: 11, marginLeft: 'auto' }}><Icon name="clock" size="sm" />{fmtMD(task.dueDate)} 마감 지남 ({dLabel(task.dueDate)})</span>
        ) : task.dueDate ? (
          <span style={{ marginLeft: 'auto', ...(dueToday ? { color: 'var(--wait)', fontWeight: 600 } : null) }}>{dueToday ? '오늘 마감' : `마감 ${fmtMD(task.dueDate)} (${dLabel(task.dueDate)})`}</span>
        ) : (
          <span style={{ marginLeft: 'auto' }}>마감 없음</span>
        )}
      </span>
      <div className="hl-row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {task.taskStatus === 'TODO' ? <button type="button" className="hl-btn hl-btn--sm" disabled={setStatus.isPending} onClick={() => move('IN_PROGRESS')}>시작</button> : null}
        {task.taskStatus === 'IN_PROGRESS' ? <button type="button" className="hl-btn hl-btn--ghost hl-btn--sm" disabled={setStatus.isPending} onClick={() => move('TODO')}>할 일로</button> : null}
        {!done ? <button type="button" className="hl-btn hl-btn--sm" disabled={setStatus.isPending} onClick={() => move('DONE')}><Icon name="check" />완료</button> : null}
        {done ? <button type="button" className="hl-btn hl-btn--ghost hl-btn--sm" disabled={setStatus.isPending} onClick={() => move('IN_PROGRESS')}>다시 열기</button> : null}
        {task.linkPath ? <Link className={`hl-btn hl-btn--sm${done ? '' : ' hl-btn--primary'}`} style={{ marginLeft: 'auto' }} to={task.linkPath}>화면 열기<Icon name="arrow-right" /></Link> : null}
      </div>
    </article>
  );
}

function TaskBoard({ scope, setScope, onAdd, onEdit }: { scope: TaskScope; setScope: (s: TaskScope) => void; onAdd: () => void; onEdit: (t: TaskView) => void }) {
  const me = useMe();
  const tasks = useQuery({ queryKey: ['tasks', 'list', scope], queryFn: () => taskApi.list({ scope }) });
  const today = todayStr();
  const list = tasks.data ?? [];
  const overdue = list.filter((t) => isOverdue(t, today)).length;
  const dueToday = list.filter((t) => isDueToday(t, today)).length;
  return (
    <>
      <div className="hl-row" style={{ flex: 'none', flexWrap: 'wrap' }}>
        <div className="hl-seg" role="group" aria-label="업무 범위">
          {SCOPES.map(([key, label]) => <button key={key} type="button" className={scope === key ? 'is-on' : undefined} aria-pressed={scope === key} onClick={() => setScope(key)}>{label}</button>)}
        </div>
        {tasks.data ? (
          <span className="hl-row hl-cap" style={{ gap: 8 }}>
            {overdue ? <span className="hl-badge hl-badge--danger hl-badge--plain">마감 지남 {overdue}</span> : null}
            {dueToday ? <span className="hl-badge hl-badge--wait hl-badge--plain">오늘 마감 {dueToday}</span> : null}
            <span>정렬: 마감일 빠른 순</span>
          </span>
        ) : null}
        <button type="button" className="hl-btn hl-btn--primary hl-btn--sm" style={{ marginLeft: 'auto' }} onClick={onAdd}><Icon name="plus" />업무 추가</button>
      </div>
      <QueryBoundary query={tasks} loadingLabel="업무를 불러오는 중…">
        {(rows) => (
          <div className="hl-kanban tn-board">
            {STATUSES.map((status) => {
              const lane = rows.filter((t) => t.taskStatus === status);
              return (
                <section key={status} className="hl-lane" aria-label={TASK_STATUS_LABEL[status]}>
                  <div className="hl-lane__head">
                    <Badge tone={TASK_STATUS_TONE[status]}>{TASK_STATUS_LABEL[status]}</Badge>
                    <span className="hl-tag">{lane.length}</span>
                  </div>
                  <div className="tn-lane__list">
                    {lane.map((t) => <TaskCard key={t.id} task={t} today={today} myEmployeeId={me.employeeId} onEdit={onEdit} />)}
                    {!lane.length ? <EmptyNote>{status === 'DONE' ? '완료한 업무가 없어요' : status === 'TODO' ? '할 일이 없어요' : '진행 중인 업무가 없어요'}</EmptyNote> : null}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </QueryBoundary>
    </>
  );
}

// ───────────────────────────── 알림 ─────────────────────────────
function NotificationList({ focusId, unreadCount }: { focusId: number | null; unreadCount: number | undefined }) {
  const navigate = useNavigate();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const query = useInfiniteQuery({
    queryKey: ['notifications', 'list', { unreadOnly }],
    queryFn: ({ pageParam }) => notificationApi.list({ unreadOnly, limit: NOTIFICATION_PAGE, cursor: pageParam }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = useMemo(() => (query.data?.pages ?? []).flatMap((p) => p.items), [query.data]);
  const read = useAction(notificationApi.read, { invalidate: ['notifications'] });
  const readAll = useAction(notificationApi.readAll, { invalidate: ['notifications'], success: (r) => (r.updated ? `알림 ${r.updated}건을 읽음 처리했어요` : '안 읽은 알림이 없어요') });

  // ?notification=<id>: 목록에 나올 때까지 몇 페이지 더 불러오고, 나오면 그 자리로 스크롤한다
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const pageCount = query.data?.pages.length ?? 0;
  const found = focusId !== null && items.some((n) => n.id === focusId);
  const scrolledRef = useRef<number | null>(null);
  useEffect(() => {
    if (focusId === null || !pageCount) return;
    if (found) {
      if (scrolledRef.current === focusId) return;
      scrolledRef.current = focusId;
      document.getElementById(`tn-noti-${focusId}`)?.scrollIntoView({ block: 'center' });
    } else if (hasNextPage && !isFetchingNextPage && pageCount < FOCUS_MAX_PAGES) {
      void fetchNextPage();
    }
  }, [focusId, found, pageCount, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const open = (n: NotificationItem) => {
    if (!n.isRead) read.mutate(n.id);
    if (n.linkPath) navigate(n.linkPath);
  };

  let prevDay = '';
  return (
    <section className="hl-card tn-noti-card" aria-label="알림함">
      <div className="hl-card__head">
        <h2>알림함</h2>
        <span className="hl-badge hl-badge--danger hl-badge--plain">안 읽음 {unreadCount ?? '-'}</span>
        <div className="hl-card__actions">
          <label className="hl-row hl-label" style={{ gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
            안 읽은 것만
          </label>
          <button type="button" className="hl-btn hl-btn--ghost hl-btn--sm" disabled={!unreadCount || readAll.isPending} onClick={() => readAll.mutate(undefined)}>
            <Icon name="check" />모두 읽음
          </button>
        </div>
      </div>
      <div className="hl-card__body hl-card__body--flush" style={{ overflow: 'auto', flex: 1 }}>
        <QueryBoundary query={query} loadingLabel="알림을 불러오는 중…">
          {() => (
            <>
              {focusId !== null && !found && !unreadOnly && !isFetchingNextPage && (!hasNextPage || pageCount >= FOCUS_MAX_PAGES) ? (
                <div className="hl-banner" style={{ margin: 12 }}><Icon name="info" /><div>고른 알림을 최근 목록에서 찾지 못했어요. 아래에서 더 불러와 찾아 보세요</div></div>
              ) : null}
              {items.map((n) => {
                const day = fmtDate(n.createdAt);
                const sep = day !== prevDay ? <div className="hl-daysep" style={{ padding: '10px 16px 6px' }}>{dayLabel(n.createdAt)}</div> : null;
                prevDay = day;
                return (
                  <Fragment key={n.id}>
                    {sep}
                    <div
                      id={`tn-noti-${n.id}`}
                      role="button"
                      tabIndex={0}
                      className={`hl-mitem tn-noti${n.isRead ? '' : ' is-unread'}${n.id === focusId ? ' is-focus' : ''}`}
                      aria-label={`${n.isRead ? '읽은' : '안 읽은'} 알림: ${n.title}`}
                      onClick={() => open(n)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          open(n);
                        }
                      }}
                    >
                      <div className="hl-row" style={{ gap: 8 }}>
                        <Badge tone={NOTIFICATION_TONE[n.notificationType] ?? 'neutral'}>{NOTIFICATION_TYPE_LABEL[n.notificationType] ?? n.notificationType}</Badge>
                        {n.departmentId !== null ? <span className="hl-tag">부서 알림</span> : null}
                        {n.isRead
                          ? <span style={{ fontSize: 13, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</span>
                          : <b style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</b>}
                        <time className="hl-cap" dateTime={n.createdAt} style={{ marginLeft: 'auto', flex: 'none' }}>{fmtHM(n.createdAt)}</time>
                        {n.isRead ? null : <span className="tn-noti__dot" aria-hidden="true" />}
                      </div>
                      {n.body ? <span className="tn-noti__body" style={{ color: n.isRead ? 'var(--ink-3)' : 'var(--ink-2)' }}>{n.body}</span> : null}
                      <span className="hl-row hl-cap" style={{ gap: 6 }}>
                        {n.linkPath ? <span className="hl-msg-action">연결된 화면 열기 →</span> : <span>{n.isRead ? '연결된 화면이 없는 알림이에요' : '누르면 읽음으로 바뀌어요'}</span>}
                        {n.isRead && n.readAt ? <span style={{ marginLeft: 'auto' }}>읽음 {fmtMDHM(n.readAt)}</span> : null}
                      </span>
                    </div>
                  </Fragment>
                );
              })}
              {!items.length ? <EmptyNote>{unreadOnly ? '안 읽은 알림이 없어요' : '받은 알림이 없어요'}</EmptyNote> : null}
              {hasNextPage ? (
                <div className="hl-row" style={{ justifyContent: 'center', padding: 12 }}>
                  <button type="button" className="hl-btn hl-btn--sm" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>{isFetchingNextPage ? '불러오는 중…' : '이전 알림 더 보기'}</button>
                </div>
              ) : items.length ? (
                <div className="hl-cap" style={{ textAlign: 'center', padding: 12 }}>마지막 알림이에요</div>
              ) : null}
            </>
          )}
        </QueryBoundary>
      </div>
    </section>
  );
}

// ───────────────────────────── 화면 ─────────────────────────────
export function TaskNotificationPage() {
  const [params, setParams] = useSearchParams();
  const focusParam = Number(params.get('notification'));
  const focusId = Number.isInteger(focusParam) && focusParam > 0 ? focusParam : null;
  const tab: Tab = params.get('tab') === 'notifications' || (!params.get('tab') && focusId !== null) ? 'notifications' : 'tasks';
  const [scope, setScope] = useState<TaskScope>('mine');
  const [form, setForm] = useState<{ task?: TaskView } | null>(null);

  // 새 알림(소켓 notification · notification-read)과 업무 변경(changed{tasks})은 셸이 'notifications'·'tasks' 조회를 다시 부른다
  const unread = useQuery({ queryKey: ['notifications', 'unread-count'], queryFn: notificationApi.unreadCount });
  const mine = useQuery({ queryKey: ['tasks', 'list', 'mine'], queryFn: () => taskApi.list({ scope: 'mine' }) });
  const today = todayStr();
  const openMine = (mine.data ?? []).filter((t) => t.taskStatus !== 'DONE');
  const dueToday = openMine.filter((t) => isDueToday(t, today)).length;
  const overdue = openMine.filter((t) => isOverdue(t, today)).length;
  useShellTitle(undefined, `안 읽음 ${unread.data?.count ?? '-'} · 오늘 마감 ${mine.data ? dueToday : '-'}${overdue ? ` · 마감 지남 ${overdue}` : ''}`);

  const selectTab = (next: Tab) => {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    if (next === 'tasks') p.delete('notification');
    setParams(p, { replace: true });
  };

  return (
    <main className="hl-main">
      <div className="hl-tabs" role="tablist" aria-label="업무·알림">
        <button type="button" role="tab" aria-selected={tab === 'tasks'} className={`hl-tab${tab === 'tasks' ? ' is-active' : ''}`} onClick={() => selectTab('tasks')}>
          <Icon name="task" />업무<span className="hl-tag">{mine.data ? openMine.length : '-'}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === 'notifications'} className={`hl-tab${tab === 'notifications' ? ' is-active' : ''}`} onClick={() => selectTab('notifications')}>
          <Icon name="bell" />알림<span className="hl-tag">{unread.data?.count ?? '-'}</span>
        </button>
      </div>
      {tab === 'tasks' ? (
        <TaskBoard scope={scope} setScope={setScope} onAdd={() => setForm({})} onEdit={(task) => setForm({ task })} />
      ) : (
        <NotificationList focusId={focusId} unreadCount={unread.data?.count} />
      )}
      {form ? <TaskFormModal task={form.task} onClose={() => setForm(null)} /> : null}
    </main>
  );
}
