// 업무 조회 훅 (업무·알림 화면의 업무 탭)
import { useQuery } from '@tanstack/react-query';
import { taskApi, taskKeys, type TaskScope } from '@/api/tasks';
import { useMe } from '@/hooks/useMe';

export function useTaskList(scope: TaskScope) {
  const me = useMe();
  return useQuery({ queryKey: taskKeys.list(me.employeeId, scope), queryFn: () => taskApi.list(scope) });
}

/** 내 업무 요약 (탭 숫자·부제). today = 'YYYY-MM-DD' */
export function useTaskSummary(today: string) {
  const me = useMe();
  return useQuery({ queryKey: [...taskKeys.summary(me.employeeId), today], queryFn: () => taskApi.summary(today) });
}
