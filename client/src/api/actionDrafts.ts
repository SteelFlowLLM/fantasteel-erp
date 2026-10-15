// Message → ERP 구매요청 초안 api (REQ-ACT-001~004, BP-ACT-01, 13.4).
// 서버를 부른다 (api/server/actionDrafts.ts). 요청자·방 멤버·권한·필수값·실행(업무 유형 등록부)·작업 로그는 서버가 맡는다.
import type { PurchaseRequisitionDraftPayload as DraftPayloadView } from '@fantasteel/shared';
import { type ActionType, type DraftStatus } from '@/codes';
import { serverActionDraftApi } from '@/api/server/actionDrafts';
import type { JsonValue } from '@/lib/json';

/** 구매요청 초안 값 (서버와 같은 모양). JsonValue에 넣으려면 interface가 아닌 타입 별칭이어야 한다 */
export type PurchaseRequisitionDraftPayload = Pick<DraftPayloadView, keyof DraftPayloadView>;

export interface ActionDraftView {
  id: number;
  actionType: ActionType;
  actionTypeLabel: string;
  draftStatus: DraftStatus;
  payload: PurchaseRequisitionDraftPayload;
  itemCode: string | null;
  itemName: string | null;
  requesterId: number;
  requesterName: string | null;
  message: { id: number; chatRoomId: number; chatRoomName: string | null; senderName: string | null; content: string | null; createdAt: string } | null;
  /** 회의록에서 만든 초안이면 그 회의록 (REQ-VOC-004) */
  meetingMinutes: { id: number; title: string } | null;
  /** 확정 전 채워야 할 칸 */
  unresolvedFields: string[];
  purchaseRequisition: { id: number; purchaseRequisitionNo: string; purchaseRequisitionStatus: string } | null;
  executionResult: JsonValue | null;
  rejectReason: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  executedAt: string | null;
  rejectedAt: string | null;
}

export interface ActionExecution {
  targetType: 'purchase_requisition';
  targetId: number;
  targetNo: string;
}

export const actionDraftKeys = {
  all: ['action-drafts'] as const,
  detail: (employeeId: number, actionDraftId: number) => ['action-drafts', 'detail', employeeId, actionDraftId] as const,
  mine: (employeeId: number) => ['action-drafts', 'mine', employeeId] as const,
  room: (employeeId: number, chatRoomId: number) => ['action-drafts', 'room', employeeId, chatRoomId] as const,
  requester: (employeeId: number, messageId: number) => ['action-drafts', 'requester', employeeId, messageId] as const,
};

// ── 화면에 내보내는 모양 ─────────────────────────────────

export interface DraftRequesterView {
  id: number;
  employeeName: string;
  jobGradeName: string | null;
  departmentName: string | null;
}

export interface DraftItemOption {
  id: number;
  itemCode: string;
  itemName: string;
  defaultSupplierName: string | null;
}

export interface DraftDetailView extends ActionDraftView {
  requester: DraftRequesterView;
  /** 원본 메시지 채팅방 이름 (1:1 방은 이름이 없어 유형으로) */
  chatRoomLabel: string | null;
  /** 확정·반려·수정을 할 사람인지 (요청자 = 메시지 작성자) */
  isRequester: boolean;
  /** 고른 원료의 기본 공급업체 (발주 때 쓰임) */
  itemDefaultSupplierName: string | null;
}

/** 내 초안 목록 한 줄 */
export interface DraftListItemView {
  id: number;
  actionType: ActionType;
  actionTypeLabel: string;
  draftStatus: DraftStatus;
  chatRoomName: string | null;
  messageContent: string | null;
  purchaseRequisitionNo: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 채팅방 메시지에 달린 초안 (메시지 메뉴의 '초안 보기') */
export interface RoomDraftView {
  id: number;
  messageId: number;
  draftStatus: DraftStatus;
}

/** 메시지 작성자(= 요청자)가 그 메시지의 초안을 확정할 수 있는지 (메시지 메뉴의 '구매요청 초안 만들기') */
export interface DraftRequesterCheck {
  requesterId: number;
  /** 만들기를 막는 까닭 (null = 만들 수 있음) */
  blockReason: string | null;
}

export interface DraftConfirmResult {
  draft: DraftDetailView;
  executed: boolean;
  target: ActionExecution | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export type DraftPayloadInput = Partial<Omit<PurchaseRequisitionDraftPayload, 'sourceText'>>;

// ── api ─────────────────────────────────────────────────

export const actionDraftApi = {
  /** 초안 상세 (구매요청 조회 이상) */
  get: (actionDraftId: number): Promise<DraftDetailView> => serverActionDraftApi.get(actionDraftId),

  /** 내가 요청자인 초안 (최근 것 먼저) */
  listMine: (): Promise<DraftListItemView[]> => serverActionDraftApi.listMine(),

  /** 이 채팅방 메시지에 달린 초안 (방 멤버만, 반려된 초안 포함) */
  listOfRoom: (chatRoomId: number): Promise<RoomDraftView[]> => serverActionDraftApi.listOfRoom(chatRoomId),

  /** 이 메시지로 초안을 만들 수 있는지 — 요청자(메시지 작성자)가 확정할 수 있어야 한다 (방 멤버만) */
  checkRequester: (messageId: number): Promise<DraftRequesterCheck> => serverActionDraftApi.checkRequester(),

  /**
   * 메시지에서 구매요청 초안 만들기 (REQ-ACT-001). 같은 메시지에 반려되지 않은 초안이 있으면 그 초안을 돌려준다.
   * 요청자(메시지 작성자)가 확정할 수 없으면 COM-002 (findRequesterBlockReason).
   */
  createFromMessage: (input: { messageId: number }): Promise<{ id: number; created: boolean }> => serverActionDraftApi.createFromMessage(input),

  /** 요청자가 값을 고쳐 저장 (확인 대기일 때만) */
  update: (input: { actionDraftId: number; payload: DraftPayloadInput; expectedUpdatedAt?: string | null }): Promise<DraftDetailView> => serverActionDraftApi.update(input),

  /** 요청자 확정 → 등록부 핸들러로 구매요청 생성 (ACT-001 · REQ-ACT-002) */
  confirm: (input: { actionDraftId: number; expectedUpdatedAt?: string | null }): Promise<DraftConfirmResult> => serverActionDraftApi.confirm(input),

  /** 확정했지만 구매요청을 만들지 못한 초안을 다시 실행 (중복 실행은 서버가 막는다) */
  execute: (input: { actionDraftId: number }): Promise<DraftConfirmResult> => serverActionDraftApi.execute(input),

  /** 요청자 반려 (사유 필수) → REJECTED */
  reject: (input: { actionDraftId: number; rejectReason: string; expectedUpdatedAt?: string | null }): Promise<DraftDetailView> => serverActionDraftApi.reject(input),

  /** 원료 품목 고르기 (기준정보에 등록된 원료) */
  listRawMaterials: (): Promise<DraftItemOption[]> => serverActionDraftApi.listRawMaterials(),
};
