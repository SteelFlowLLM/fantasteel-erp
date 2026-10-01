'use client';

// 상단 알림 버튼 (SPEC 4장 1번): 누르면 최근 알림 드롭다운. 항목·전체 보기는 왼쪽 메뉴 '업무·알림' 화면으로 간다.
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { CountBadge } from '@/components/Badge';
import { IconButton } from '@/components/IconButton';
import { PopFoot, PopHead, PopItem, PopList, PopNote, PopPanel } from '@/features/shell/PopPanel';
import { usePopover } from '@/hooks/usePopover';
import { useRecentNotifications, useUnreadNotificationCount } from '@/hooks/useShellCounts';
import { relTime } from '@/lib/format';

export function NotificationMenu({ employeeId }: { employeeId: number }) {
  const popover = usePopover<HTMLDivElement>();
  const router = useRouter();
  const unread = useUnreadNotificationCount(employeeId).data ?? 0;
  const recent = useRecentNotifications(employeeId, popover.open);

  const go = (href: string) => {
    popover.setOpen(false);
    router.push(href);
  };

  return (
    <div ref={popover.ref} className="relative">
      <IconButton
        icon="bell"
        iconSize="lg"
        label={`알림 · 안 읽음 ${unread}건`}
        aria-haspopup="dialog"
        aria-expanded={popover.open}
        onClick={() => popover.setOpen(!popover.open)}
      >
        <CountBadge count={unread} />
      </IconButton>
      {popover.open ? (
        <PopPanel label="최근 알림">
          <PopHead title="알림" meta={`안 읽음 ${unread}건`} />
          <PopList>
            {recent.isPending ? <PopNote>불러오는 중…</PopNote> : null}
            {recent.data?.map((notification) => (
              <PopItem key={notification.id} unread={!notification.isRead} onClick={() => go(`/tasks?tab=notifications&notification=${notification.id}`)}>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <b className="truncate text-sm font-semibold">{notification.title}</b>
                  {notification.body ? <span className="truncate text-xs text-ink-3">{notification.body}</span> : null}
                </span>
                <time className="flex-none text-cap text-ink-3">{relTime(notification.createdAt)}</time>
              </PopItem>
            ))}
            {recent.data && recent.data.length === 0 ? <PopNote>새 알림이 없어요</PopNote> : null}
          </PopList>
          <PopFoot>
            <Button variant="ghost" size="sm" onClick={() => go('/tasks?tab=notifications')}>
              업무·알림에서 전체 보기
            </Button>
          </PopFoot>
        </PopPanel>
      ) : null}
    </div>
  );
}
