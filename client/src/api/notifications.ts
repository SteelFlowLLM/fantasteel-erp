// 알림 (REQ-NTF-002: 개인·부서 단위로 알림을 발송한다, REQ-ORG-004, BP-MSG-01).
// - 업무·알림 화면의 알림 탭, 상단 알림 드롭다운(SPEC 4장 1번), 레일 배지가 쓴다.
// - 두 데이터 모드 모두 실제 서버를 부른다 (api/server/notifications.ts, 조회·읽음만). 발송은 서버가 본 거래 안에서 한다.
// - 알림은 늘 받는 사원 한 명의 행이다. 부서 발송은 부서원 수만큼 행을 만든다 (ERD notification).
import type { NotificationType } from '@/codes';
import { serverNotificationApi } from '@/api/server/notifications';

export interface NotificationPreview {
  id: number;
  notificationType: NotificationType;
  title: string;
  body: string | null;
  linkPath: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationView extends NotificationPreview {
  /** 부서 알림이면 그 부서 */
  departmentId: number | null;
  departmentName: string | null;
  readAt: string | null;
}

export interface NotificationListQuery {
  unreadOnly?: boolean;
  /** 앞에서부터 몇 건까지 (이전 알림 더 보기로 늘린다) */
  limit?: number;
}

export interface NotificationPage {
  items: NotificationView[];
  hasMore: boolean;
  unreadCount: number;
}

export const RECENT_NOTIFICATION_LIMIT = 8;
export const NOTIFICATION_PAGE_SIZE = 20;

export const notificationKeys = {
  all: ['notifications'] as const,
  list: (employeeId: number, query: NotificationListQuery) => ['notifications', 'list', employeeId, query] as const,
};

/** 받는 사원은 로그인 사원이다(서버가 쿠키로 정한다). 사원 id는 부르는 쪽(셸 훅)과 맞추려고 받기만 한다 */
export const notificationApi = {
  /** 안 읽은 알림 수 (레일·상단 배지) */
  countUnread: (_recipientId: number): Promise<number> => serverNotificationApi.countUnread(),

  /** 상단 드롭다운의 최근 알림 */
  listRecent: (_recipientId: number, limit: number = RECENT_NOTIFICATION_LIMIT): Promise<NotificationPreview[]> => serverNotificationApi.listRecent(limit),

  /** 알림함: 로그인 사원이 받은 알림, 최신순 */
  list: (query: NotificationListQuery = {}): Promise<NotificationPage> => serverNotificationApi.list(query),

  /** 읽음 처리. 받은 사람만 할 수 있다. 이미 읽었으면 그대로 둔다. */
  markRead: (id: number): Promise<NotificationView> => serverNotificationApi.markRead(id),

  /** 모두 읽음. 읽음 처리한 건수를 돌려준다. */
  markAllRead: (): Promise<number> => serverNotificationApi.markAllRead(),
};
