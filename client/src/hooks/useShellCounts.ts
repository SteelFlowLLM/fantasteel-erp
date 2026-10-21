// 셸의 숫자 배지와 드롭다운 목록 (알림·메신저·승인함)
import { useQuery } from '@tanstack/react-query';
import { approvalApi } from '@/api/approvals';
import { messengerApi } from '@/api/messenger';
import { notificationApi } from '@/api/notifications';
import { queryKeys } from '@/api/queryKeys';

/**
 * 배지 숫자는 서버가 알려 주는 이벤트가 없는 것(할 일 지정·결재 요청 알림)이 있어 가만히 있으면 0으로 남는다.
 * 그래서 배지 숫자 조회만 30초(가정값, 이슈 #476)마다와 창으로 돌아올 때 다시 읽는다. 다른 조회의 기본값(포커스 갱신 없음)은 그대로다.
 * 탭이 가려져 있는 동안은 폴링하지 않는다(TanStack Query 기본).
 */
export const BADGE_REFRESH_MS = 30_000;
const BADGE_REFRESH = { refetchInterval: BADGE_REFRESH_MS, refetchOnWindowFocus: true } as const;

export function unreadNotificationCountOptions(employeeId: number) {
  return { queryKey: queryKeys.unreadNotificationCount(employeeId), queryFn: () => notificationApi.countUnread(employeeId), ...BADGE_REFRESH };
}

export function unreadChatCountOptions(employeeId: number) {
  return { queryKey: queryKeys.unreadChatCount(employeeId), queryFn: () => messengerApi.countUnread(employeeId), ...BADGE_REFRESH };
}

export function approvalWaitingCountOptions(employeeId: number, isHead: boolean) {
  return { queryKey: queryKeys.approvalWaitingCount(employeeId), queryFn: () => approvalApi.countWaiting(employeeId), enabled: isHead, ...BADGE_REFRESH };
}

export function useUnreadNotificationCount(employeeId: number) {
  return useQuery(unreadNotificationCountOptions(employeeId));
}

/** 드롭다운을 열 때만 읽는다 */
export function useRecentNotifications(employeeId: number, enabled: boolean) {
  return useQuery({ queryKey: queryKeys.recentNotifications(employeeId), queryFn: () => notificationApi.listRecent(employeeId), enabled });
}

export function useUnreadChatCount(employeeId: number) {
  return useQuery(unreadChatCountOptions(employeeId));
}

/** 드롭다운을 열 때만 읽는다 */
export function useRecentChatRooms(employeeId: number, enabled: boolean) {
  return useQuery({ queryKey: queryKeys.recentChatRooms(employeeId), queryFn: () => messengerApi.listRecentRooms(employeeId), enabled });
}

/** 부서장이 승인할 구매요청 수. 부서장이 아니면 부르지 않는다. */
export function useApprovalWaitingCount(employeeId: number, isHead: boolean) {
  return useQuery(approvalWaitingCountOptions(employeeId, isHead));
}
