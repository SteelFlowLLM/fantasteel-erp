// 협업(초안·업무·알림·메신저·과거 사례) 공통 코드. 값·표시명은 공통 코드 정의서 그대로 (PLAN 4장).

export const DRAFT_STATUS = {
  AI_GENERATED: 'AI_GENERATED',
  WAITING_APPROVAL: 'WAITING_APPROVAL',
  APPROVED: 'APPROVED',
  EXECUTED: 'EXECUTED',
  REJECTED: 'REJECTED',
} as const;
export type DraftStatus = (typeof DRAFT_STATUS)[keyof typeof DRAFT_STATUS];
export const DRAFT_STATUS_LABEL: Record<DraftStatus, string> = {
  AI_GENERATED: '생성',
  WAITING_APPROVAL: '확인 대기',
  APPROVED: '확정',
  EXECUTED: 'ERP 반영',
  REJECTED: '반려',
};

/** P1은 PURCHASE_REQUISITION_CREATE만 확정이다. 나머지는 🟡 제안 값(P2). */
export const ACTION_TYPE = {
  PURCHASE_REQUISITION_CREATE: 'PURCHASE_REQUISITION_CREATE',
  SHIPMENT_REQUEST_CREATE: 'SHIPMENT_REQUEST_CREATE',
  SALES_ORDER_CREATE: 'SALES_ORDER_CREATE',
  PRODUCTION_PLAN_CREATE: 'PRODUCTION_PLAN_CREATE',
  ALLOCATION_CONFIRM: 'ALLOCATION_CONFIRM',
  REPRODUCTION_PLAN_CREATE: 'REPRODUCTION_PLAN_CREATE',
} as const;
export type ActionType = (typeof ACTION_TYPE)[keyof typeof ACTION_TYPE];
export const ACTION_TYPE_LABEL: Record<ActionType, string> = {
  PURCHASE_REQUISITION_CREATE: '구매요청 생성',
  SHIPMENT_REQUEST_CREATE: '출하요청 생성',
  SALES_ORDER_CREATE: '수주 등록',
  PRODUCTION_PLAN_CREATE: '생산계획 생성',
  ALLOCATION_CONFIRM: '배정 확정',
  REPRODUCTION_PLAN_CREATE: '재생산 계획 생성',
};
export const ACTION_TYPE_GRADE: Record<ActionType, 'P1' | 'P2'> = {
  PURCHASE_REQUISITION_CREATE: 'P1',
  SHIPMENT_REQUEST_CREATE: 'P2',
  SALES_ORDER_CREATE: 'P2',
  PRODUCTION_PLAN_CREATE: 'P2',
  ALLOCATION_CONFIRM: 'P2',
  REPRODUCTION_PLAN_CREATE: 'P2',
};

export const CHAT_ROOM_TYPE = {
  DIRECT: 'DIRECT',
  GROUP: 'GROUP',
  WORK: 'WORK',
} as const;
export type ChatRoomType = (typeof CHAT_ROOM_TYPE)[keyof typeof CHAT_ROOM_TYPE];
export const CHAT_ROOM_TYPE_LABEL: Record<ChatRoomType, string> = {
  DIRECT: '1:1',
  GROUP: '그룹',
  WORK: '업무방',
};

export const TASK_STATUS = {
  OPEN: 'OPEN',
  DONE: 'DONE',
} as const;
export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  OPEN: '진행',
  DONE: '완료',
};

/** MENTION·WORK_ROOM_MESSAGE는 확정, 나머지 3개는 🟡 제안 값이다 (PLAN 7장: 알림 유형 5개). */
export const NOTIFICATION_TYPE = {
  MENTION: 'MENTION',
  WORK_ROOM_MESSAGE: 'WORK_ROOM_MESSAGE',
  TASK_ASSIGNED: 'TASK_ASSIGNED',
  APPROVAL_REQUESTED: 'APPROVAL_REQUESTED',
  APPROVAL_RESULT: 'APPROVAL_RESULT',
} as const;
export type NotificationType = (typeof NOTIFICATION_TYPE)[keyof typeof NOTIFICATION_TYPE];
export const NOTIFICATION_TYPE_LABEL: Record<NotificationType, string> = {
  MENTION: '멘션',
  WORK_ROOM_MESSAGE: '업무방 메시지',
  TASK_ASSIGNED: '업무 지정',
  APPROVAL_REQUESTED: '승인 요청',
  APPROVAL_RESULT: '승인 결과',
};

/** 🟡 제안 값 (EX 과거 사례) */
export const CASE_CATEGORY = {
  QUALITY: 'QUALITY',
  EQUIPMENT: 'EQUIPMENT',
} as const;
export type CaseCategory = (typeof CASE_CATEGORY)[keyof typeof CASE_CATEGORY];
export const CASE_CATEGORY_LABEL: Record<CaseCategory, string> = {
  QUALITY: '품질',
  EQUIPMENT: '설비',
};
