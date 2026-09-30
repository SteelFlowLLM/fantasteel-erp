// 생산 화면(생산계획·공정 실적·열연 투입)이 같이 쓰는 조회 훅. 쿼리 키 첫 요소는 실시간 주제 이름이다.
import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { productionApi, type PlanListQuery } from '@/api/production';
import { canUse, useMe } from '@/stores/auth';

/** 계획·실적·배정이 바뀌면 같이 다시 불러올 주제 */
export const PLAN_TOPICS = ['production-plans', 'production-results', 'lots', 'inventories', 'allocations'];

export function usePlans(query: PlanListQuery = {}) {
  return useQuery({ queryKey: ['production-plans', 'list', query], queryFn: () => productionApi.plans(query) });
}

export function usePlanDetail(id: number | null) {
  return useQuery({ queryKey: ['production-plans', 'detail', id], queryFn: () => productionApi.plan(id as number), enabled: id !== null });
}

export function usePlanResults(planId: number | null) {
  return useQuery({ queryKey: ['production-results', 'list', { planId }], queryFn: () => productionApi.results({ planId: planId as number }), enabled: planId !== null });
}

/** 주소의 `?plan=<id>` — 선택한 생산계획 */
export function usePlanParam(): [number | null, (id: number | null) => void] {
  const [params, setParams] = useSearchParams();
  const raw = Number(params.get('plan'));
  const id = Number.isInteger(raw) && raw > 0 ? raw : null;
  const set = useCallback(
    (next: number | null) => {
      setParams((prev) => {
        const p = new URLSearchParams(prev);
        if (next === null) p.delete('plan');
        else p.set('plan', String(next));
        return p;
      }, { replace: true });
    },
    [setParams],
  );
  return [id, set];
}

/** 레일 배지 `plansToConfirm`: 히트 편성을 기다리는 PLANNED 계획 수. 편성 권한(PLAN_CONFIRM 사용)이 있는 사람에게만 센다. */
export function usePlansToConfirmCount(): number | undefined {
  const me = useMe();
  const q = useQuery({
    queryKey: ['production-plans', 'list', { status: 'PLANNED' }],
    queryFn: () => productionApi.plans({ status: 'PLANNED' }),
    enabled: canUse(me, 'PLAN_CONFIRM'),
    refetchInterval: 60_000,
  });
  return q.data?.length;
}
