// LOT 추적 화면의 조회 훅. 쿼리 키 첫 요소는 실시간 주제 'lots' (LOT이 바뀌면 자동으로 다시 불러온다).
import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { LotType } from '@fantasteel/shared';
import { lotApi, type TraceDirection } from '@/api/lots';

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** LOT 번호로 상세 (루트 LOT의 id·종류를 알아내는 용도). */
export const useLotByNo = (lotNo: string) =>
  useQuery({ queryKey: ['lots', 'by-no', lotNo], queryFn: () => lotApi.byNo(lotNo), enabled: !!lotNo });

export const useLotDetail = (id: number | null) =>
  useQuery({ queryKey: ['lots', 'detail', id], queryFn: () => lotApi.detail(id!), enabled: id !== null });

export const useLotTrace = (id: number | null, direction: TraceDirection) =>
  useQuery({ queryKey: ['lots', 'trace', id, direction], queryFn: () => lotApi.trace(id!, direction), enabled: id !== null });

/** 최근 LOT (생산완료일 내림차순). 종류를 고르면 그 종류만. */
export const useRecentLots = (lotType: LotType | '') =>
  useQuery({ queryKey: ['lots', 'list', { lotType, limit: 40 }], queryFn: () => lotApi.list({ lotType: lotType || undefined, limit: 40 }), placeholderData: keepPreviousData });

/** 번호 일부로 찾기 (자동완성). */
export const useLotSearch = (q: string) => {
  const text = q.trim();
  return useQuery({ queryKey: ['lots', 'search', text], queryFn: () => lotApi.search(text, 20), enabled: text.length > 0, placeholderData: keepPreviousData });
};

/** 처음 화면에 들어왔을 때 방향: 코일·슬래브는 역추적(어디서 왔나), 원료·용선·히트는 정추적(어디로 갔나). */
export const defaultDirection = (lotType: LotType): TraceDirection => (lotType === 'COIL' || lotType === 'SLAB' ? 'backward' : 'forward');
