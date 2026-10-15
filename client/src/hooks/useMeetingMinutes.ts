// 회의록 조회 훅 (만들기는 화면에서 useAction(meetingMinutesApi.create)으로)
import { keepPreviousData, skipToken, useQuery } from '@tanstack/react-query';
import { meetingMinutesApi, meetingMinutesKeys, type MeetingMinutesListQuery } from '@/api/meetingMinutes';
import { useMe } from '@/hooks/useMe';

export function useMeetingMinutesList(query: MeetingMinutesListQuery) {
  const me = useMe();
  return useQuery({ queryKey: meetingMinutesKeys.list(me.employeeId, query), queryFn: () => meetingMinutesApi.list(query), placeholderData: keepPreviousData });
}

export function useMeetingMinutes(id: number | null) {
  const me = useMe();
  return useQuery({
    queryKey: meetingMinutesKeys.detail(me.employeeId, id ?? 0),
    queryFn: id === null ? skipToken : () => meetingMinutesApi.get(id),
    retry: false,
  });
}
