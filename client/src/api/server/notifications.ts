// 알림 화면(상단 알림·레일 배지·알림함) ↔ 서버 API (server/src/modules/notification). 서버 응답을 화면이 쓰는 모양으로 바꾼다.
// 서버 알림은 내용 한 줄(notification_content)이라 제목 자리에 두고 본문은 비운다. 부서 알림도 받는 사람별 행이라 부서 표시는 없다.
// 알림 보내기(notify)는 서버가 본 거래 안에서 하므로 화면 API가 없다.
import type { NotificationPage as ServerNotificationPage, NotificationReadAllResult, NotificationView as ServerNotificationView } from '@fantasteel/shared';
import { serverRequest } from '@/api/http';
import type { NotificationListQuery, NotificationPage, NotificationPreview, NotificationView } from '@/api/notifications';
import { NOTIFICATION_PAGE_SIZE } from '@/api/notifications';

/** 서버 페이지 크기 상한 (ListNotificationsQuery @Max) */
const SERVER_PAGE_MAX = 100;

const previewOf = (row: ServerNotificationView): NotificationPreview => ({
  id: row.id,
  notificationType: row.notificationType,
  title: row.notificationContent,
  body: null,
  linkPath: row.linkPath,
  isRead: row.readAt !== null,
  createdAt: row.createdAt,
});

const viewOf = (row: ServerNotificationView): NotificationView => ({ ...previewOf(row), departmentId: null, departmentName: null, readAt: row.readAt });

const fetchPage = (page: number, size: number, unreadOnly: boolean) =>
  serverRequest<ServerNotificationPage>('GET', '/notifications', { query: { page, size, unreadOnly: unreadOnly ? 'true' : undefined } });

/** 최신순 앞에서 limit건. 서버 페이지 상한을 넘으면 여러 페이지로 읽는다 */
async function firstItems(limit: number, unreadOnly: boolean): Promise<{ items: ServerNotificationView[]; total: number; unreadCount: number }> {
  const size = Math.min(limit, SERVER_PAGE_MAX);
  const items: ServerNotificationView[] = [];
  for (let page = 1; ; page++) {
    const result = await fetchPage(page, size, unreadOnly);
    items.push(...result.items);
    if (items.length >= limit || items.length >= result.total || result.items.length === 0) return { items: items.slice(0, limit), total: result.total, unreadCount: result.unreadCount };
  }
}

export const serverNotificationApi = {
  countUnread: async (): Promise<number> => (await fetchPage(1, 1, true)).unreadCount,

  listRecent: async (limit: number): Promise<NotificationPreview[]> => (await firstItems(limit, false)).items.map(previewOf),

  list: async (query: NotificationListQuery): Promise<NotificationPage> => {
    const { items, total, unreadCount } = await firstItems(query.limit ?? NOTIFICATION_PAGE_SIZE, query.unreadOnly ?? false);
    return { items: items.map(viewOf), hasMore: total > items.length, unreadCount };
  },

  markRead: async (id: number): Promise<NotificationView> => viewOf(await serverRequest<ServerNotificationView>('POST', `/notifications/${id}/read`)),

  markAllRead: async (): Promise<number> => (await serverRequest<NotificationReadAllResult>('POST', '/notifications/read-all')).readCount,
};
