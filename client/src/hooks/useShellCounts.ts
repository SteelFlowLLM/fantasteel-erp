// 셸의 숫자 배지와 드롭다운 목록 (알림·메신저·승인함)
import { useQuery } from '@tanstack/react-query';
import { approvalApi } from '@/api/approvals';
import { messengerApi } from '@/api/messenger';
import { notificationApi } from '@/api/notifications';
import { queryKeys } from '@/api/queryKeys';

export function useUnreadNotificationCount(employeeId: number) {
  return useQuery({ queryKey: queryKeys.unreadNotificationCount(employeeId), queryFn: () => notificationApi.countUnread(employeeId) });
}

/** 드롭다운을 열 때만 읽는다 */
export function useRecentNotifications(employeeId: number, enabled: boolean) {
  return useQuery({ queryKey: queryKeys.recentNotifications(employeeId), queryFn: () => notificationApi.listRecent(employeeId), enabled });
}

export function useUnreadChatCount(employeeId: number) {
  return useQuery({ queryKey: queryKeys.unreadChatCount(employeeId), queryFn: () => messengerApi.countUnread(employeeId) });
}

/** 드롭다운을 열 때만 읽는다 */
export function useRecentChatRooms(employeeId: number, enabled: boolean) {
  return useQuery({ queryKey: queryKeys.recentChatRooms(employeeId), queryFn: () => messengerApi.listRecentRooms(employeeId), enabled });
}

/** 부서장이 승인할 구매요청 수. 부서장이 아니면 부르지 않는다. */
export function useApprovalWaitingCount(employeeId: number, isHead: boolean) {
  return useQuery({ queryKey: queryKeys.approvalWaitingCount(employeeId), queryFn: () => approvalApi.countWaiting(employeeId), enabled: isHead });
}
