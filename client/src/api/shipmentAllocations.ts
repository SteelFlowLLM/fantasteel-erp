// 출하 배정(purpose = SHIPMENT) 추천·확정·해제 API — docs/api/inventory.md (배정 공통 타입, 3~5번)의 모양 그대로.
// 열연 투입(purpose = ROLLING)은 src/api/allocations.ts 가 맡는다.
import type { AllocationStatus, ShipmentRequestItemStatus, ShipmentRequestStatus } from '@fantasteel/shared';
import { api } from './client';

export interface ShipmentAllocationLot {
  lotId: number;
  lotNo: string;
  lotType: string;
  heatNo: string | null;
  /** 생산완료일 (FIFO 기준) */
  producedAt: string;
  yardName: string | null;
  isEarmarked: boolean;
}

export interface ShipmentConfirmedAllocation {
  id: number;
  lotId: number;
  lotNo: string;
  lotType: string;
  heatNo: string | null;
  producedAt: string;
  status: AllocationStatus;
  confirmedAt: string;
}

export interface ShipmentAllocationRecommendation {
  purpose: 'SHIPMENT';
  shipmentRequestItemId: number | null;
  shipmentRequestId: number | null;
  productionPlanId: number | null;
  salesOrderItemId: number;
  salesOrderNo: string;
  salesOrderLineNo: number;
  productSpecId: number;
  specCode: string;
  /** 필요한 전체 매수 = confirmedQty + neededQty */
  requiredQty: number;
  confirmedQty: number;
  /** 아직 배정해야 할 매수 */
  neededQty: number;
  /** FIFO 추천 (생산완료일 오름차순, 같으면 LOT 번호 순), neededQty만큼 */
  recommendedLots: ShipmentAllocationLot[];
  /** 추천으로 못 채우는 매수 */
  shortageQty: number;
  /** 고를 수 있는 모든 LOT (FIFO 순, 최대 200) */
  candidateLots: ShipmentAllocationLot[];
  confirmedAllocations: ShipmentConfirmedAllocation[];
}

export interface ConfirmShipmentAllocationInput {
  shipmentRequestItemId: number;
  lotIds: number[];
  /** 배정 변경: 먼저 해제할 기존 확정 배정 (해제와 새 확정이 한 트랜잭션) */
  releaseAllocationIds?: number[];
  /** 추천과 다르게 고르거나 바꾸는 사유 (500자 이하, 작업 로그에 남는다) */
  reason?: string;
}

export interface ShipmentAllocationConfirmView {
  purpose: 'SHIPMENT';
  shipmentRequestItemId: number | null;
  shipmentRequestId: number | null;
  productionPlanId: number | null;
  allocations: ShipmentConfirmedAllocation[];
  releasedAllocationIds: number[];
  recommendedLotNos: string[];
  isRecommendationFollowed: boolean;
  neededQty: number;
  shipmentRequestItemStatus: ShipmentRequestItemStatus | null;
  shipmentRequestStatus: ShipmentRequestStatus | null;
}

export interface ShipmentAllocationReleaseView {
  id: number;
  purpose: 'SHIPMENT';
  status: AllocationStatus;
  lotId: number;
  lotNo: string;
  shipmentRequestItemStatus: ShipmentRequestItemStatus | null;
  shipmentRequestStatus: ShipmentRequestStatus | null;
}

export const shipmentAllocationApi = {
  /** FIFO 추천 (아무것도 저장하지 않는다) */
  recommend: (shipmentRequestItemId: number) =>
    api.post<ShipmentAllocationRecommendation>('/allocations/recommend', { purpose: 'SHIPMENT', shipmentRequestItemId }),
  confirm: (input: ConfirmShipmentAllocationInput) =>
    api.post<ShipmentAllocationConfirmView>('/allocations', {
      purpose: 'SHIPMENT',
      shipmentRequestItemId: input.shipmentRequestItemId,
      lotIds: input.lotIds,
      releaseAllocationIds: input.releaseAllocationIds?.length ? input.releaseAllocationIds : undefined,
      reason: input.reason?.trim() || undefined,
    }),
  release: (input: { id: number; reason?: string }) =>
    api.post<ShipmentAllocationReleaseView>(`/allocations/${input.id}/release`, { reason: input.reason?.trim() || undefined }),
};
