// 수주 조회 훅 (목록·상세·생산 연결·이력·등록 미리보기·업무방 요약)
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { salesOrderApi, salesOrderKeys, type SalesOrderPreviewInputLine } from '@/api/salesOrders';

export function useSalesOrderList() {
  return useQuery({ queryKey: salesOrderKeys.list(), queryFn: salesOrderApi.list });
}

export function useSalesOrderDetail(salesOrderId: number | null) {
  return useQuery({
    queryKey: salesOrderKeys.detail(salesOrderId ?? 0),
    queryFn: () => salesOrderApi.detail(salesOrderId ?? 0),
    enabled: salesOrderId !== null,
  });
}

export function useSalesOrderProductionLinks(salesOrderId: number | null) {
  return useQuery({
    queryKey: salesOrderKeys.production(salesOrderId ?? 0),
    queryFn: () => salesOrderApi.productionLinks(salesOrderId ?? 0),
    enabled: salesOrderId !== null,
  });
}

export function useSalesOrderTimeline(salesOrderId: number | null) {
  return useQuery({
    queryKey: salesOrderKeys.timeline(salesOrderId ?? 0),
    queryFn: () => salesOrderApi.timeline(salesOrderId ?? 0),
    enabled: salesOrderId !== null,
  });
}

/** 등록 화면 미리보기: 규격·매수가 맞는 줄만 넘긴다. 입력이 바뀌는 동안 앞 결과를 그대로 보인다. */
export function useSalesOrderPreview(lines: readonly SalesOrderPreviewInputLine[]) {
  return useQuery({
    queryKey: salesOrderKeys.preview(lines),
    queryFn: () => salesOrderApi.preview(lines),
    enabled: lines.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
}

export function useSalesOrderWorkRoom(salesOrderId: number | null) {
  return useQuery({
    queryKey: salesOrderKeys.workRoom(salesOrderId ?? 0),
    queryFn: () => salesOrderApi.workRoom(salesOrderId ?? 0),
    enabled: salesOrderId !== null,
  });
}
