// 배정 추천·확정·해제 API — docs/api/inventory.md (배정 공통 타입, 3~5번)의 모양 그대로.
// 이 파일은 열연 투입(purpose = ROLLING) 화면이 쓴다. 타입은 출하 배정과 같은 모양이다.
import type { AllocationPurpose, AllocationStatus } from '@fantasteel/shared';
import { api } from './client';

/** 배정 대상: 목적에 따라 하나만 쓴다 */
export interface AllocationTarget {
  purpose: AllocationPurpose;
  shipmentRequestItemId?: number;
  productionPlanId?: number;
}

export interface AllocationLotView {
  lotId: number;
  lotNo: string;
  lotType: string;
  heatNo: string | null;
  /** 생산완료일 (FIFO 기준) */
  producedAt: string;
  yardName: string | null;
  /** 열연 배정에서만 true일 수 있다: 이 코일 수주 품목에 이미 귀속된 슬래브 */
  isEarmarked: boolean;
}

export interface ConfirmedAllocationView {
  id: number;
  lotId: number;
  lotNo: string;
  lotType: string;
  heatNo: string | null;
  producedAt: string;
  status: AllocationStatus;
  confirmedAt: string;
}

export interface AllocationRecommendationView {
  purpose: AllocationPurpose;
  shipmentRequestItemId: number | null;
  shipmentRequestId: number | null;
  productionPlanId: number | null;
  salesOrderItemId: number;
  salesOrderNo: string;
  salesOrderLineNo: number;
  productSpecId: number;
  specCode: string;
  requiredQty: number;
  confirmedQty: number;
  neededQty: number;
  /** FIFO 추천, neededQty만큼 (모자라면 그보다 적다) */
  recommendedLots: AllocationLotView[];
  shortageQty: number;
  /** 고를 수 있는 모든 LOT (FIFO 순, 최대 200) */
  candidateLots: AllocationLotView[];
  confirmedAllocations: ConfirmedAllocationView[];
}

export interface ConfirmAllocationBody extends AllocationTarget {
  lotIds: number[];
  releaseAllocationIds?: number[];
  reason?: string;
}

export interface AllocationConfirmView {
  purpose: AllocationPurpose;
  shipmentRequestItemId: number | null;
  shipmentRequestId: number | null;
  productionPlanId: number | null;
  allocations: ConfirmedAllocationView[];
  releasedAllocationIds: number[];
  recommendedLotNos: string[];
  isRecommendationFollowed: boolean;
  /** 확정 뒤 남은 배정 필요 매수 */
  neededQty: number;
  shipmentRequestItemStatus: string | null;
  shipmentRequestStatus: string | null;
}

export interface AllocationReleaseView {
  id: number;
  purpose: AllocationPurpose;
  status: AllocationStatus;
  lotId: number;
  lotNo: string;
  shipmentRequestItemStatus: string | null;
  shipmentRequestStatus: string | null;
}

export const allocationApi = {
  /** FIFO 추천 (아무것도 저장하지 않음) */
  recommend: (target: AllocationTarget) => api.post<AllocationRecommendationView>('/allocations/recommend', target),
  confirm: (body: ConfirmAllocationBody) => api.post<AllocationConfirmView>('/allocations', body),
  release: (input: { id: number; reason?: string }) => api.post<AllocationReleaseView>(`/allocations/${input.id}/release`, { reason: input.reason || undefined }),
};
