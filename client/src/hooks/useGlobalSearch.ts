// 통합 검색: 입력이 멈추고 잠깐 뒤에, 2글자 이상일 때만 찾는다.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/api/queryKeys';
import { SEARCH_MIN_LENGTH, searchApi, type SearchHit } from '@/api/search';

const SEARCH_DEBOUNCE_MS = 250;

/** 입력이 멈춘 뒤의 값 (검색창 공통) */
export function useDebouncedValue<T>(value: T, delayMs = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function useGlobalSearch(keyword: string): { items: SearchHit[]; isSearching: boolean; isActive: boolean } {
  const term = keyword.trim();
  const debounced = useDebouncedValue(term);
  const isActive = term.length >= SEARCH_MIN_LENGTH;
  const settled = debounced === term;
  const query = useQuery({ queryKey: queryKeys.search(debounced), queryFn: () => searchApi.search(debounced), enabled: isActive && settled });
  if (!isActive) return { items: [], isSearching: false, isActive };
  // 입력이 바뀌는 중에는 앞 검색 결과를 보이지 않는다 (Enter로 엉뚱한 곳에 가지 않게)
  return { items: settled ? (query.data ?? []) : [], isSearching: !settled || query.isFetching, isActive };
}
