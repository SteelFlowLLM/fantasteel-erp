// 재고·예약·배정 공통 코드. 값·표시명은 공통 코드 정의서 그대로 (PLAN 4장).

export const RESERVATION_STATUS = {
  ACTIVE: 'ACTIVE',
  CONVERTED: 'CONVERTED',
  RELEASED: 'RELEASED',
} as const;
export type ReservationStatus = (typeof RESERVATION_STATUS)[keyof typeof RESERVATION_STATUS];
export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  ACTIVE: '예약중',
  CONVERTED: '출고 전환',
  RELEASED: '해제',
};

/** 추천은 저장하지 않아 상태값이 없다. 배정 대기는 출하요청 품목의 미배정 상태다. */
export const ALLOCATION_STATUS = {
  CONFIRMED: 'CONFIRMED',
  CONSUMED: 'CONSUMED',
  RELEASED: 'RELEASED',
} as const;
export type AllocationStatus = (typeof ALLOCATION_STATUS)[keyof typeof ALLOCATION_STATUS];
export const ALLOCATION_STATUS_LABEL: Record<AllocationStatus, string> = {
  CONFIRMED: '배정 확정',
  CONSUMED: '소진',
  RELEASED: '해제',
};

export const ALLOCATION_PURPOSE = {
  SHIPMENT: 'SHIPMENT',
  HOT_ROLLING: 'HOT_ROLLING',
} as const;
export type AllocationPurpose = (typeof ALLOCATION_PURPOSE)[keyof typeof ALLOCATION_PURPOSE];
export const ALLOCATION_PURPOSE_LABEL: Record<AllocationPurpose, string> = {
  SHIPMENT: '출하',
  HOT_ROLLING: '열연 투입',
};
