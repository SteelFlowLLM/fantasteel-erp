// 이 파일은 scripts/generate-codes.mjs가 공통 코드 정의서 2장에서 만든다. 손으로 고치지 않는다.
// 바꾸는 순서: 공통 코드 정의서 수정 → npm run codes -w @fantasteel/shared → 필요하면 CHECK 제약 마이그레이션

/** 예약 상태 (REQ-INV-002, REQ-INV-005) */
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

/** 배정 상태 (REQ-INV-006) */
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

/** 초안 상태 (Action Draft) (REQ-ACT-003) */
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

/** 품목 단위 유형 (REQ-MST-001) */
export const UNIT_TYPE = {
  QTY: 'QTY',
  TON: 'TON',
} as const;
export type UnitType = (typeof UNIT_TYPE)[keyof typeof UNIT_TYPE];
export const UNIT_TYPE_LABEL: Record<UnitType, string> = {
  QTY: '매수',
  TON: '톤',
};

/** 작업 로그 주체 구분 (REQ-LOG-001) */
export const ACTOR_TYPE = {
  USER: 'USER',
  SYSTEM: 'SYSTEM',
} as const;
export type ActorType = (typeof ACTOR_TYPE)[keyof typeof ACTOR_TYPE];
export const ACTOR_TYPE_LABEL: Record<ActorType, string> = {
  USER: '사용자',
  SYSTEM: '시스템',
};

/** 품목 유형 (REQ-MST-001) */
export const ITEM_TYPE = {
  RAW_MATERIAL: 'RAW_MATERIAL',
  SLAB: 'SLAB',
  COIL: 'COIL',
} as const;
export type ItemType = (typeof ITEM_TYPE)[keyof typeof ITEM_TYPE];
export const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  RAW_MATERIAL: '원료',
  SLAB: '슬래브',
  COIL: '코일',
};

/** 원료 유형 (REQ-MST-001) */
export const RAW_MATERIAL_TYPE = {
  IRON_ORE: 'IRON_ORE',
  COAL: 'COAL',
  LIMESTONE: 'LIMESTONE',
  FERROALLOY: 'FERROALLOY',
} as const;
export type RawMaterialType = (typeof RAW_MATERIAL_TYPE)[keyof typeof RAW_MATERIAL_TYPE];
export const RAW_MATERIAL_TYPE_LABEL: Record<RawMaterialType, string> = {
  IRON_ORE: '철광석',
  COAL: '석탄',
  LIMESTONE: '석회석',
  FERROALLOY: '합금철',
};

/** 역할 (REQ-AUTH-003) */
export const ROLE = {
  SALES: 'SALES',
  PURCHASE: 'PURCHASE',
  PRODUCTION: 'PRODUCTION',
  QUALITY: 'QUALITY',
  LOGISTICS: 'LOGISTICS',
  ADMIN: 'ADMIN',
} as const;
export type Role = (typeof ROLE)[keyof typeof ROLE];
export const ROLE_LABEL: Record<Role, string> = {
  SALES: '영업',
  PURCHASE: '구매',
  PRODUCTION: '생산',
  QUALITY: '품질',
  LOGISTICS: '물류',
  ADMIN: '관리자',
};

/** 권한 수준 (REQ-AUTH-003) */
export const PERMISSION_LEVEL = {
  USE: 'USE',
  VIEW: 'VIEW',
} as const;
export type PermissionLevel = (typeof PERMISSION_LEVEL)[keyof typeof PERMISSION_LEVEL];
export const PERMISSION_LEVEL_LABEL: Record<PermissionLevel, string> = {
  USE: '사용',
  VIEW: '조회',
};

/** 기능 권한 (REQ-AUTH-003) */
export const PERMISSION = {
  SALES_ORDER_CREATE: 'SALES_ORDER_CREATE',
  SALES_ORDER_CANCEL: 'SALES_ORDER_CANCEL',
  SHIPMENT_REQUEST_MANAGE: 'SHIPMENT_REQUEST_MANAGE',
  PURCHASE_REQUISITION_CREATE: 'PURCHASE_REQUISITION_CREATE',
  PURCHASE_ORDER_CONFIRM: 'PURCHASE_ORDER_CONFIRM',
  GOODS_RECEIPT_CONFIRM: 'GOODS_RECEIPT_CONFIRM',
  PRODUCTION_PLAN_CONFIRM: 'PRODUCTION_PLAN_CONFIRM',
  PRODUCTION_RESULT_CONFIRM: 'PRODUCTION_RESULT_CONFIRM',
  HOT_ROLLING_ALLOCATE: 'HOT_ROLLING_ALLOCATE',
  INSPECTION_REGISTER: 'INSPECTION_REGISTER',
  INSPECTION_STANDARD_MANAGE: 'INSPECTION_STANDARD_MANAGE',
  DISPOSITION_SET: 'DISPOSITION_SET',
  GOODS_ISSUE_CONFIRM: 'GOODS_ISSUE_CONFIRM',
  MILL_SHEET_READ: 'MILL_SHEET_READ',
  EMPLOYEE_MANAGE: 'EMPLOYEE_MANAGE',
  ORG_MANAGE: 'ORG_MANAGE',
  MASTER_MANAGE: 'MASTER_MANAGE',
} as const;
export type Permission = (typeof PERMISSION)[keyof typeof PERMISSION];
export const PERMISSION_LABEL: Record<Permission, string> = {
  SALES_ORDER_CREATE: '수주 등록',
  SALES_ORDER_CANCEL: '수주 취소',
  SHIPMENT_REQUEST_MANAGE: '출하요청·배정 확정',
  PURCHASE_REQUISITION_CREATE: '구매요청 등록·MRP',
  PURCHASE_ORDER_CONFIRM: '발주',
  GOODS_RECEIPT_CONFIRM: '입고 확정',
  PRODUCTION_PLAN_CONFIRM: '생산계획·히트 편성',
  PRODUCTION_RESULT_CONFIRM: '공정 실적(실적 시뮬레이션 포함)',
  HOT_ROLLING_ALLOCATE: '열연 투입 배정',
  INSPECTION_REGISTER: '검사 입력',
  INSPECTION_STANDARD_MANAGE: '검사 기준 관리',
  DISPOSITION_SET: '불합격 처리 상태 지정',
  GOODS_ISSUE_CONFIRM: '출고 확정',
  MILL_SHEET_READ: '밀시트 조회·출력',
  EMPLOYEE_MANAGE: '사원 관리',
  ORG_MANAGE: '부서·권한 관리',
  MASTER_MANAGE: '기준정보 관리',
};

/** LOT 유형 (REQ-LOT-001·003) */
export const LOT_TYPE = {
  RAW_MATERIAL: 'RAW_MATERIAL',
  HOT_METAL: 'HOT_METAL',
  HEAT: 'HEAT',
  SLAB: 'SLAB',
  COIL: 'COIL',
} as const;
export type LotType = (typeof LOT_TYPE)[keyof typeof LOT_TYPE];
export const LOT_TYPE_LABEL: Record<LotType, string> = {
  RAW_MATERIAL: '원료',
  HOT_METAL: '용선',
  HEAT: '히트',
  SLAB: '슬래브',
  COIL: '코일',
};

/** 공정 (REQ-MST-005, 기획안 도메인) */
export const PROCESS_TYPE = {
  IRONMAKING: 'IRONMAKING',
  STEELMAKING: 'STEELMAKING',
  CONTINUOUS_CASTING: 'CONTINUOUS_CASTING',
  HOT_ROLLING: 'HOT_ROLLING',
} as const;
export type ProcessType = (typeof PROCESS_TYPE)[keyof typeof PROCESS_TYPE];
export const PROCESS_TYPE_LABEL: Record<ProcessType, string> = {
  IRONMAKING: '제선',
  STEELMAKING: '제강',
  CONTINUOUS_CASTING: '연주',
  HOT_ROLLING: '열연',
};

/** 야드 유형 (REQ-MST-008 (원료·슬래브·코일 야드)) */
export const YARD_TYPE = {
  RAW_MATERIAL: 'RAW_MATERIAL',
  SLAB: 'SLAB',
  COIL: 'COIL',
} as const;
export type YardType = (typeof YARD_TYPE)[keyof typeof YARD_TYPE];
export const YARD_TYPE_LABEL: Record<YardType, string> = {
  RAW_MATERIAL: '원료 야드',
  SLAB: '슬래브 야드',
  COIL: '코일 야드',
};

/** 수주 품목 상태 (REQ-SO-005) */
export const SALES_ORDER_ITEM_STATUS = {
  OPEN: 'OPEN',
  PARTIALLY_SHIPPED: 'PARTIALLY_SHIPPED',
  SHIPPED: 'SHIPPED',
  CANCELLED: 'CANCELLED',
} as const;
export type SalesOrderItemStatus = (typeof SALES_ORDER_ITEM_STATUS)[keyof typeof SALES_ORDER_ITEM_STATUS];
export const SALES_ORDER_ITEM_STATUS_LABEL: Record<SalesOrderItemStatus, string> = {
  OPEN: '진행중',
  PARTIALLY_SHIPPED: '부분출하',
  SHIPPED: '출하완료',
  CANCELLED: '취소',
};

/** 생산계획 상태 (REQ-PRD-001, REQ-SO-006) */
export const PRODUCTION_PLAN_STATUS = {
  PLANNED: 'PLANNED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type ProductionPlanStatus = (typeof PRODUCTION_PLAN_STATUS)[keyof typeof PRODUCTION_PLAN_STATUS];
export const PRODUCTION_PLAN_STATUS_LABEL: Record<ProductionPlanStatus, string> = {
  PLANNED: '계획',
  IN_PROGRESS: '진행중',
  COMPLETED: '완료',
  CANCELLED: '취소',
};

/** 구매요청 상태 (REQ-PUR-001~002, REQ-AUTH-004) */
export const PURCHASE_REQUISITION_STATUS = {
  WAITING_APPROVAL: 'WAITING_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  ORDERED: 'ORDERED',
} as const;
export type PurchaseRequisitionStatus = (typeof PURCHASE_REQUISITION_STATUS)[keyof typeof PURCHASE_REQUISITION_STATUS];
export const PURCHASE_REQUISITION_STATUS_LABEL: Record<PurchaseRequisitionStatus, string> = {
  WAITING_APPROVAL: '승인 대기',
  APPROVED: '승인',
  REJECTED: '반려',
  ORDERED: '발주 완료',
};

/** 발주 상태 (REQ-PUR-003~004 (부분 입고)) */
export const PURCHASE_ORDER_STATUS = {
  CONFIRMED: 'CONFIRMED',
  PARTIALLY_RECEIVED: 'PARTIALLY_RECEIVED',
  RECEIVED: 'RECEIVED',
} as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUS)[keyof typeof PURCHASE_ORDER_STATUS];
export const PURCHASE_ORDER_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  CONFIRMED: '발주 확정',
  PARTIALLY_RECEIVED: '부분 입고',
  RECEIVED: '입고 완료',
};

/** 검사 판정 (REQ-QC-003) */
export const INSPECTION_RESULT = {
  PENDING: 'PENDING',
  PASS: 'PASS',
  FAIL: 'FAIL',
} as const;
export type InspectionResult = (typeof INSPECTION_RESULT)[keyof typeof INSPECTION_RESULT];
export const INSPECTION_RESULT_LABEL: Record<InspectionResult, string> = {
  PENDING: '판정 대기',
  PASS: '합격',
  FAIL: '불합격',
};

/** 불합격 상태 (REQ-QC-004 (보류 / 격하 / 폐기)) */
export const DISPOSITION_STATUS = {
  HOLD: 'HOLD',
  DOWNGRADED: 'DOWNGRADED',
  SCRAPPED: 'SCRAPPED',
} as const;
export type DispositionStatus = (typeof DISPOSITION_STATUS)[keyof typeof DISPOSITION_STATUS];
export const DISPOSITION_STATUS_LABEL: Record<DispositionStatus, string> = {
  HOLD: '보류',
  DOWNGRADED: '격하',
  SCRAPPED: '폐기',
};

/** 배정 목적 (REQ-INV-006 (출하요청·열연 투입)) */
export const ALLOCATION_PURPOSE = {
  SHIPMENT: 'SHIPMENT',
  HOT_ROLLING: 'HOT_ROLLING',
} as const;
export type AllocationPurpose = (typeof ALLOCATION_PURPOSE)[keyof typeof ALLOCATION_PURPOSE];
export const ALLOCATION_PURPOSE_LABEL: Record<AllocationPurpose, string> = {
  SHIPMENT: '출하',
  HOT_ROLLING: '열연 투입',
};

/** LOT 연결 근거 (REQ-LOT-002) */
export const LOT_RELATION_EVIDENCE = {
  PERIOD_BASED: 'PERIOD_BASED',
  ACTUAL_INPUT: 'ACTUAL_INPUT',
} as const;
export type LotRelationEvidence = (typeof LOT_RELATION_EVIDENCE)[keyof typeof LOT_RELATION_EVIDENCE];
export const LOT_RELATION_EVIDENCE_LABEL: Record<LotRelationEvidence, string> = {
  PERIOD_BASED: '기간 기반',
  ACTUAL_INPUT: '실제 투입',
};

/** 초안 업무 유형 (REQ-ACT-001·005) */
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

/** 채팅방 유형 (REQ-MSG-001 (1:1, 그룹, 업무방)) */
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

/** 메시지 유형 (REQ-MSG-002 (문서에 없는 추가 기능: 시스템 메시지, 2026-10-08 스키마 1차 #151)) */
export const MESSAGE_TYPE = {
  USER: 'USER',
  SYSTEM: 'SYSTEM',
} as const;
export type MessageType = (typeof MESSAGE_TYPE)[keyof typeof MESSAGE_TYPE];
export const MESSAGE_TYPE_LABEL: Record<MessageType, string> = {
  USER: '일반',
  SYSTEM: '시스템',
};

/** LOT 상태 (REQ-LOT-001, REQ-INV-001) */
export const LOT_STATUS = {
  AVAILABLE: 'AVAILABLE',
  CONSUMED: 'CONSUMED',
  SHIPPED: 'SHIPPED',
} as const;
export type LotStatus = (typeof LOT_STATUS)[keyof typeof LOT_STATUS];
export const LOT_STATUS_LABEL: Record<LotStatus, string> = {
  AVAILABLE: '재고',
  CONSUMED: '투입 소진',
  SHIPPED: '출고',
};

/** 출하요청 상태 (REQ-SHP-001·002, REQ-INV-006) */
export const SHIPMENT_REQUEST_STATUS = {
  REQUESTED: 'REQUESTED',
  ALLOCATED: 'ALLOCATED',
  ISSUED: 'ISSUED',
  CANCELLED: 'CANCELLED',
} as const;
export type ShipmentRequestStatus = (typeof SHIPMENT_REQUEST_STATUS)[keyof typeof SHIPMENT_REQUEST_STATUS];
export const SHIPMENT_REQUEST_STATUS_LABEL: Record<ShipmentRequestStatus, string> = {
  REQUESTED: '배정 대기',
  ALLOCATED: '배정 확정',
  ISSUED: '출고 완료',
  CANCELLED: '취소',
};

/** 업무 상태 (REQ-NTF-001) */
export const TASK_STATUS = {
  OPEN: 'OPEN',
  DONE: 'DONE',
} as const;
export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  OPEN: '진행',
  DONE: '완료',
};

/** 알림 유형 (REQ-MSG-005) */
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

/** 작업 로그 이벤트 유형 (REQ-LOG-002) */
export const BUSINESS_EVENT_TYPE = {
  SALES_ORDER_CREATED: 'SALES_ORDER_CREATED',
  SALES_ORDER_CANCELLED: 'SALES_ORDER_CANCELLED',
  PRODUCTION_PLAN_CREATED: 'PRODUCTION_PLAN_CREATED',
  PRODUCTION_PLAN_CANCELLED: 'PRODUCTION_PLAN_CANCELLED',
  REPRODUCTION_PLAN_CREATED: 'REPRODUCTION_PLAN_CREATED',
  SURPLUS_CONVERTED: 'SURPLUS_CONVERTED',
  PRODUCTION_STARTED: 'PRODUCTION_STARTED',
  PRODUCTION_RESULT_REGISTERED: 'PRODUCTION_RESULT_REGISTERED',
  INSPECTION_REGISTERED: 'INSPECTION_REGISTERED',
  DISPOSITION_SET: 'DISPOSITION_SET',
  RESERVATION_CREATED: 'RESERVATION_CREATED',
  RESERVATION_CONVERTED: 'RESERVATION_CONVERTED',
  RESERVATION_RELEASED: 'RESERVATION_RELEASED',
  ALLOCATION_RECOMMENDED: 'ALLOCATION_RECOMMENDED',
  ALLOCATION_CONFIRMED: 'ALLOCATION_CONFIRMED',
  ALLOCATION_CHANGED: 'ALLOCATION_CHANGED',
  ALLOCATION_RELEASED: 'ALLOCATION_RELEASED',
  PURCHASE_REQUISITION_CREATED: 'PURCHASE_REQUISITION_CREATED',
  PURCHASE_REQUISITION_APPROVED: 'PURCHASE_REQUISITION_APPROVED',
  PURCHASE_REQUISITION_REJECTED: 'PURCHASE_REQUISITION_REJECTED',
  PURCHASE_ORDER_CREATED: 'PURCHASE_ORDER_CREATED',
  GOODS_RECEIPT_CONFIRMED: 'GOODS_RECEIPT_CONFIRMED',
  SHIPMENT_REQUEST_CREATED: 'SHIPMENT_REQUEST_CREATED',
  GOODS_ISSUE_CONFIRMED: 'GOODS_ISSUE_CONFIRMED',
  MILL_SHEET_ISSUED: 'MILL_SHEET_ISSUED',
  DRAFT_CREATED: 'DRAFT_CREATED',
  DRAFT_CONFIRMED: 'DRAFT_CONFIRMED',
  DRAFT_REJECTED: 'DRAFT_REJECTED',
  DRAFT_EXECUTED: 'DRAFT_EXECUTED',
} as const;
export type BusinessEventType = (typeof BUSINESS_EVENT_TYPE)[keyof typeof BUSINESS_EVENT_TYPE];
export const BUSINESS_EVENT_TYPE_LABEL: Record<BusinessEventType, string> = {
  SALES_ORDER_CREATED: '수주 등록',
  SALES_ORDER_CANCELLED: '수주 취소',
  PRODUCTION_PLAN_CREATED: '생산계획 생성',
  PRODUCTION_PLAN_CANCELLED: '생산계획 취소',
  REPRODUCTION_PLAN_CREATED: '재생산 계획 생성',
  SURPLUS_CONVERTED: '여재 전환',
  PRODUCTION_STARTED: '작업 시작',
  PRODUCTION_RESULT_REGISTERED: '실적 등록(작업 완료)',
  INSPECTION_REGISTERED: '검사 등록·판정',
  DISPOSITION_SET: '불합격 처리 상태 지정',
  RESERVATION_CREATED: '예약',
  RESERVATION_CONVERTED: '예약 전환',
  RESERVATION_RELEASED: '예약 해제',
  ALLOCATION_RECOMMENDED: '배정 추천',
  ALLOCATION_CONFIRMED: '배정 확정',
  ALLOCATION_CHANGED: '배정 변경',
  ALLOCATION_RELEASED: '배정 해제',
  PURCHASE_REQUISITION_CREATED: '구매요청 등록',
  PURCHASE_REQUISITION_APPROVED: '구매요청 승인',
  PURCHASE_REQUISITION_REJECTED: '구매요청 반려',
  PURCHASE_ORDER_CREATED: '발주',
  GOODS_RECEIPT_CONFIRMED: '입고 확정',
  SHIPMENT_REQUEST_CREATED: '출하요청 등록',
  GOODS_ISSUE_CONFIRMED: '출고 확정',
  MILL_SHEET_ISSUED: '밀시트 발행',
  DRAFT_CREATED: '초안 생성',
  DRAFT_CONFIRMED: '초안 확정',
  DRAFT_REJECTED: '초안 반려',
  DRAFT_EXECUTED: '초안 실행(ERP 반영)',
};
