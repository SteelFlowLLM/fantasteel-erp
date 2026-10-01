import type { SessionUser } from '@/api/session';
import type { NavBadgeKey } from '@/features/shell/navigation';
import { useApprovalWaitingCount, useUnreadChatCount, useUnreadNotificationCount } from '@/hooks/useShellCounts';
import { isDepartmentHead } from '@/lib/permissions';

/** 레일 배지 숫자: 안 읽은 알림 · 안 읽은 메시지 · 승인 대기 구매요청 */
export function useNavBadges(me: SessionUser): Record<NavBadgeKey, number> {
  const notifications = useUnreadNotificationCount(me.employeeId).data ?? 0;
  const chat = useUnreadChatCount(me.employeeId).data ?? 0;
  const approvals = useApprovalWaitingCount(me.employeeId, isDepartmentHead(me)).data ?? 0;
  return { notifications, chat, approvals };
}
