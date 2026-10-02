// 알림 (REQ-NTF-002: 개인·부서 단위로 알림을 발송한다, REQ-ORG-004, BP-MSG-01).
// - 업무·알림 화면의 알림 탭, 상단 알림 드롭다운(SPEC 4장 1번), 레일 배지가 쓴다.
// - 알림은 늘 받는 사원 한 명의 행이다. 부서 발송은 부서원 수만큼 행을 만들고 departmentId를 남긴다 (ERD notification).
// - 알림 만들기 규칙은 mock/services/notifications.ts의 createNotifications 하나에 있다. 다른 영역의 변경 함수는
//   자기 트랜잭션 안에서 그 함수를 부르고, 화면에서 따로 보낼 때만 아래 notificationApi.notify를 쓴다.
import { NOTIFICATION_TYPE, type NotificationType } from '@/codes';
import { requireActor } from '@/api/actor';
import { ApiError, FieldErrors, mockMutation, mockQuery } from '@/api/client';
import { optionalText, requiredText, requireRow } from '@/api/validation';
import { isScreenPath, LINK_PATH_ERROR } from '@/features/tasks/lib/taskDue';
import { NOTIFICATION_TITLE_MAX } from '@/features/tasks/lib/taskNotice';
import type { MockTables, NotificationRow } from '@/mock/schema';
import { createNotifications } from '@/mock/services/notifications';
import { updateRow } from '@/mock/store';

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

const byNewest = (a: NotificationRow, b: NotificationRow) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id;

const previewOf = ({ id, notificationType, title, body, linkPath, isRead, createdAt }: NotificationRow): NotificationPreview => ({
  id,
  notificationType,
  title,
  body,
  linkPath,
  isRead,
  createdAt,
});

function toView(tables: Readonly<MockTables>, row: NotificationRow): NotificationView {
  return {
    ...previewOf(row),
    departmentId: row.departmentId,
    departmentName: row.departmentId === null ? null : (tables.department.find((d) => d.id === row.departmentId)?.departmentName ?? null),
    readAt: row.readAt,
  };
}

/** 다른 영역 화면이 알림을 보낼 때의 입력 (stage2.md 협업) */
export interface NotifyInput {
  type: NotificationType;
  /** 개인 발송 대상 */
  recipientEmployeeIds?: readonly number[];
  /** 부서 발송 대상 (그 부서의 사용 중 사원 모두) */
  departmentId?: number | null;
  title: string;
  body?: string | null;
  linkPath?: string | null;
  /** 알림을 만든 작업 로그. 같은 작업 로그·받는 사람은 한 번만 만든다 */
  sourceEventId?: number | null;
}

const NOTIFICATION_TYPES = Object.values(NOTIFICATION_TYPE) as string[];

export const notificationApi = {
  /** 안 읽은 알림 수 (레일·상단 배지) */
  countUnread: (recipientId: number): Promise<number> =>
    mockQuery((tables) => tables.notification.filter((n) => n.recipientId === recipientId && !n.isRead).length),

  /** 상단 드롭다운의 최근 알림 */
  listRecent: (recipientId: number, limit: number = RECENT_NOTIFICATION_LIMIT): Promise<NotificationPreview[]> =>
    mockQuery((tables) =>
      tables.notification
        .filter((n) => n.recipientId === recipientId)
        .sort(byNewest)
        .slice(0, limit)
        .map(previewOf),
    ),

  /** 알림함: 요청한 사원이 받은 알림, 최신순 */
  list: (query: NotificationListQuery = {}): Promise<NotificationPage> =>
    mockQuery((tables) => {
      const me = requireActor(tables).employee.id;
      const mine = tables.notification.filter((n) => n.recipientId === me);
      const filtered = mine.filter((n) => !query.unreadOnly || !n.isRead).sort(byNewest);
      const limit = query.limit ?? NOTIFICATION_PAGE_SIZE;
      return {
        items: filtered.slice(0, limit).map((row) => toView(tables, row)),
        hasMore: filtered.length > limit,
        unreadCount: mine.filter((n) => !n.isRead).length,
      };
    }),

  /** 읽음 처리. 받은 사람만 할 수 있다. 이미 읽었으면 그대로 둔다. */
  markRead: (id: number): Promise<NotificationView> =>
    mockMutation((tx) => {
      const me = requireActor(tx.tables).employee.id;
      const row = requireRow(tx.tables, 'notification', id, '알림');
      if (row.recipientId !== me) throw new ApiError('COM-002', '받은 사람만 읽음 처리할 수 있어요');
      const next = row.isRead ? row : (updateRow(tx, 'notification', id, { isRead: true, readAt: tx.nowIso }) ?? row);
      return toView(tx.tables, next);
    }),

  /** 모두 읽음. 읽음 처리한 건수를 돌려준다. */
  markAllRead: (): Promise<number> =>
    mockMutation((tx) => {
      const me = requireActor(tx.tables).employee.id;
      const unread = tx.tables.notification.filter((n) => n.recipientId === me && !n.isRead);
      for (const row of unread) updateRow(tx, 'notification', row.id, { isRead: true, readAt: tx.nowIso });
      return unread.length;
    }),

  /**
   * 알림 보내기 (개인·부서). 만든 알림 수를 돌려준다.
   * 받는 사람·부서·작업 로그가 없으면 COM-003, 입력 오류는 입력칸 안내.
   */
  notify: (input: NotifyInput): Promise<number> =>
    mockMutation((tx) => {
      requireActor(tx.tables);
      const errors = new FieldErrors();
      if (!NOTIFICATION_TYPES.includes(input.type)) errors.add('type', '알림 유형을 골라 주세요');
      const title = requiredText(errors, 'title', input.title, '제목', NOTIFICATION_TITLE_MAX);
      const body = optionalText(errors, 'body', input.body, '내용', 1000);
      const linkPath = (input.linkPath ?? '').trim();
      if (linkPath && !isScreenPath(linkPath)) errors.add('linkPath', LINK_PATH_ERROR);
      const recipients = input.recipientEmployeeIds ?? [];
      const departmentId = input.departmentId ?? null;
      if (recipients.length === 0 && departmentId === null) errors.add('recipientEmployeeIds', '받는 사원이나 부서를 골라 주세요');
      errors.throwIfAny();
      for (const id of recipients) requireRow(tx.tables, 'employee', id, '받는 사원');
      if (departmentId !== null) requireRow(tx.tables, 'department', departmentId, '부서');
      const sourceEventId = input.sourceEventId ?? null;
      if (sourceEventId !== null) requireRow(tx.tables, 'businessEvent', sourceEventId, '작업 로그');
      return createNotifications(tx, {
        notificationType: input.type,
        title: title ?? '',
        body,
        linkPath: linkPath || null,
        recipientEmployeeIds: recipients,
        departmentId,
        businessEventId: sourceEventId,
      }).length;
    }),
};
