// 공통코드. 값·타입·한글 표시명을 여기 한 번만 정의하고 server·client가 import한다 (코드 컨벤션 4장).
// "요구사항 지정" = 요구사항 정의서에 값이 있는 코드. "제안" = 업무 프로세스 정의서 10장 제안 값
// (공통코드 정의서 확정 전 임시). 그 밖은 docs/NAMES-TO-CONFIRM.md 참고.
import type { CodeOf } from './define';

// ───────────── 요구사항 지정 ─────────────
export const UNIT_TYPE = { QTY: 'QTY', TON: 'TON' } as const;
export type UnitType = CodeOf<typeof UNIT_TYPE>;

export const RESERVATION_STATUS = { ACTIVE: 'ACTIVE', CONVERTED: 'CONVERTED', RELEASED: 'RELEASED' } as const;
export type ReservationStatus = CodeOf<typeof RESERVATION_STATUS>;
export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = { ACTIVE: '예약중', CONVERTED: '출고 전환', RELEASED: '해제' };

export const ALLOCATION_STATUS = { CONFIRMED: 'CONFIRMED', CONSUMED: 'CONSUMED', RELEASED: 'RELEASED' } as const;
export type AllocationStatus = CodeOf<typeof ALLOCATION_STATUS>;
export const ALLOCATION_STATUS_LABEL: Record<AllocationStatus, string> = { CONFIRMED: '배정 확정', CONSUMED: '소진', RELEASED: '해제' };

export const DRAFT_STATUS = {
  AI_GENERATED: 'AI_GENERATED', WAITING_APPROVAL: 'WAITING_APPROVAL', APPROVED: 'APPROVED', EXECUTED: 'EXECUTED', REJECTED: 'REJECTED',
} as const;
export type DraftStatus = CodeOf<typeof DRAFT_STATUS>;
export const DRAFT_STATUS_LABEL: Record<DraftStatus, string> = {
  AI_GENERATED: '생성', WAITING_APPROVAL: '확인 대기', APPROVED: '확정', EXECUTED: 'ERP 반영', REJECTED: '반려',
};

export const ACTOR_TYPE = { USER: 'USER', SYSTEM: 'SYSTEM' } as const;
export type ActorType = CodeOf<typeof ACTOR_TYPE>;

// ───────────── 기준정보 ─────────────
export const ITEM_TYPE = { RAW_MATERIAL: 'RAW_MATERIAL', SLAB: 'SLAB', COIL: 'COIL' } as const;
export type ItemType = CodeOf<typeof ITEM_TYPE>;
export const ITEM_TYPE_LABEL: Record<ItemType, string> = { RAW_MATERIAL: '원료', SLAB: '슬래브', COIL: '코일' };
/** 화면 수량 단위: 슬래브 매, 코일 개 (REQ-SO-002) */
export const ITEM_QTY_UNIT: Record<'SLAB' | 'COIL', string> = { SLAB: '매', COIL: '개' };

export const RAW_MATERIAL_TYPE = { IRON_ORE: 'IRON_ORE', COAL: 'COAL', LIMESTONE: 'LIMESTONE', FERROALLOY: 'FERROALLOY' } as const;
export type RawMaterialType = CodeOf<typeof RAW_MATERIAL_TYPE>;
export const RAW_MATERIAL_TYPE_LABEL: Record<RawMaterialType, string> = { IRON_ORE: '철광석', COAL: '석탄', LIMESTONE: '석회석', FERROALLOY: '합금철' };

export const CONSUMPTION_UNIT = { TON_PER_TON: 'TON_PER_TON', KG_PER_TON: 'KG_PER_TON' } as const;
export type ConsumptionUnit = CodeOf<typeof CONSUMPTION_UNIT>;
export const CONSUMPTION_UNIT_LABEL: Record<ConsumptionUnit, string> = { TON_PER_TON: 't/t (용선 1t당)', KG_PER_TON: 'kg/t (용강 1t당)' };

export const YARD_TYPE = { RAW_MATERIAL: 'RAW_MATERIAL', SLAB: 'SLAB', COIL: 'COIL' } as const;
export type YardType = CodeOf<typeof YARD_TYPE>;
export const YARD_TYPE_LABEL: Record<YardType, string> = { RAW_MATERIAL: '원료 야드', SLAB: '슬래브 야드', COIL: '코일 야드' };

export const PROCESS_CODE = { IRONMAKING: 'IRONMAKING', STEELMAKING: 'STEELMAKING', CASTING: 'CASTING', HOT_ROLLING: 'HOT_ROLLING' } as const;
export type ProcessCode = CodeOf<typeof PROCESS_CODE>;
export const PROCESS_CODE_LABEL: Record<ProcessCode, string> = { IRONMAKING: '제선', STEELMAKING: '제강', CASTING: '연주', HOT_ROLLING: '열연' };
export const PROCESS_ORDER: ProcessCode[] = ['IRONMAKING', 'STEELMAKING', 'CASTING', 'HOT_ROLLING'];

// ───────────── 권한·조직 ─────────────
export const ROLE_CODE = { SALES: 'SALES', PURCHASE: 'PURCHASE', PRODUCTION: 'PRODUCTION', QUALITY: 'QUALITY', LOGISTICS: 'LOGISTICS', ADMIN: 'ADMIN' } as const;
export type RoleCode = CodeOf<typeof ROLE_CODE>;
export const ROLE_CODE_LABEL: Record<RoleCode, string> = { SALES: '영업', PURCHASE: '구매', PRODUCTION: '생산', QUALITY: '품질', LOGISTICS: '물류', ADMIN: '관리자' };
export const ROLE_CODES: RoleCode[] = ['SALES', 'PURCHASE', 'PRODUCTION', 'QUALITY', 'LOGISTICS', 'ADMIN'];

export const EMPLOYEE_STATUS = { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE', LOCKED: 'LOCKED' } as const;
export type EmployeeStatus = CodeOf<typeof EMPLOYEE_STATUS>;
export const EMPLOYEE_STATUS_LABEL: Record<EmployeeStatus, string> = { ACTIVE: '사용', INACTIVE: '사용 중지', LOCKED: '잠김' };

/** 시스템 권한 (업무 프로세스 정의서 2장 제안). 승인 권한은 역할이 아니라 부서장 지정으로 판단한다. */
export const PERMISSION = {
  EMPLOYEE_MANAGE: 'EMPLOYEE_MANAGE', ORG_MANAGE: 'ORG_MANAGE', MASTER_MANAGE: 'MASTER_MANAGE',
  ORDER_CREATE: 'ORDER_CREATE', ORDER_CANCEL: 'ORDER_CANCEL', SHIPMENT_REQUEST: 'SHIPMENT_REQUEST',
  PURCHASE_REQUISITION_CREATE: 'PURCHASE_REQUISITION_CREATE', PO_CONFIRM: 'PO_CONFIRM', RECEIPT_CONFIRM: 'RECEIPT_CONFIRM',
  PLAN_CONFIRM: 'PLAN_CONFIRM', RESULT_CONFIRM: 'RESULT_CONFIRM', ROLLING_ALLOCATE: 'ROLLING_ALLOCATE',
  INSPECTION_REGISTER: 'INSPECTION_REGISTER', DISPOSITION_SET: 'DISPOSITION_SET',
  GOODS_ISSUE_CONFIRM: 'GOODS_ISSUE_CONFIRM', MILLSHEET_READ: 'MILLSHEET_READ',
} as const;
export type Permission = CodeOf<typeof PERMISSION>;
export const PERMISSION_LEVEL = { USE: 'USE', VIEW: 'VIEW' } as const;
export type PermissionLevel = CodeOf<typeof PERMISSION_LEVEL>;

export interface PermissionDef { code: Permission; area: string; label: string }
export const PERMISSIONS: PermissionDef[] = [
  { code: 'ORDER_CREATE', area: '영업', label: '수주 등록' },
  { code: 'ORDER_CANCEL', area: '영업', label: '수주 취소' },
  { code: 'SHIPMENT_REQUEST', area: '영업', label: '출하요청·배정 확정' },
  { code: 'PURCHASE_REQUISITION_CREATE', area: '구매', label: '구매요청 등록·MRP' },
  { code: 'PO_CONFIRM', area: '구매', label: '발주' },
  { code: 'RECEIPT_CONFIRM', area: '구매', label: '입고 확정' },
  { code: 'PLAN_CONFIRM', area: '생산', label: '생산계획·히트 편성' },
  { code: 'RESULT_CONFIRM', area: '생산', label: '공정 실적' },
  { code: 'ROLLING_ALLOCATE', area: '생산', label: '열연 투입 배정' },
  { code: 'INSPECTION_REGISTER', area: '품질', label: '검사 입력' },
  { code: 'DISPOSITION_SET', area: '품질', label: '불합격 처리 상태 지정' },
  { code: 'GOODS_ISSUE_CONFIRM', area: '물류', label: '출고 확정' },
  { code: 'MILLSHEET_READ', area: '물류', label: '밀시트 조회·출력' },
  { code: 'EMPLOYEE_MANAGE', area: '관리', label: '사원 관리' },
  { code: 'ORG_MANAGE', area: '관리', label: '부서·권한 관리' },
  { code: 'MASTER_MANAGE', area: '관리', label: '기준정보 관리' },
];

const U = 'USE' as const;
const V = 'VIEW' as const;
/** 역할별 기본 권한 (시드). 없는 조합 = 권한 없음. 구매요청 등록은 원료를 요청하는 생산도 가능. */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleCode, Partial<Record<Permission, PermissionLevel>>> = {
  SALES: { ORDER_CREATE: U, ORDER_CANCEL: U, SHIPMENT_REQUEST: U, PLAN_CONFIRM: V, GOODS_ISSUE_CONFIRM: V, MILLSHEET_READ: U, MASTER_MANAGE: V },
  PURCHASE: { PURCHASE_REQUISITION_CREATE: U, PO_CONFIRM: U, RECEIPT_CONFIRM: U, PLAN_CONFIRM: V, MASTER_MANAGE: V },
  PRODUCTION: { PLAN_CONFIRM: U, RESULT_CONFIRM: U, ROLLING_ALLOCATE: U, PURCHASE_REQUISITION_CREATE: U, INSPECTION_REGISTER: V, ORDER_CREATE: V, MASTER_MANAGE: V },
  QUALITY: { INSPECTION_REGISTER: U, DISPOSITION_SET: U, RESULT_CONFIRM: V, PLAN_CONFIRM: V, MILLSHEET_READ: U, GOODS_ISSUE_CONFIRM: V, MASTER_MANAGE: V },
  LOGISTICS: { GOODS_ISSUE_CONFIRM: U, MILLSHEET_READ: U, SHIPMENT_REQUEST: V, RECEIPT_CONFIRM: V, ORDER_CREATE: V },
  ADMIN: {
    EMPLOYEE_MANAGE: U, ORG_MANAGE: U, MASTER_MANAGE: U,
    ORDER_CREATE: V, ORDER_CANCEL: V, SHIPMENT_REQUEST: V, PURCHASE_REQUISITION_CREATE: V, PO_CONFIRM: V, RECEIPT_CONFIRM: V,
    PLAN_CONFIRM: V, RESULT_CONFIRM: V, ROLLING_ALLOCATE: V, INSPECTION_REGISTER: V, DISPOSITION_SET: V, GOODS_ISSUE_CONFIRM: V, MILLSHEET_READ: V,
  },
};

// ───────────── 제안 (업무 프로세스 정의서 10장) ─────────────
export const SALES_ORDER_ITEM_STATUS = {
  REGISTERED: 'REGISTERED', IN_PROGRESS: 'IN_PROGRESS', PARTIALLY_SHIPPED: 'PARTIALLY_SHIPPED', SHIPPED: 'SHIPPED', CANCELLED: 'CANCELLED',
} as const;
export type SalesOrderItemStatus = CodeOf<typeof SALES_ORDER_ITEM_STATUS>;
export const SALES_ORDER_ITEM_STATUS_LABEL: Record<SalesOrderItemStatus, string> = {
  REGISTERED: '접수', IN_PROGRESS: '진행 중', PARTIALLY_SHIPPED: '부분출하', SHIPPED: '출하완료', CANCELLED: '취소',
};
/** 수주 헤더 상태는 저장하지 않고 품목 상태에서 계산한다 (REQ-SO-005). */
export const SALES_ORDER_STATUS = SALES_ORDER_ITEM_STATUS;
export type SalesOrderStatus = SalesOrderItemStatus;
export const SALES_ORDER_STATUS_LABEL = SALES_ORDER_ITEM_STATUS_LABEL;
export function deriveSalesOrderStatus(itemStatuses: SalesOrderItemStatus[]): SalesOrderStatus {
  const live = itemStatuses.filter((s) => s !== 'CANCELLED');
  if (!live.length) return 'CANCELLED';
  if (live.every((s) => s === 'SHIPPED')) return 'SHIPPED';
  if (live.some((s) => s === 'SHIPPED' || s === 'PARTIALLY_SHIPPED')) return 'PARTIALLY_SHIPPED';
  if (live.some((s) => s === 'IN_PROGRESS')) return 'IN_PROGRESS';
  return 'REGISTERED';
}

export const PRODUCTION_PLAN_STATUS = { PLANNED: 'PLANNED', CONFIRMED: 'CONFIRMED', IN_PROGRESS: 'IN_PROGRESS', COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED' } as const;
export type ProductionPlanStatus = CodeOf<typeof PRODUCTION_PLAN_STATUS>;
export const PRODUCTION_PLAN_STATUS_LABEL: Record<ProductionPlanStatus, string> = {
  PLANNED: '계획', CONFIRMED: '편성 확정', IN_PROGRESS: '생산 중', COMPLETED: '완료', CANCELLED: '취소',
};

export const PRODUCTION_RESULT_STATUS = { READY: 'READY', STARTED: 'STARTED', COMPLETED: 'COMPLETED' } as const;
export type ProductionResultStatus = CodeOf<typeof PRODUCTION_RESULT_STATUS>;
export const PRODUCTION_RESULT_STATUS_LABEL: Record<ProductionResultStatus, string> = { READY: '대기', STARTED: '작업 중', COMPLETED: '완료' };

export const PURCHASE_REQUISITION_STATUS = { DRAFT: 'DRAFT', WAITING_APPROVAL: 'WAITING_APPROVAL', APPROVED: 'APPROVED', REJECTED: 'REJECTED', ORDERED: 'ORDERED' } as const;
export type PurchaseRequisitionStatus = CodeOf<typeof PURCHASE_REQUISITION_STATUS>;
export const PURCHASE_REQUISITION_STATUS_LABEL: Record<PurchaseRequisitionStatus, string> = {
  DRAFT: '작성 중', WAITING_APPROVAL: '승인 대기', APPROVED: '승인', REJECTED: '반려', ORDERED: '발주 완료',
};
export const REQUISITION_SOURCE_TYPE = { DIRECT: 'DIRECT', MRP: 'MRP', MESSAGE: 'MESSAGE' } as const;
export type RequisitionSourceType = CodeOf<typeof REQUISITION_SOURCE_TYPE>;
export const REQUISITION_SOURCE_TYPE_LABEL: Record<RequisitionSourceType, string> = { DIRECT: '직접', MRP: 'MRP', MESSAGE: '메신저' };

export const PURCHASE_ORDER_STATUS = { CONFIRMED: 'CONFIRMED', PARTIALLY_RECEIVED: 'PARTIALLY_RECEIVED', RECEIVED: 'RECEIVED' } as const;
export type PurchaseOrderStatus = CodeOf<typeof PURCHASE_ORDER_STATUS>;
export const PURCHASE_ORDER_STATUS_LABEL: Record<PurchaseOrderStatus, string> = { CONFIRMED: '발주 확정', PARTIALLY_RECEIVED: '부분 입고', RECEIVED: '입고 완료' };

export const GOODS_RECEIPT_STATUS = { DRAFT: 'DRAFT', CONFIRMED: 'CONFIRMED' } as const;
export type GoodsReceiptStatus = CodeOf<typeof GOODS_RECEIPT_STATUS>;
export const GOODS_RECEIPT_STATUS_LABEL: Record<GoodsReceiptStatus, string> = { DRAFT: '입고 초안', CONFIRMED: '입고 확정' };

export const INSPECTION_RESULT = { PENDING: 'PENDING', PASS: 'PASS', FAIL: 'FAIL' } as const;
export type InspectionResult = CodeOf<typeof INSPECTION_RESULT>;
export const INSPECTION_RESULT_LABEL: Record<InspectionResult, string> = { PENDING: '검사 대기', PASS: '합격', FAIL: '불합격' };

/** 불합격 처리 상태 (REQ-QC-004: 보류 / 격하 / 폐기). 값은 제안. */
export const DISPOSITION_STATUS = { HOLD: 'HOLD', DOWNGRADED: 'DOWNGRADED', SCRAPPED: 'SCRAPPED' } as const;
export type DispositionStatus = CodeOf<typeof DISPOSITION_STATUS>;
export const DISPOSITION_STATUS_LABEL: Record<DispositionStatus, string> = { HOLD: '보류', DOWNGRADED: '격하', SCRAPPED: '폐기' };

export const SHIPMENT_REQUEST_ITEM_STATUS = { WAITING_ALLOCATION: 'WAITING_ALLOCATION', ALLOCATED: 'ALLOCATED', ISSUED: 'ISSUED' } as const;
export type ShipmentRequestItemStatus = CodeOf<typeof SHIPMENT_REQUEST_ITEM_STATUS>;
export const SHIPMENT_REQUEST_ITEM_STATUS_LABEL: Record<ShipmentRequestItemStatus, string> = { WAITING_ALLOCATION: '배정 대기', ALLOCATED: '배정 완료', ISSUED: '출고 완료' };
export const SHIPMENT_REQUEST_STATUS = { REQUESTED: 'REQUESTED', ALLOCATED: 'ALLOCATED', PARTIALLY_ISSUED: 'PARTIALLY_ISSUED', ISSUED: 'ISSUED', CANCELLED: 'CANCELLED' } as const;
export type ShipmentRequestStatus = CodeOf<typeof SHIPMENT_REQUEST_STATUS>;
export const SHIPMENT_REQUEST_STATUS_LABEL: Record<ShipmentRequestStatus, string> = {
  REQUESTED: '배정 대기', ALLOCATED: '배정 확정 · 출고 대기', PARTIALLY_ISSUED: '부분 출고', ISSUED: '출고 완료', CANCELLED: '취소',
};
export const GOODS_ISSUE_STATUS = { CONFIRMED: 'CONFIRMED' } as const;
export type GoodsIssueStatus = CodeOf<typeof GOODS_ISSUE_STATUS>;

export const PDF_STATUS = { PENDING: 'PENDING', READY: 'READY', FAILED: 'FAILED' } as const;
export type PdfStatus = CodeOf<typeof PDF_STATUS>;

export const TASK_STATUS = { TODO: 'TODO', IN_PROGRESS: 'IN_PROGRESS', DONE: 'DONE' } as const;
export type TaskStatus = CodeOf<typeof TASK_STATUS>;
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = { TODO: '할 일', IN_PROGRESS: '진행 중', DONE: '완료' };

// ───────────── LOT ─────────────
export const LOT_TYPE = { RAW_MATERIAL: 'RAW_MATERIAL', HOT_METAL: 'HOT_METAL', HEAT: 'HEAT', SLAB: 'SLAB', COIL: 'COIL' } as const;
export type LotType = CodeOf<typeof LOT_TYPE>;
export const LOT_TYPE_LABEL: Record<LotType, string> = { RAW_MATERIAL: '원료', HOT_METAL: '용선', HEAT: '히트', SLAB: '슬래브', COIL: '코일' };
export const LOT_STATUS = { IN_STOCK: 'IN_STOCK', CONSUMED: 'CONSUMED', SHIPPED: 'SHIPPED' } as const;
export type LotStatus = CodeOf<typeof LOT_STATUS>;
export const LOT_STATUS_LABEL: Record<LotStatus, string> = { IN_STOCK: '재고', CONSUMED: '투입·소진', SHIPPED: '출고' };
/** 원료→용선 기간 기반, 용선→히트 N:M, 히트→슬래브 1:N, 슬래브→코일 1:1, 합금철→히트 직접 (REQ-LOT-002) */
export const LOT_RELATION_TYPE = {
  RAW_TO_HOT_METAL: 'RAW_TO_HOT_METAL', HOT_METAL_TO_HEAT: 'HOT_METAL_TO_HEAT', ALLOY_TO_HEAT: 'ALLOY_TO_HEAT', HEAT_TO_SLAB: 'HEAT_TO_SLAB', SLAB_TO_COIL: 'SLAB_TO_COIL',
} as const;
export type LotRelationType = CodeOf<typeof LOT_RELATION_TYPE>;
export const LOT_EVIDENCE_TYPE = { PERIOD: 'PERIOD', DIRECT: 'DIRECT' } as const;
export type LotEvidenceType = CodeOf<typeof LOT_EVIDENCE_TYPE>;
export const LOT_EVIDENCE_TYPE_LABEL: Record<LotEvidenceType, string> = { PERIOD: '기간 기반', DIRECT: '직접 투입' };

export const ALLOCATION_PURPOSE = { SHIPMENT: 'SHIPMENT', ROLLING: 'ROLLING' } as const;
export type AllocationPurpose = CodeOf<typeof ALLOCATION_PURPOSE>;
export const ALLOCATION_PURPOSE_LABEL: Record<AllocationPurpose, string> = { SHIPMENT: '출하', ROLLING: '열연 투입' };

// ───────────── 메신저·알림·초안 ─────────────
export const CHAT_ROOM_TYPE = { DIRECT: 'DIRECT', GROUP: 'GROUP', WORK: 'WORK' } as const;
export type ChatRoomType = CodeOf<typeof CHAT_ROOM_TYPE>;
export const CHAT_ROOM_TYPE_LABEL: Record<ChatRoomType, string> = { DIRECT: '1:1', GROUP: '그룹', WORK: '업무방' };
export const MESSAGE_TYPE = { TEXT: 'TEXT', FILE: 'FILE', SYSTEM: 'SYSTEM' } as const;
export type MessageType = CodeOf<typeof MESSAGE_TYPE>;

export const NOTIFICATION_TYPE = {
  MENTION: 'MENTION', WORK_ROOM_MESSAGE: 'WORK_ROOM_MESSAGE', APPROVAL_REQUEST: 'APPROVAL_REQUEST', APPROVAL_RESULT: 'APPROVAL_RESULT',
  TASK: 'TASK', PRODUCTION: 'PRODUCTION', QUALITY: 'QUALITY', SHIPMENT: 'SHIPMENT', PURCHASE: 'PURCHASE', SALES: 'SALES', SYSTEM: 'SYSTEM',
} as const;
export type NotificationType = CodeOf<typeof NOTIFICATION_TYPE>;
export const NOTIFICATION_TYPE_LABEL: Record<NotificationType, string> = {
  MENTION: '멘션', WORK_ROOM_MESSAGE: '업무방', APPROVAL_REQUEST: '승인 요청', APPROVAL_RESULT: '승인 결과',
  TASK: '업무', PRODUCTION: '생산', QUALITY: '품질', SHIPMENT: '출하', PURCHASE: '구매', SALES: '영업', SYSTEM: '시스템',
};

export const ACTION_TYPE = { PURCHASE_REQUISITION_CREATE: 'PURCHASE_REQUISITION_CREATE' } as const;
export type ActionType = CodeOf<typeof ACTION_TYPE>;
export const ACTION_TYPE_LABEL: Record<ActionType, string> = { PURCHASE_REQUISITION_CREATE: '구매요청' };
/** 구매요청 초안의 추출 스키마 (업무 프로세스 정의서 12.3). 미확정 값은 null. */
export interface PurchaseRequisitionDraftPayload {
  rawMaterialId: number | null;
  requiredTon: string | null;
  desiredReceiptDate: string | null; // YYYY-MM-DD
  requesterId: number;
  requestReason?: string | null;
}

// ───────────── 작업 로그 ─────────────
/** 기록 대상 이벤트 (REQ-LOG-002) */
export const BUSINESS_EVENT_TYPE = {
  WORK_STARTED: 'WORK_STARTED', WORK_COMPLETED: 'WORK_COMPLETED', RESULT_REGISTERED: 'RESULT_REGISTERED', INSPECTION_REGISTERED: 'INSPECTION_REGISTERED',
  RESERVATION_CREATED: 'RESERVATION_CREATED', RESERVATION_CONVERTED: 'RESERVATION_CONVERTED', RESERVATION_RELEASED: 'RESERVATION_RELEASED', AUTO_RESERVED: 'AUTO_RESERVED',
  ALLOCATION_RECOMMENDED: 'ALLOCATION_RECOMMENDED', ALLOCATION_CONFIRMED: 'ALLOCATION_CONFIRMED', ALLOCATION_CHANGED: 'ALLOCATION_CHANGED', ALLOCATION_RELEASED: 'ALLOCATION_RELEASED',
  SALES_ORDER_REGISTERED: 'SALES_ORDER_REGISTERED', SALES_ORDER_CANCELLED: 'SALES_ORDER_CANCELLED',
  PRODUCTION_PLAN_CREATED: 'PRODUCTION_PLAN_CREATED', PRODUCTION_PLAN_CONFIRMED: 'PRODUCTION_PLAN_CONFIRMED', REPRODUCTION_PLAN_CREATED: 'REPRODUCTION_PLAN_CREATED',
  PRODUCTION_PLAN_CANCELLED: 'PRODUCTION_PLAN_CANCELLED', SURPLUS_CONVERTED: 'SURPLUS_CONVERTED',
  REJECTED_JUDGED: 'REJECTED_JUDGED', DISPOSITION_SET: 'DISPOSITION_SET',
  MRP_RUN: 'MRP_RUN',
  PURCHASE_REQUISITION_CONFIRMED: 'PURCHASE_REQUISITION_CONFIRMED', PURCHASE_REQUISITION_APPROVED: 'PURCHASE_REQUISITION_APPROVED', PURCHASE_REQUISITION_REJECTED: 'PURCHASE_REQUISITION_REJECTED',
  PURCHASE_ORDER_CONFIRMED: 'PURCHASE_ORDER_CONFIRMED', GOODS_RECEIPT_CONFIRMED: 'GOODS_RECEIPT_CONFIRMED',
  SHIPMENT_REQUESTED: 'SHIPMENT_REQUESTED', GOODS_ISSUE_CONFIRMED: 'GOODS_ISSUE_CONFIRMED', MILL_SHEET_ISSUED: 'MILL_SHEET_ISSUED',
  ACTION_DRAFT_CREATED: 'ACTION_DRAFT_CREATED', ACTION_DRAFT_APPROVED: 'ACTION_DRAFT_APPROVED', ACTION_DRAFT_EXECUTED: 'ACTION_DRAFT_EXECUTED', ACTION_DRAFT_REJECTED: 'ACTION_DRAFT_REJECTED',
  MASTER_CHANGED: 'MASTER_CHANGED',
} as const;
export type BusinessEventType = CodeOf<typeof BUSINESS_EVENT_TYPE>;
export const BUSINESS_EVENT_TYPE_LABEL: Record<BusinessEventType, string> = {
  WORK_STARTED: '작업 시작', WORK_COMPLETED: '작업 완료', RESULT_REGISTERED: '실적', INSPECTION_REGISTERED: '검사',
  RESERVATION_CREATED: '예약', RESERVATION_CONVERTED: '예약 전환', RESERVATION_RELEASED: '예약 해제', AUTO_RESERVED: '자동 예약',
  ALLOCATION_RECOMMENDED: '배정 추천', ALLOCATION_CONFIRMED: '배정 확정', ALLOCATION_CHANGED: '배정 변경', ALLOCATION_RELEASED: '배정 해제',
  SALES_ORDER_REGISTERED: '수주 등록', SALES_ORDER_CANCELLED: '수주 취소',
  PRODUCTION_PLAN_CREATED: '생산계획', PRODUCTION_PLAN_CONFIRMED: '히트 편성', REPRODUCTION_PLAN_CREATED: '재생산', PRODUCTION_PLAN_CANCELLED: '계획 취소', SURPLUS_CONVERTED: '여재 전환',
  REJECTED_JUDGED: '불합격', DISPOSITION_SET: '처리 상태',
  MRP_RUN: 'MRP',
  PURCHASE_REQUISITION_CONFIRMED: '구매요청', PURCHASE_REQUISITION_APPROVED: '승인', PURCHASE_REQUISITION_REJECTED: '반려',
  PURCHASE_ORDER_CONFIRMED: '발주', GOODS_RECEIPT_CONFIRMED: '입고',
  SHIPMENT_REQUESTED: '출하요청', GOODS_ISSUE_CONFIRMED: '출고', MILL_SHEET_ISSUED: '밀시트',
  ACTION_DRAFT_CREATED: '초안', ACTION_DRAFT_APPROVED: '초안 확정', ACTION_DRAFT_EXECUTED: '초안 실행', ACTION_DRAFT_REJECTED: '초안 반려',
  MASTER_CHANGED: '기준정보',
};
export const EVENT_TARGET_TYPE = {
  SALES_ORDER: 'SALES_ORDER', SALES_ORDER_ITEM: 'SALES_ORDER_ITEM', RESERVATION: 'RESERVATION', ALLOCATION: 'ALLOCATION', PRODUCTION_PLAN: 'PRODUCTION_PLAN',
  PRODUCTION_RESULT: 'PRODUCTION_RESULT', LOT: 'LOT', QUALITY_INSPECTION: 'QUALITY_INSPECTION', MRP_RUN: 'MRP_RUN', PURCHASE_REQUISITION: 'PURCHASE_REQUISITION',
  PURCHASE_ORDER: 'PURCHASE_ORDER', GOODS_RECEIPT: 'GOODS_RECEIPT', SHIPMENT_REQUEST: 'SHIPMENT_REQUEST', GOODS_ISSUE: 'GOODS_ISSUE', MILL_SHEET: 'MILL_SHEET',
  ACTION_DRAFT: 'ACTION_DRAFT', MASTER: 'MASTER',
} as const;
export type EventTargetType = CodeOf<typeof EVENT_TARGET_TYPE>;
/** 사유 코드 (업무 프로세스 정의서 9.3 제안) */
export const EVENT_REASON_CODE = {
  STOCK_FIRST: 'STOCK_FIRST', FIFO_RECOMMENDATION: 'FIFO_RECOMMENDATION', ORDER_SHORTAGE: 'ORDER_SHORTAGE', ORDER_CANCELLED: 'ORDER_CANCELLED',
  QUALITY_FAILURE: 'QUALITY_FAILURE', SURPLUS_CONVERSION: 'SURPLUS_CONVERSION', ALLOCATION_CHANGE: 'ALLOCATION_CHANGE', DRAFT_CONFIRMED: 'DRAFT_CONFIRMED',
  QUALITY_PASSED: 'QUALITY_PASSED', GOODS_ISSUE: 'GOODS_ISSUE', SIMULATION: 'SIMULATION',
} as const;
export type EventReasonCode = CodeOf<typeof EVENT_REASON_CODE>;

// ───────────── 에러 코드 (업무 프로세스 정의서 9.3, 형식 `영역-번호`) ─────────────
export const ERROR_CODE = {
  SO_001: 'SO-001', // 등록되지 않은 규격입니다
  SO_002: 'SO-002', // 수량은 1 이상의 정수로 입력해 주세요
  MST_001: 'MST-001', // 수율·배합·규격 매핑·검사 기준 누락
  MST_002: 'MST-002', // 사용된 규격은 치수·이론중량을 수정할 수 없습니다
  INV_001: 'INV-001', // 예약·배정 가능한 매수 부족
  INV_002: 'INV-002', // 제품 또는 상위 히트가 미합격
  INV_003: 'INV-003', // 이미 배정된 LOT
  INV_004: 'INV-004', // 이미 투입·출고된 LOT
  PUR_001: 'PUR-001', // 승인권자(부서장) 미지정
  PUR_002: 'PUR-002', // 승인 전 발주 불가
  PUR_003: 'PUR-003', // 발주 미입고량 초과
  ACT_001: 'ACT-001', // 초안 필수값 미확정
  SHP_001: 'SHP-001', // 밀시트 PDF 생성 실패(스냅샷은 있음)
  COM_001: 'COM-001', // 검토 이후 데이터 변경(버전 충돌)
  COM_002: 'COM-002', // 해당 업무 권한 없음
  COM_003: 'COM-003', // 입력값이 올바르지 않습니다
  COM_004: 'COM-004', // 대상을 찾을 수 없습니다
  COM_005: 'COM-005', // 현재 상태에서는 할 수 없는 작업입니다
  AUTH_001: 'AUTH-001', // 사원번호 또는 비밀번호가 올바르지 않습니다
  AUTH_002: 'AUTH-002', // 로그인이 필요합니다
  AUTH_003: 'AUTH-003', // 사용할 수 없는 계정입니다
} as const;
export type ErrorCode = CodeOf<typeof ERROR_CODE>;

// ───────────── 대시보드 위젯 (REQ-DSH-001·002, P3) ─────────────
export const WIDGET_CODE = {
  PROCESS_FLOW: 'PROCESS_FLOW', ORDER_FULFILLMENT: 'ORDER_FULFILLMENT', AGENT_RISK: 'AGENT_RISK', RECENT_EVENTS: 'RECENT_EVENTS', PRODUCT_STOCK: 'PRODUCT_STOCK', PROCESS_YIELD: 'PROCESS_YIELD',
  RAW_MATERIAL_BALANCE: 'RAW_MATERIAL_BALANCE', REJECT_RATE: 'REJECT_RATE', DELIVERY_RISK: 'DELIVERY_RISK', PURCHASE_PROGRESS: 'PURCHASE_PROGRESS',
  SHIPMENT_RESULT: 'SHIPMENT_RESULT', SURPLUS_AGE: 'SURPLUS_AGE', PRODUCTION_VOLUME: 'PRODUCTION_VOLUME', AI_USAGE: 'AI_USAGE',
} as const;
export type WidgetCode = CodeOf<typeof WIDGET_CODE>;
export interface WidgetDef { code: WidgetCode; label: string; isDefault: boolean; isP2: boolean; defaultW: number; defaultH: number }
/** 12칸 격자 기준 기본 크기. isP2 = P2 기능이 필요해 "준비 중 (P2)"로만 표시. */
export const WIDGETS: WidgetDef[] = [
  { code: 'PROCESS_FLOW', label: '공정 흐름 현황', isDefault: true, isP2: false, defaultW: 12, defaultH: 3 },
  { code: 'ORDER_FULFILLMENT', label: '수주 충족 현황', isDefault: true, isP2: false, defaultW: 6, defaultH: 5 },
  { code: 'AGENT_RISK', label: 'Agent 위험 감지', isDefault: true, isP2: true, defaultW: 6, defaultH: 5 },
  { code: 'RECENT_EVENTS', label: '최근 작업 로그', isDefault: true, isP2: false, defaultW: 6, defaultH: 5 },
  { code: 'PRODUCT_STOCK', label: '제품 재고', isDefault: true, isP2: false, defaultW: 6, defaultH: 5 },
  { code: 'PROCESS_YIELD', label: '공정별 수율', isDefault: true, isP2: false, defaultW: 6, defaultH: 4 },
  { code: 'RAW_MATERIAL_BALANCE', label: '원료 잔량 대비 소요', isDefault: false, isP2: false, defaultW: 6, defaultH: 4 },
  { code: 'REJECT_RATE', label: '강종별 불합격률', isDefault: false, isP2: false, defaultW: 6, defaultH: 4 },
  { code: 'DELIVERY_RISK', label: '납기 위험 수주', isDefault: false, isP2: false, defaultW: 6, defaultH: 4 },
  { code: 'PURCHASE_PROGRESS', label: '구매 진행', isDefault: false, isP2: false, defaultW: 6, defaultH: 4 },
  { code: 'SHIPMENT_RESULT', label: '출하 실적', isDefault: false, isP2: false, defaultW: 6, defaultH: 4 },
  { code: 'SURPLUS_AGE', label: '여재 보유 기간', isDefault: false, isP2: false, defaultW: 6, defaultH: 4 },
  { code: 'PRODUCTION_VOLUME', label: '생산량', isDefault: false, isP2: false, defaultW: 6, defaultH: 4 },
  { code: 'AI_USAGE', label: 'AI 활용 현황', isDefault: false, isP2: true, defaultW: 6, defaultH: 4 },
];
export interface WidgetPlacement { widgetCode: WidgetCode; x: number; y: number; w: number; h: number }
