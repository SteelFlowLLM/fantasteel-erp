'use client';

// 알림 탭: 알림함 (REQ-NTF-002 개인·부서 알림). 누르면 읽음으로 바꾸고 연결된 화면으로 간다.
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { NOTIFICATION_TYPE_LABEL } from '@/codes';
import { NOTIFICATION_PAGE_SIZE, notificationApi, type NotificationView } from '@/api/notifications';
import { Badge } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card, CardHead } from '@/components/Card';
import { PageMain } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { StateView } from '@/components/StateView';
import { Tag } from '@/components/Tag';
import { dayLabelOf } from '@/features/messenger/lib/dayLabel';
import { NOTIFICATION_TYPE_TONE } from '@/features/tasks/lib/notificationTone';
import { useAction } from '@/hooks/useAction';
import { useNotificationList } from '@/hooks/useNotifications';
import { cn } from '@/lib/cn';
import { fmtDate, fmtHM, fmtMDHM } from '@/lib/format';

/** ?notification= 으로 고른 알림을 찾을 때 더 불러올 최대 건수 */
const FOCUS_SEARCH_LIMIT = NOTIFICATION_PAGE_SIZE * 5;

export function NotificationInbox({ focusId }: { focusId: number | null }) {
  const router = useRouter();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [limit, setLimit] = useState(NOTIFICATION_PAGE_SIZE);
  const list = useNotificationList({ unreadOnly, limit });
  const markRead = useAction(notificationApi.markRead);
  const markAll = useAction(notificationApi.markAllRead, {
    success: (count) => (count > 0 ? `알림 ${count}건을 읽음 처리했어요` : '안 읽은 알림이 없어요'),
  });

  const page = list.data;
  const focusFound = focusId !== null && (page?.items.some((n) => n.id === focusId) ?? false);
  const searching = focusId !== null && !focusFound && page !== undefined && page.hasMore && limit < FOCUS_SEARCH_LIMIT;
  useEffect(() => {
    if (searching) setLimit((current) => current + NOTIFICATION_PAGE_SIZE);
  }, [searching]);

  const openNotification = (notification: NotificationView) => {
    const go = () => {
      if (notification.linkPath) router.push(notification.linkPath);
    };
    if (notification.isRead) go();
    else markRead.mutate(notification.id, { onSuccess: go });
  };

  return (
    <PageMain>
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHead
          title="알림함"
          meta={<Badge tone={page && page.unreadCount > 0 ? 'run' : 'neutral'}>안 읽음 {page?.unreadCount ?? 0}</Badge>}
          actions={
            <>
              <label className="inline-flex items-center gap-1.5 text-xs text-ink-2">
                <input
                  type="checkbox"
                  className="size-3.5 accent-brand"
                  checked={unreadOnly}
                  onChange={(event) => {
                    setUnreadOnly(event.target.checked);
                    setLimit(NOTIFICATION_PAGE_SIZE);
                  }}
                />
                안 읽은 것만
              </label>
              <Button size="sm" icon="check" disabled={!page || page.unreadCount === 0 || markAll.isPending} onClick={() => markAll.mutate(undefined)}>
                모두 읽음
              </Button>
            </>
          }
        />
        {focusId !== null && page && !focusFound && !searching ? (
          <Banner tone="wait" className="mx-4 mt-3">
            고른 알림을 최근 목록에서 찾지 못했어요. 아래에서 더 불러와 찾아 보세요
          </Banner>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto">
          <QueryBoundary query={list} loadingLabel="알림을 불러오는 중…">
            {(data) =>
              data.items.length === 0 ? (
                <StateView kind="empty" title={unreadOnly ? '안 읽은 알림이 없어요' : '받은 알림이 없어요'} />
              ) : (
                <div className="flex flex-col">
                  {data.items.map((notification, index) => {
                    const day = fmtDate(notification.createdAt);
                    const showDay = index === 0 || fmtDate(data.items[index - 1].createdAt) !== day;
                    return (
                      <div key={notification.id}>
                        {showDay ? (
                          <div className="sticky top-0 z-[1] border-b border-line bg-surface-2 px-4 py-1.5 text-cap font-semibold text-ink-3">{dayLabelOf(notification.createdAt)}</div>
                        ) : null}
                        <NotificationRow notification={notification} focused={notification.id === focusId} onOpen={() => openNotification(notification)} />
                      </div>
                    );
                  })}
                  <div className="flex justify-center px-4 py-3">
                    {data.hasMore ? (
                      <Button size="sm" variant="ghost" onClick={() => setLimit((current) => current + NOTIFICATION_PAGE_SIZE)}>
                        이전 알림 더 보기
                      </Button>
                    ) : (
                      <span className="text-cap text-ink-3">마지막 알림이에요</span>
                    )}
                  </div>
                </div>
              )
            }
          </QueryBoundary>
        </div>
      </Card>
    </PageMain>
  );
}

function NotificationRow({ notification, focused, onOpen }: { notification: NotificationView; focused: boolean; onOpen: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center' });
  }, [focused]);

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'flex cursor-pointer gap-3 border-b border-line px-4 py-3 outline-none hover:bg-surface-2 focus-visible:bg-surface-2',
        !notification.isRead && 'bg-[#f5f9ff]',
        focused && 'ring-2 ring-brand ring-inset',
      )}
    >
      <span className={cn('mt-1.5 size-2 flex-none rounded-full', notification.isRead ? 'bg-transparent' : 'bg-run')} aria-label={notification.isRead ? undefined : '안 읽음'} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <Badge tone={NOTIFICATION_TYPE_TONE[notification.notificationType]}>{NOTIFICATION_TYPE_LABEL[notification.notificationType]}</Badge>
          {notification.departmentId !== null ? (
            <Tag size="sm" tone="outline">
              부서 알림{notification.departmentName ? ` · ${notification.departmentName}` : ''}
            </Tag>
          ) : null}
          <b className={cn('min-w-0 flex-1 truncate text-sm', notification.isRead ? 'font-medium text-ink-2' : 'font-semibold text-ink')}>{notification.title}</b>
          <time className="flex-none text-cap text-ink-3">{fmtHM(notification.createdAt)}</time>
        </div>
        {notification.body ? <p className="text-sm break-words text-ink-2">{notification.body}</p> : null}
        <div className="flex items-center gap-2 text-cap text-ink-3">
          <span className={notification.linkPath ? 'font-medium text-brand' : undefined}>
            {notification.linkPath ? '연결된 화면 열기 →' : '연결된 화면이 없는 알림이에요'}
          </span>
          <span className="ml-auto">{notification.isRead ? `읽음 ${fmtMDHM(notification.readAt)}` : '누르면 읽음으로 바뀌어요'}</span>
        </div>
      </div>
    </div>
  );
}
