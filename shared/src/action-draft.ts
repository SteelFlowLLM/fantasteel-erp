// message-action 모듈 응답 타입 (docs/backend/message-action.md). 톤은 소수 3자리 문자열, 날짜는 'YYYY-MM-DD', 시각은 ISO 8601.
import type { ActionType, ChatRoomType, DraftStatus, PurchaseRequisitionStatus } from './codes';

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
}

/** POST messages/:id/action-drafts. 같은 메시지에 미처리 초안이 있으면 그 초안을 돌려준다(created: false) */
export interface ActionDraftCreateResult {
  id: number;
  created: boolean;
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
  payload: PurchaseRequisitionDraftPayload;
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
  /** 확정 전에 채워야 할 필수 칸 (표시명). 비면 확정할 수 있다 */
  unresolvedFields: string[];
  purchaseRequisition: { id: number; purchaseRequisitionNo: string; purchaseRequisitionStatus: PurchaseRequisitionStatus } | null;
  /** 확정 뒤 실행(구매요청 생성)에 실패한 오류 코드와 시도 횟수 */
  executionErrorCode: string | null;
  executionAttemptCount: number;
  rejectReason: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * POST action-drafts/:id/confirm·execute. 확정한 뒤 실행(구매요청 생성)에 실패하면 승인(APPROVED)으로 남고,
 * 실패 코드·시도 횟수가 초안에 남아 다시 실행할 수 있다.
 */
export interface ActionDraftExecutionResult {
  draft: ActionDraftView;
  executed: boolean;
  /** 실행에 실패한 오류 코드와 문구. 성공하면 null */
  errorCode: string | null;
  errorMessage: string | null;
}
