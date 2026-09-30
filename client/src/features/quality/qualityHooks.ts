// 품질 화면의 조회·변경 훅. 쿼리 키 첫 요소는 실시간 주제 ('quality-inspections' · 'lots').
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { businessEventApi, type BusinessEventView } from '@/api/businessEvents';
import { qualityApi, type Inspection } from '@/api/quality';
import { useAction } from '@/hooks/useApi';
import { canView, useMe } from '@/stores/auth';
import { INSPECTION_RESULT_LABEL } from '@fantasteel/shared';

export const qualityKeys = {
  pending: ['quality-inspections', 'pending'] as const,
  done: ['quality-inspections', 'done'] as const,
  doneOfLot: (lotId: number | null) => ['quality-inspections', 'done', 'lot', lotId] as const,
  detail: (id: number | null) => ['quality-inspections', 'detail', id] as const,
  rejected: ['lots', 'rejected'] as const,
};

/** 검사 대기 LOT 전체 (공정별 탭은 화면에서 나눈다). 셸 배지와 같은 조회를 쓴다. */
export const usePendingInspections = (enabled = true) =>
  useQuery({ queryKey: qualityKeys.pending, queryFn: qualityApi.pending, enabled });

/** 셸 레일 배지: 검사 대기 LOT 수 (권한이 없으면 조회하지 않는다). */
export function usePendingInspectionCount(): number | undefined {
  const me = useMe();
  return usePendingInspections(canView(me, 'INSPECTION_REGISTER')).data?.length;
}

export const useDoneInspections = (enabled = true) =>
  useQuery({ queryKey: qualityKeys.done, queryFn: () => qualityApi.done(), enabled });

/** 목록(최근 300건)에 없는 LOT의 등록된 검사 (알림 링크로 들어왔을 때). 없으면 null. */
export const useInspectionOfLot = (lotId: number | null, enabled: boolean) =>
  useQuery({
    queryKey: qualityKeys.doneOfLot(lotId),
    queryFn: async () => (await qualityApi.done({ lotId: lotId! }))[0] ?? null,
    enabled: enabled && lotId !== null,
  });

export const useInspectionDetail = (id: number | null) =>
  useQuery({ queryKey: qualityKeys.detail(id), queryFn: () => qualityApi.get(id!), enabled: id !== null });

export const useRejectedLots = () => useQuery({ queryKey: qualityKeys.rejected, queryFn: qualityApi.rejectedLots });

/** 검사 등록: 서버가 자동 판정한다. */
export function useRegisterInspection(onDone: (inspection: Inspection) => void) {
  return useAction(qualityApi.register, {
    success: (i) => `${i.lot.lotNo}: 시스템이 ${INSPECTION_RESULT_LABEL[i.inspectionResult]}으로 판정했어요`,
    invalidate: ['quality-inspections', 'lots', 'inventories', 'production-plans'],
    onSuccess: onDone,
  });
}

export function useSetDisposition(onDone: () => void) {
  return useAction(qualityApi.setDisposition, {
    success: '불합격 처리 상태를 지정했어요',
    invalidate: ['lots', 'quality-inspections', 'business-events'],
    onSuccess: onDone,
  });
}

/** 지금 시각 (대기 시간 표시용) */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/**
 * 검사를 등록한 직후 "그 뒤에 무슨 일이 있었는지" — 작업 로그(business-events)에서 읽는다.
 * LOT 이벤트(검사·불합격 판정·배정 해제)와 수주 이벤트(자동 예약)를 검사 시각 근처로 좁혀 합친다.
 */
export function useAfterInspectionEvents(inspection: Inspection): { events: BusinessEventView[]; isLoading: boolean } {
  const lotId = inspection.lot.id;
  const salesOrderId = inspection.lot.salesOrderId;
  const lotQ = useQuery({ queryKey: ['business-events', 'quality-after', 'lot', lotId], queryFn: () => businessEventApi.list({ lotId, limit: 30 }) });
  const orderQ = useQuery({
    queryKey: ['business-events', 'quality-after', 'order', salesOrderId],
    queryFn: () => businessEventApi.list({ salesOrderId: salesOrderId!, eventType: 'AUTO_RESERVED', order: 'desc', limit: 10 }),
    enabled: salesOrderId !== null,
  });
  const at = new Date(inspection.inspectedAt).getTime();
  const seen = new Set<number>();
  const events = [...(lotQ.data?.items ?? []), ...(orderQ.data?.items ?? [])]
    .filter((e) => {
      const t = new Date(e.occurredAt).getTime();
      if (seen.has(e.id) || t < at - 2_000 || t > at + 30_000) return false;
      seen.add(e.id);
      return true;
    })
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id - b.id);
  return { events, isLoading: lotQ.isLoading || (salesOrderId !== null && orderQ.isLoading) };
}


/** 그 LOT 자신의 작업 로그 (시간순). 이력 카드용. */
export const useLotEvents = (lotId: number | null) =>
  useQuery({ queryKey: ['business-events', 'quality-lot', lotId], queryFn: () => businessEventApi.list({ lotId: lotId!, limit: 100 }), enabled: lotId !== null });
