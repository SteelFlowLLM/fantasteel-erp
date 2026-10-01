// 생산 화면들이 주소의 ?plan=<id>로 고른 계획을 주고받는다 (생산계획 → 작업 실적 → 열연 투입 배정 링크).
import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export function useProductionPlanParam(): [number | null, (id: number) => void] {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = searchParams.get('plan');
  const parsed = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
  const setPlan = useCallback(
    (id: number) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set('plan', String(id));
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );
  return [parsed, setPlan];
}
