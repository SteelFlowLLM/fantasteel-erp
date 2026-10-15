// 회의록 조회 훅 (만들기는 화면에서 useAction(meetingMinutesApi.create)으로)
import { keepPreviousData, skipToken, useQuery } from '@tanstack/react-query';
import { MEETING_MINUTES_STATUS } from '@fantasteel/shared';
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
    // 서버가 백그라운드로 전사·분석하는 동안은 끝날 때까지 2초마다 다시 읽는다
    refetchInterval: (query) => {
      const status = query.state.data?.meetingMinutesStatus;
      return status === MEETING_MINUTES_STATUS.TRANSCRIBING || status === MEETING_MINUTES_STATUS.ANALYZING ? 2000 : false;
    },
  });
}
