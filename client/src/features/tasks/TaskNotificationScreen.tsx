'use client';

// 업무·알림 /tasks?tab=tasks|notifications[&notification=<id>][&task=<id>] (REQ-NTF-001·002)
// 업무 탭: 담당자·마감일이 있는 업무 (진행 → 완료). 알림 탭: 개인·부서 알림함.
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Tabs } from '@/components/Tabs';
import { NotificationInbox } from '@/features/tasks/components/NotificationInbox';
import { TaskBoard } from '@/features/tasks/components/TaskBoard';
import { useShellTitle } from '@/features/shell/useShellTitle';
import { useNotificationList } from '@/hooks/useNotifications';
import { useTaskSummary } from '@/hooks/useTasks';
import { todayStr } from '@/lib/format';

type TabKey = 'tasks' | 'notifications';

const idParam = (value: string | null): number | null => {
  const id = Number(value);
  return value && Number.isInteger(id) && id > 0 ? id : null;
};

export function TaskNotificationScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const focusNotificationId = idParam(params.get('notification'));
  const focusTaskId = idParam(params.get('task'));
  const tabParam = params.get('tab');
  // 주소에 notification만 있으면 알림 탭으로 연다
  const tab: TabKey = tabParam === 'notifications' || (tabParam === null && focusNotificationId !== null) ? 'notifications' : 'tasks';

  const today = todayStr();
  const summary = useTaskSummary(today).data;
  const unread = useNotificationList({ unreadOnly: true, limit: 1 }).data?.unreadCount;

  const subtitle = [
    `안 읽음 ${unread ?? 0}`,
    `오늘 마감 ${summary?.dueTodayCount ?? 0}`,
    summary && summary.overdueCount > 0 ? `마감 지남 ${summary.overdueCount}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  useShellTitle(undefined, subtitle);

  const changeTab = (next: TabKey) => router.replace(`${pathname}?tab=${next}`);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Tabs
        ariaLabel="업무·알림"
        className="bg-surface px-6"
        active={tab}
        onChange={changeTab}
        items={[
          { key: 'tasks', label: '업무', count: summary?.openCount },
          { key: 'notifications', label: '알림', count: unread },
        ]}
      />
      {tab === 'tasks' ? <TaskBoard today={today} focusTaskId={focusTaskId} /> : <NotificationInbox focusId={focusNotificationId} />}
    </div>
  );
}
