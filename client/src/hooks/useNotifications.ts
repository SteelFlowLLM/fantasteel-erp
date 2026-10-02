// 알림함 조회 훅 (업무·알림 화면의 알림 탭)
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { notificationApi, notificationKeys, type NotificationListQuery } from '@/api/notifications';
import { useMe } from '@/hooks/useMe';

export function useNotificationList(query: NotificationListQuery) {
  const me = useMe();
  return useQuery({
    queryKey: notificationKeys.list(me.employeeId, query),
    queryFn: () => notificationApi.list(query),
    // '이전 알림 더 보기'로 limit이 바뀌어도 목록이 깜빡이지 않게
    placeholderData: keepPreviousData,
  });
}
