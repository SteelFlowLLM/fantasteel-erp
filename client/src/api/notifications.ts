// 알림 API — docs/api/notification.md 의 모양 그대로.
import type { NotificationType } from '@fantasteel/shared';
import { api } from './client';

export interface NotificationItem {
  id: number;
  notificationType: NotificationType;
  title: string;
  body: string | null;
  /** 눌렀을 때 이동할 프론트 경로 */
  linkPath: string | null;
  departmentId: number | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  /** 최신순 */
  items: NotificationItem[];
  /** 다음 페이지의 cursor. 마지막이면 null */
  nextCursor: number | null;
}

export interface ListNotificationsQuery { unreadOnly?: boolean; limit?: number; cursor?: number }

/** 소켓 `notification` 이벤트 */
export interface NotificationEvent { notificationType: NotificationType; title: string; body: string | null; linkPath: string | null }

export const notificationApi = {
  list: (q: ListNotificationsQuery = {}) => api.get<NotificationPage>('/notifications', { unreadOnly: q.unreadOnly || undefined, limit: q.limit, cursor: q.cursor }),
  unreadCount: () => api.get<{ count: number }>('/notifications/unread-count'),
  read: (id: number) => api.post<NotificationItem>(`/notifications/${id}/read`),
  readAll: () => api.post<{ updated: number }>('/notifications/read-all'),
};
