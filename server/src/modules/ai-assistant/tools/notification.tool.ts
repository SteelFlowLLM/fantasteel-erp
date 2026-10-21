import { NOTIFICATION_TYPE, NOTIFICATION_TYPE_LABEL, type AuthUser, type NotificationType, type NotificationView } from '@fantasteel/shared';
import type { NotificationService } from '../../notification/notification.service';
import { limitRows, OPEN_ACCESS, optionalBoolean, optionalEnum, scanFiltered, seoulDateTimeText, TOOL_ROW_LIMIT, unscannedField, type AssistantTool } from './assistant-tool';

const NOTIFICATION_TYPES = Object.values(NOTIFICATION_TYPE) as NotificationType[];

/** Agent가 보내는 알림 유형 (factory-agent): 대응 후보가 생겼을 때, 납기 위험, 불합격률 상승 */
export const AGENT_NOTIFICATION_TYPES: readonly NotificationType[] = [NOTIFICATION_TYPE.AGENT_CANDIDATE, NOTIFICATION_TYPE.DUE_RISK, NOTIFICATION_TYPE.QUALITY_RATE_RISE];

/** 읽은 알림은 최근 이만큼 안에서만 찾는다 (안 읽은 알림은 모두 센다) */
const READ_LOOKBACK = 100;

export interface CollectedNotifications {
  /** 안 읽은 것 먼저, 그 안에서는 최신순 */
  rows: NotificationView[];
  /** 안 읽은 알림 수 (거른 범위 안) */
  unread: number;
  /** 거른 범위 안의 알림 수 */
  total: number;
  /** 거르려고 읽다가 상한에 걸려 확인하지 못한 알림 수 */
  unscanned: number;
}

/**
 * 내 알림을 안 읽은 것 먼저 모은다. 유형을 거르지 않으면 안 읽은 알림은 API의 안 읽음 목록으로 정확히 세고,
 * 유형을 거르면 알림 API에 거를 칸이 없어 쪽을 읽어 거른다(scanFiltered, 최대 1,000건).
 */
export async function collectNotifications(
  notifications: NotificationService,
  user: AuthUser,
  options: { types?: readonly NotificationType[]; unreadOnly?: boolean; limit?: number } = {},
): Promise<CollectedNotifications> {
  const limit = options.limit ?? TOOL_ROW_LIMIT;
  const unreadOnly = options.unreadOnly ?? false;
  if (options.types && options.types.length > 0) {
    const types = options.types;
    const scan = await scanFiltered(
      (page, size) => notifications.list(user, { unreadOnly, page, size }),
      (n) => types.includes(n.notificationType),
    );
    const unread = scan.rows.filter((n) => n.readAt === null);
    const read = scan.rows.filter((n) => n.readAt !== null);
    return { rows: [...unread, ...read].slice(0, limit), unread: unread.length, total: scan.rows.length, unscanned: scan.unscanned };
  }
  const unreadPage = await notifications.list(user, { unreadOnly: true, page: 1, size: limit });
  const rows = [...unreadPage.items];
  let total = unreadPage.unreadCount;
  if (!unreadOnly) {
    const recent = await notifications.list(user, { unreadOnly: false, page: 1, size: READ_LOOKBACK });
    total = recent.total;
    if (rows.length < limit) rows.push(...recent.items.filter((n) => n.readAt !== null).slice(0, limit - rows.length));
  }
  return { rows, unread: unreadPage.unreadCount, total, unscanned: 0 };
}

export function notificationRow(n: NotificationView) {
  return {
    알림id: n.id,
    유형: NOTIFICATION_TYPE_LABEL[n.notificationType] ?? n.notificationType,
    내용: n.notificationContent,
    '이동 화면': n.linkPath,
    시각: seoulDateTimeText(n.createdAt),
    읽음: n.readAt !== null,
  };
}

/**
 * 내 알림함 (GET /notifications, 문서에 없는 기능 이슈 #506). 늘 로그인한 사원 본인의 알림만이라 권한 코드가 없고,
 * 사원 본인의 것이라 철강맨AI 패널에서만 알린다(사내 채팅 @AI 답은 방 멤버 모두가 본다).
 */
export function myNotificationsTool(notifications: NotificationService): AssistantTool {
  return {
    access: OPEN_ACCESS,
    panelOnly: true,
    definition: {
      name: 'get_my_notifications',
      description: '내 알림함을 조회한다. 안 읽은 알림을 먼저, 그다음 최근에 읽은 알림을 준다. 안 읽은 알림 수, 알림 유형·내용·이동 화면·시각을 준다. unreadOnly=true면 안 읽은 알림만.',
      parameters: {
        type: 'object',
        properties: {
          unreadOnly: { type: 'boolean', description: 'true면 안 읽은 알림만' },
          type: { type: 'string', enum: NOTIFICATION_TYPES, description: `알림 유형: ${NOTIFICATION_TYPES.map((t) => `${t}(${NOTIFICATION_TYPE_LABEL[t]})`).join(', ')}` },
        },
      },
    },
    async run(args, user) {
      const unreadOnly = optionalBoolean(args, 'unreadOnly') ?? false;
      const type = optionalEnum(args, 'type', NOTIFICATION_TYPES);
      const found = await collectNotifications(notifications, user, { unreadOnly, ...(type ? { types: [type] } : {}) });
      const limited = limitRows(found.rows);
      return {
        label: `내 알림${unreadOnly ? ' · 안 읽음' : ''}${type ? ` · ${NOTIFICATION_TYPE_LABEL[type]}` : ''}`,
        data: {
          '안 읽은 알림 수': found.unread,
          알림: limited.rows.map(notificationRow),
          '생략 줄 수': Math.max(0, (unreadOnly ? found.unread : found.total) - limited.rows.length),
          ...unscannedField('알림', found.unscanned),
        },
      };
    },
  };
}
