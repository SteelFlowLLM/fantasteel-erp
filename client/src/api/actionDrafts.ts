// Message → ERP 초안 api (REQ-ACT-001~005, BP-ACT-01·02, 13.4).
// 서버를 부른다 (api/server/actionDrafts.ts). 요청자·방 멤버·권한·필수값·실행(업무 유형 등록부)·작업 로그는 서버가 맡는다.
import type {
  ActionDraftResultView,
  AllocationDraftPayload,
  PurchaseRequisitionDraftPayload as DraftPayloadView,
  ReproductionPlanDraftPayload,
  SalesOrderDraftPayload,
  ShipmentRequestDraftPayload,
} from '@fantasteel/shared';
import { type ActionType, type DraftStatus } from '@/codes';
import { serverActionDraftApi } from '@/api/server/actionDrafts';
import type { JsonValue } from '@/lib/json';

/** 구매요청 초안 값 (서버와 같은 모양). JsonValue에 넣으려면 interface가 아닌 타입 별칭이어야 한다 */
export type PurchaseRequisitionDraftPayload = Pick<DraftPayloadView, keyof DraftPayloadView>;

/** 확장 유형 초안 값 (REQ-ACT-005, 업무 프로세스 12.3). 어느 모양인지는 초안의 actionType으로 정한다 */
export type ExtendedDraftPayload = SalesOrderDraftPayload | ShipmentRequestDraftPayload | AllocationDraftPayload | ReproductionPlanDraftPayload;
export type { AllocationDraftPayload, ReproductionPlanDraftPayload, SalesOrderDraftPayload, ShipmentRequestDraftPayload };

/** 초안을 실행해 만든 업무 (테이블·id·번호). 구매요청 밖의 유형은 지금 상태를 모른다(null) */
export type DraftResultView = ActionDraftResultView;

export interface ActionDraftView {
  id: number;
  actionType: ActionType;
  actionTypeLabel: string;
  draftStatus: DraftStatus;
  /** 구매요청 초안이면 구매요청 칸, 확장 유형이면 그 유형의 칸 (isPurchaseRequisitionDraft로 가른다) */
  payload: PurchaseRequisitionDraftPayload | ExtendedDraftPayload;
  /** payload의 id 칸을 사람이 읽을 이름으로 (예: customerId → '가람중공업', items.0.itemId → 규격) */
  payloadLabels: Record<string, string>;
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
  /** 실행해 만든 업무 (구매요청 포함). 실행 전이면 null */
  result: DraftResultView | null;
  executionResult: JsonValue | null;
  rejectReason: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  executedAt: string | null;
  rejectedAt: string | null;
}

export interface ActionExecution {
  /** 만든 업무의 테이블 (purchase_requisition·sales_order·shipment_request·production_plan·sales_order_item) */
  targetType: string;
  targetId: number;
  targetNo: string;
}

export const actionDraftKeys = {
  all: ['action-drafts'] as const,
  detail: (employeeId: number, actionDraftId: number) => ['action-drafts', 'detail', employeeId, actionDraftId] as const,
  mine: (employeeId: number) => ['action-drafts', 'mine', employeeId] as const,
  room: (employeeId: number, chatRoomId: number) => ['action-drafts', 'room', employeeId, chatRoomId] as const,
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
  /** 실행해 만든 업무 번호 (구매요청·수주·출하요청·재생산 계획) */
  resultNo: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 채팅방 메시지에 달린 초안 (메시지 메뉴의 '초안 보기') */
export interface RoomDraftView {
  id: number;
  messageId: number;
  actionType: ActionType;
  draftStatus: DraftStatus;
  /** 확정 주체 (확장 유형은 만든 사원) */
  requesterId: number | null;
  requesterName: string | null;
}

/** 메시지에서 초안 만들기 결과. created가 false면 같은 메시지·유형의 미처리 초안이 이미 있다 */
export interface DraftCreateResult {
  id: number;
  created: boolean;
  requesterId: number | null;
  requesterName: string | null;
}

export interface DraftConfirmResult {
  draft: DraftDetailView;
  executed: boolean;
  target: ActionExecution | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export type DraftPayloadInput = Partial<Omit<PurchaseRequisitionDraftPayload, 'sourceText' | 'aiFilledFields'>>;

/** 확장 유형 초안 수정: 보낸 칸만 바꾼다 (품목 줄은 통째로). 칸 검증은 서버 유형 정의가 한다 */
export type ExtendedDraftPatch = { [field: string]: JsonValue };

// ── api ─────────────────────────────────────────────────

export const actionDraftApi = {
  /** 초안 상세 (구매요청 조회 이상) */
  get: (actionDraftId: number): Promise<DraftDetailView> => serverActionDraftApi.get(actionDraftId),

  /** 내가 요청자인 초안 (최근 것 먼저) */
  listMine: (): Promise<DraftListItemView[]> => serverActionDraftApi.listMine(),

  /** 이 채팅방 메시지에 달린 초안 (방 멤버만, 반려된 초안 포함) */
  listOfRoom: (chatRoomId: number): Promise<RoomDraftView[]> => serverActionDraftApi.listOfRoom(chatRoomId),

  /**
   * 메시지에서 초안 만들기 (REQ-ACT-001·005). 유형이 없으면 구매요청. 같은 메시지·유형에 미처리 초안이 있으면 그 초안을 돌려준다.
   * 확정 주체(구매요청은 메시지 작성자, 확장 유형은 만드는 사람)가 그 유형의 권한이 없으면 COM-002.
   */
  createFromMessage: (input: { messageId: number; actionType?: ActionType }): Promise<DraftCreateResult> => serverActionDraftApi.createFromMessage(input),

  /** 요청자가 값을 고쳐 저장 (확인 대기일 때만) */
  update: (input: { actionDraftId: number; payload: DraftPayloadInput; expectedUpdatedAt?: string | null }): Promise<DraftDetailView> => serverActionDraftApi.update(input),

  /** 확장 유형 초안의 칸을 고쳐 저장 (만든 사원만, 확인 대기일 때만) */
  updateFields: (input: { actionDraftId: number; fields: ExtendedDraftPatch; expectedUpdatedAt?: string | null }): Promise<DraftDetailView> => serverActionDraftApi.updateFields(input),

  /** 요청자 확정 → 등록부 핸들러로 구매요청 생성 (ACT-001 · REQ-ACT-002) */
  confirm: (input: { actionDraftId: number; expectedUpdatedAt?: string | null }): Promise<DraftConfirmResult> => serverActionDraftApi.confirm(input),

  /** 확정했지만 구매요청을 만들지 못한 초안을 다시 실행 (중복 실행은 서버가 막는다) */
  execute: (input: { actionDraftId: number }): Promise<DraftConfirmResult> => serverActionDraftApi.execute(input),

  /** 요청자 반려 (사유 필수) → REJECTED */
  reject: (input: { actionDraftId: number; rejectReason: string; expectedUpdatedAt?: string | null }): Promise<DraftDetailView> => serverActionDraftApi.reject(input),

  /** 원료 품목 고르기 (기준정보에 등록된 원료) */
  listRawMaterials: (): Promise<DraftItemOption[]> => serverActionDraftApi.listRawMaterials(),
};
