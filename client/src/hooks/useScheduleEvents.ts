// 내 일정 조회 훅
import { useQuery } from '@tanstack/react-query';
import { scheduleEventApi, scheduleEventKeys } from '@/api/scheduleEvents';
import { useMe } from '@/hooks/useMe';

export function useScheduleEvents(from: string, to: string) {
  const me = useMe();
  return useQuery({ queryKey: scheduleEventKeys.range(me.employeeId, from, to), queryFn: () => scheduleEventApi.list(from, to) });
}

/** 일정을 Notion에 넣을 수 있는지 (이슈 #434). 관리자가 바꿀 때만 달라져 자주 다시 묻지 않는다 */
export function useScheduleNotionStatus() {
  return useQuery({ queryKey: scheduleEventKeys.notionStatus, queryFn: scheduleEventApi.notionStatus, staleTime: 60_000 });
}
