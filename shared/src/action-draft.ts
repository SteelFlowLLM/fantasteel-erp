// message-action 모듈 응답 타입 (docs/backend/message-action.md). 톤은 소수 3자리 문자열, 날짜는 'YYYY-MM-DD', 시각은 ISO 8601.
import type { ActionType, ChatRoomType, DraftStatus } from './codes';

/**
 * 메시지에서 만들 때 AI 추출이 어떻게 끝났는지 (이슈 #472). 빈 초안이면 화면이 그 이유를 보인다.
 * FILLED 칸을 채움 / NOTHING_FOUND 답은 왔지만 맞는 값이 없음 / NO_MODEL 모델 미설정 / TIMEOUT 제한 시간 초과 / NOT_JSON 답이 JSON이 아님 / FAILED 연결·서버 오류
 */
export type AiExtractionStatus = 'FILLED' | 'NOTHING_FOUND' | 'NO_MODEL' | 'TIMEOUT' | 'NOT_JSON' | 'FAILED';

/**
 * 구매요청 초안 값 (추출 스키마 REQ-ACT-001). 이름은 ERD 구매요청 컬럼을 따른다.
 * 요청자는 payload가 아니라 초안의 requesterId(= 메시지 작성자)다.
 */
export interface PurchaseRequisitionDraftPayload {
  itemId: number | null;
  requestedTon: string | null;
  desiredReceiptDate: string | null;
  requestReason: string | null;
  /** 원본 메시지 글 (만들 때 복사, 참고용) */
  sourceText: string | null;
  /**
   * 메시지에서 만들 때 AI가 채운 칸 이름(예: itemId). 사람이 고쳐도 그대로 두고, 비어 있지 않으면 확정·실행 작업 로그가 AI 경유다.
   * 서버 초안 응답에는 늘 있고(없으면 빈 배열), 회의록 후보(MeetingCandidate.purchase)에는 없다
   */
  aiFilledFields?: string[];
  /** 메시지에서 만들 때 AI 추출 결과 (회의록·AI 어시스턴트 초안·이슈 #472 전 초안에는 없다) */
  aiExtraction?: AiExtractionStatus | null;
}

/** 확장 유형 초안 값에 늘 있는 칸 (원본 글·AI가 채운 칸) */
interface DraftPayloadBase {
  sourceText: string | null;
  /** 만들 때 AI가 채운 칸 이름. 사람이 고쳐도 그대로 두고, 비어 있지 않으면 확정·실행 작업 로그가 AI 경유다 */
  aiFilledFields: string[];
  /** 메시지에서 만들 때 AI 추출 결과 (이슈 #472 전 초안에는 없다) */
  aiExtraction?: AiExtractionStatus | null;
}

/** 수주 등록 초안의 품목 한 줄 (ERD sales_order_item). 매수는 정수, 납기는 'YYYY-MM-DD' */
export interface SalesOrderDraftLine {
  itemId: number | null;
  orderedQty: number | null;
  dueDate: string | null;
}

/** 수주 등록 초안 (업무 프로세스 12.3, ACTION_TYPE SALES_ORDER_CREATE) */
export interface SalesOrderDraftPayload extends DraftPayloadBase {
  customerId: number | null;
  items: SalesOrderDraftLine[];
}

/** 출하요청 초안의 품목 한 줄 (ERD shipment_request_item) */
export interface ShipmentRequestDraftLine {
  salesOrderItemId: number | null;
  requestQty: number | null;
}

/** 출하요청 생성 초안 (SHIPMENT_REQUEST_CREATE). 출하 예정일은 선택 */
export interface ShipmentRequestDraftPayload extends DraftPayloadBase {
  customerId: number | null;
  shipDate: string | null;
  items: ShipmentRequestDraftLine[];
}

/** 배정 확정 초안 (ALLOCATION_CONFIRM). LOT은 AI가 아니라 시스템 배정 추천(FIFO)으로 채운다 */
export interface AllocationDraftPayload extends DraftPayloadBase {
  shipmentRequestItemId: number | null;
  lotIds: number[];
  /** LOT을 누가 골랐는지: 시스템 FIFO 추천 또는 사람이 고침. 확정 작업 로그 사유에 쓴다 (없으면 추천) */
  lotsChosenBy?: 'RECOMMENDATION' | 'PERSON' | null;
}

/** 재생산 계획 생성 초안 (REPRODUCTION_PLAN_CREATE). 추가 계획 매수는 실행 때 서버가 다시 계산한다 */
export interface ReproductionPlanDraftPayload extends DraftPayloadBase {
  salesOrderItemId: number | null;
}

/** 초안 값 (유형별 추출 스키마, 업무 프로세스 12.3). 어느 모양인지는 초안의 actionType으로 정한다 */
export type ActionDraftPayload = PurchaseRequisitionDraftPayload | SalesOrderDraftPayload | ShipmentRequestDraftPayload | AllocationDraftPayload | ReproductionPlanDraftPayload;

/** 초안을 실행해 만든 업무 */
export interface ActionDraftResultView {
  /** 만든 업무의 테이블 (작업 로그 대상과 같은 이름, 예: purchase_requisition) */
  table: string;
  id: number;
  no: string;
  /** 지금 상태 코드 (구매요청은 PURCHASE_REQUISITION_STATUS). 모르면 null */
  status: string | null;
}

/** POST messages/:id/action-drafts. 같은 메시지·유형에 미처리 초안이 있으면 그 초안을 돌려준다(created: false) */
export interface ActionDraftCreateResult {
  id: number;
  created: boolean;
  /** 초안의 확정 주체(만든 사원 또는 메시지 작성자) 이름. 다른 사원이 만든 초안이면 "○○님이 만든 초안이 이미 있어요"에 쓴다 */
  requesterId: number | null;
  requesterName: string | null;
}

export interface ActionDraftMessageView {
  id: number;
  chatRoomId: number;
  chatRoomName: string | null;
  chatRoomType: ChatRoomType;
  senderName: string | null;
  content: string | null;
  createdAt: string;
}

/** 초안 상세·목록 한 줄 (GET action-drafts/:id, GET action-drafts) */
export interface ActionDraftView {
  id: number;
  actionType: ActionType;
  draftStatus: DraftStatus;
  payload: ActionDraftPayload;
  itemCode: string | null;
  itemName: string | null;
  /** 고른 원료의 기본 공급업체 (발주 때 쓰인다) */
  itemDefaultSupplierName: string | null;
  requesterId: number | null;
  requesterName: string | null;
  requesterDepartmentName: string | null;
  requesterJobGradeName: string | null;
  message: ActionDraftMessageView | null;
  /** 회의록에서 만든 초안이면 그 회의록 (메시지 초안이면 null) */
  meetingMinutes: { id: number; title: string } | null;
  /** 확정 전에 채워야 할 필수 칸 (표시명, 예: '고객사', '품목 1 매수'). 비면 확정할 수 있다 */
  unresolvedFields: string[];
  /**
   * payload의 id 칸을 사람이 읽을 이름으로 (칸 경로 → 이름, 예: customerId → '가람중공업', items.0.itemId → 'SL-SS275-… 슬래브', lotIds → 'L-… · L-…').
   * 찾을 수 없는 id는 넣지 않는다
   */
  payloadLabels: Record<string, string>;
  /** 실행해 만든 업무. 실행 전이면 null */
  result: ActionDraftResultView | null;
  /** 확정 뒤 실행(업무 생성)에 실패한 오류 코드와 시도 횟수 */
  executionErrorCode: string | null;
  executionAttemptCount: number;
  rejectReason: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * POST action-drafts/:id/confirm·execute. 확정한 뒤 실행(업무 생성)에 실패하면 승인(APPROVED)으로 남고,
 * 실패 코드·시도 횟수가 초안에 남아 다시 실행할 수 있다.
 */
export interface ActionDraftExecutionResult {
  draft: ActionDraftView;
  executed: boolean;
  /** 실행에 실패한 오류 코드와 문구. 성공하면 null */
  errorCode: string | null;
  errorMessage: string | null;
}
