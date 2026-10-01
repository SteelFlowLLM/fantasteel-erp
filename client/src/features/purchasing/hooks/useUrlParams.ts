'use client';

// 주소 파라미터(?pr=·?po=·?item= …)로 고른 항목을 둔다. 알림 링크(/approvals?pr=…)와 새로 고침에도 같은 화면이 열린다.
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

export type UrlParamValue = string | number | null;

export function useUrlParams() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const getNumber = useCallback(
    (name: string): number | null => {
      const raw = params.get(name);
      if (raw === null || !/^\d+$/.test(raw)) return null;
      return Number(raw);
    },
    [params],
  );

  const get = useCallback((name: string): string | null => params.get(name), [params]);

  /** 바꿀 값만 넘긴다. null이면 지운다. 기록을 쌓지 않고 바꾼다. */
  const set = useCallback(
    (updates: Record<string, UrlParamValue>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') next.delete(key);
        else next.set(key, String(value));
      }
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  return { get, getNumber, set };
}
