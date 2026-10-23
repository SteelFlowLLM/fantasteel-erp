// 수주 조회 훅 (목록·상세·생산 연결·이력·등록 미리보기·업무방 요약·취소 창의 구매 진행 영향)
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { salesOrderApi, salesOrderKeys, type SalesOrderPreviewInputLine } from '@/api/salesOrders';
import { PERMISSION } from '@/codes';
import { useDebouncedValue } from '@/hooks/useGlobalSearch';
import { useCanView } from '@/hooks/usePermission';

export function useSalesOrderList() {
  return useQuery({ queryKey: salesOrderKeys.list(), queryFn: salesOrderApi.list });
}

export function useSalesOrderDetail(salesOrderId: number | null) {
  // 밀시트 목록은 밀시트 조회 권한이 있을 때만 부른다 (생산·품질 등은 수주는 보지만 밀시트는 못 본다)
  const withMillSheets = useCanView(PERMISSION.MILL_SHEET_READ);
  return useQuery({
    queryKey: [...salesOrderKeys.detail(salesOrderId ?? 0), withMillSheets],
    queryFn: () => salesOrderApi.detail(salesOrderId ?? 0, withMillSheets),
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

/** 수량을 치는 동안 한 글자마다 미리보기(요청 6개)를 부르지 않게 입력이 멈춘 뒤 부르는 시간 (가정값, 이슈 #476) */
export const SALES_ORDER_PREVIEW_DEBOUNCE_MS = 400;

/** 등록 화면 미리보기: 규격·매수가 맞는 줄만 넘긴다. 입력이 멈춘 뒤 부르고, 바뀌는 동안 앞 결과를 그대로 보인다. */
export function useSalesOrderPreview(inputLines: readonly SalesOrderPreviewInputLine[]) {
  const lines = useDebouncedValue(inputLines, SALES_ORDER_PREVIEW_DEBOUNCE_MS);
  return useQuery({
    queryKey: salesOrderKeys.preview(lines),
    queryFn: () => salesOrderApi.preview(lines),
    enabled: lines.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
}

/** 수주 취소 창: 취소·연결 해제될 계획에 연결된 구매요청·발주 (표시만, BP-PRD-01) */
export function useSalesOrderCancelPurchaseImpact(salesOrderId: number) {
  return useQuery({
    queryKey: salesOrderKeys.cancelPurchaseImpact(salesOrderId),
    queryFn: () => salesOrderApi.cancelPurchaseImpact(salesOrderId),
  });
}

export function useSalesOrderWorkRoom(salesOrderId: number | null) {
  return useQuery({
    queryKey: salesOrderKeys.workRoom(salesOrderId ?? 0),
    queryFn: () => salesOrderApi.workRoom(salesOrderId ?? 0),
    enabled: salesOrderId !== null,
  });
}
