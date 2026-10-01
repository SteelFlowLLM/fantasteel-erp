// 알림 유형 배지 색 (알림함·상단 알림 드롭다운). 표시명은 codes의 NOTIFICATION_TYPE_LABEL.
import type { NotificationType } from '@/codes';
import type { BadgeTone } from '@/components/Badge';

export const NOTIFICATION_TYPE_TONE: Record<NotificationType, BadgeTone> = {
  MENTION: 'run',
  WORK_ROOM_MESSAGE: 'run',
  TASK_ASSIGNED: 'neutral',
  APPROVAL_REQUESTED: 'wait',
  APPROVAL_RESULT: 'ok',
};
