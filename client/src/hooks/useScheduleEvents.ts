// 내 일정 조회 훅
import { useQuery } from '@tanstack/react-query';
import { scheduleEventApi, scheduleEventKeys } from '@/api/scheduleEvents';
import { useMe } from '@/hooks/useMe';

export function useScheduleEvents(from: string, to: string) {
  const me = useMe();
  return useQuery({ queryKey: scheduleEventKeys.range(me.employeeId, from, to), queryFn: () => scheduleEventApi.list(from, to) });
}
