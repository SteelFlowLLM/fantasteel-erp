// 출하요청 조회·변경 훅 (TanStack Query). 변경 후에는 useAction이 모든 조회를 무효화한다.
import { useQuery } from '@tanstack/react-query';
import { shipmentRequestApi, shipmentRequestKeys } from '@/api/shipmentRequests';
import { useAction } from '@/hooks/useAction';
import { withEulReul } from '@/lib/josa';

export function useShipmentRequestList() {
  return useQuery({ queryKey: shipmentRequestKeys.list(), queryFn: shipmentRequestApi.list });
}

export function useShipmentRequestDetail(id: number | null) {
  return useQuery({
    queryKey: shipmentRequestKeys.detail(id ?? 0),
    queryFn: () => shipmentRequestApi.detail(id ?? 0),
    enabled: id !== null,
  });
}

export function useShippableCustomers() {
  return useQuery({ queryKey: shipmentRequestKeys.shippableCustomers(), queryFn: shipmentRequestApi.shippableCustomers });
}

export function useShippableItems(customerId: number | null) {
  return useQuery({
    queryKey: shipmentRequestKeys.shippableItems(customerId ?? 0),
    queryFn: () => shipmentRequestApi.shippableItems(customerId ?? 0),
    enabled: customerId !== null,
  });
}

export function useCreateShipmentRequest(onSuccess: (result: { id: number }) => void) {
  return useAction(shipmentRequestApi.create, {
    success: (r) => `출하요청 ${withEulReul(r.shipmentRequestNo)} 등록했어요 · FIFO 추천을 확인해 주세요`,
    invalidate: [shipmentRequestKeys.all],
    onSuccess,
  });
}

export function useConfirmShipmentAllocations(onSuccess?: () => void) {
  return useAction(shipmentRequestApi.confirmAllocations, {
    success: (r) => `LOT ${r.confirmedQty}건을 배정했어요`,
    invalidate: [shipmentRequestKeys.all],
    onSuccess,
  });
}

export function useChangeShipmentAllocation(onSuccess?: () => void) {
  return useAction(shipmentRequestApi.changeAllocation, {
    success: (r) => `배정을 바꿨어요 · 새 LOT ${r.lotNo}`,
    invalidate: [shipmentRequestKeys.all],
    onSuccess,
  });
}

export function useReleaseShipmentAllocation(onSuccess?: () => void) {
  return useAction(shipmentRequestApi.releaseAllocation, {
    success: (r) => `${r.lotNo} 배정을 해제했어요`,
    invalidate: [shipmentRequestKeys.all],
    onSuccess,
  });
}

export function useCancelShipmentRequest(onSuccess?: () => void) {
  return useAction(shipmentRequestApi.cancel, {
    success: (r) => `출하요청 ${withEulReul(r.shipmentRequestNo)} 취소했어요`,
    invalidate: [shipmentRequestKeys.all],
    onSuccess,
  });
}
