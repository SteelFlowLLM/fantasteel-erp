// 알림 조회 (상단 알림 드롭다운, SPEC 4장 1번). 업무·알림 화면은 2단계에서 만든다.
import type { NotificationType } from '@/codes';
import { mockQuery } from '@/api/client';

export interface NotificationPreview {
  id: number;
  notificationType: NotificationType;
  title: string;
  body: string | null;
  linkPath: string | null;
  isRead: boolean;
  createdAt: string;
}

export const RECENT_NOTIFICATION_LIMIT = 8;

export const notificationApi = {
  countUnread: (recipientId: number): Promise<number> =>
    mockQuery((tables) => tables.notification.filter((n) => n.recipientId === recipientId && !n.isRead).length),

  listRecent: (recipientId: number, limit: number = RECENT_NOTIFICATION_LIMIT): Promise<NotificationPreview[]> =>
    mockQuery((tables) =>
      tables.notification
        .filter((n) => n.recipientId === recipientId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
        .slice(0, limit)
        .map(({ id, notificationType, title, body, linkPath, isRead, createdAt }) => ({ id, notificationType, title, body, linkPath, isRead, createdAt })),
    ),
};
