// Message → ERP 구매요청 초안 api (REQ-ACT-001~004, BP-ACT-01, 13.4).
// 규칙(요청자만 확정·ACT-001·업무 유형 등록부 실행·중복 실행 방지·작업 로그)은 core 서비스(mock/services/actionDrafts.ts)가 한다.
// 이 파일은 권한 확인(requireActor) → core 호출 → 화면용 모양만 맡는다.
import { CHAT_ROOM_TYPE_LABEL, PERMISSION, type ActionType, type DraftStatus } from '@/codes';
import { ApiError, mockMutation, mockQuery } from '@/api/client';
import { requireActor } from '@/api/actor';
import type { MockTables } from '@/mock/schema';
import {
  ACTION_TYPE_REGISTRY,
  actionDraftView,
  confirmDraft,
  createDraftFromMessage,
  executeDraft,
  listActionDrafts,
  rejectDraft,
  updateDraft,
  userActor,
  type ActionDraftView,
  type ActionExecution,
  type DraftExecutionOutcome,
  type PurchaseRequisitionDraftPayload,
} from '@/mock/services';

/** 초안은 구매요청을 만드는 일이라 구매요청 등록 권한으로 본다 (조회 = VIEW 이상, 변경 = USE) */
const DRAFT_PERMISSION = [PERMISSION.PURCHASE_REQUISITION_CREATE] as const;

export const actionDraftKeys = {
  all: ['action-drafts'] as const,
  detail: (employeeId: number, actionDraftId: number) => ['action-drafts', 'detail', employeeId, actionDraftId] as const,
  mine: (employeeId: number) => ['action-drafts', 'mine', employeeId] as const,
  room: (employeeId: number, chatRoomId: number) => ['action-drafts', 'room', employeeId, chatRoomId] as const,
};

type Tables = Readonly<MockTables>;

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

/** 업무 유형 등록부 표시 (REQ-ACT-004 · ACT-005 P2 준비 중) */
export interface ActionTypeCatalogEntry {
  actionType: ActionType;
  label: string;
  grade: 'P1' | 'P2';
  /** 실행 핸들러가 있는 유형 (P1 구매요청 생성만) */
  active: boolean;
  fieldLabels: string[];
}

export interface DraftConfirmResult {
  draft: DraftDetailView;
  executed: boolean;
  target: ActionExecution | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export type DraftPayloadInput = Partial<Omit<PurchaseRequisitionDraftPayload, 'sourceText'>>;

// ── 조회 모양 만들기 ─────────────────────────────────────

function requesterOf(tables: Tables, employeeId: number): DraftRequesterView {
  const employee = tables.employee.find((e) => e.id === employeeId);
  return {
    id: employeeId,
    employeeName: employee?.employeeName ?? '알 수 없는 사원',
    jobGradeName: tables.jobGrade.find((g) => g.id === employee?.jobGradeId)?.jobGradeName ?? null,
    departmentName: tables.department.find((d) => d.id === employee?.departmentId)?.departmentName ?? null,
  };
}

function chatRoomLabelOf(tables: Tables, chatRoomId: number | null | undefined): string | null {
  const room = tables.chatRoom.find((r) => r.id === chatRoomId);
  if (!room) return null;
  return room.chatRoomName ?? `${CHAT_ROOM_TYPE_LABEL[room.chatRoomType]} 채팅방`;
}

function detailOf(tables: Tables, actionDraftId: number, employeeId: number): DraftDetailView {
  const view = actionDraftView(tables, actionDraftId);
  const item = tables.item.find((i) => i.id === view.payload.itemId);
  return {
    ...view,
    requester: requesterOf(tables, view.requesterId),
    chatRoomLabel: chatRoomLabelOf(tables, view.message?.chatRoomId),
    isRequester: view.requesterId === employeeId,
    itemDefaultSupplierName: tables.supplier.find((s) => s.id === item?.defaultSupplierId)?.supplierName ?? null,
  };
}

const listItemOf = (tables: Tables, view: ActionDraftView): DraftListItemView => ({
  id: view.id,
  actionType: view.actionType,
  actionTypeLabel: view.actionTypeLabel,
  draftStatus: view.draftStatus,
  chatRoomName: chatRoomLabelOf(tables, view.message?.chatRoomId),
  messageContent: view.message?.content ?? null,
  purchaseRequisitionNo: view.purchaseRequisition?.purchaseRequisitionNo ?? null,
  createdAt: view.createdAt,
  updatedAt: view.updatedAt,
});

function confirmResultOf(tables: Tables, outcome: DraftExecutionOutcome, employeeId: number): DraftConfirmResult {
  return {
    draft: detailOf(tables, outcome.draft.id, employeeId),
    executed: outcome.executed,
    target: outcome.target,
    errorCode: outcome.errorCode,
    errorMessage: outcome.errorMessage,
  };
}

/** 업무 유형 등록부를 화면용으로 (P1 구매요청 생성만 실행 가능, 나머지는 준비 중) */
export const ACTION_TYPE_CATALOG: readonly ActionTypeCatalogEntry[] = Object.values(ACTION_TYPE_REGISTRY).map((definition) => ({
  actionType: definition.actionType,
  label: definition.label,
  grade: definition.grade,
  active: definition.execute !== null,
  fieldLabels: definition.fields.map((field) => field.label),
}));

// ── api ─────────────────────────────────────────────────

export const actionDraftApi = {
  /** 초안 상세 (구매요청 조회 이상) */
  get: (actionDraftId: number): Promise<DraftDetailView> =>
    mockQuery((tables) => {
      const actor = requireActor(tables, { view: DRAFT_PERMISSION });
      return detailOf(tables, actionDraftId, actor.employee.id);
    }),

  /** 내가 요청자인 초안 (최근 것 먼저) */
  listMine: (): Promise<DraftListItemView[]> =>
    mockQuery((tables) => {
      const actor = requireActor(tables, { view: DRAFT_PERMISSION });
      return listActionDrafts(tables, { requesterId: actor.employee.id }).map((view) => listItemOf(tables, view));
    }),

  /** 이 채팅방 메시지에 달린 초안 (방 멤버만, 반려된 초안 포함) */
  listOfRoom: (chatRoomId: number): Promise<RoomDraftView[]> =>
    mockQuery((tables) => {
      const actor = requireActor(tables, { view: DRAFT_PERMISSION });
      if (!tables.chatRoomMember.some((m) => m.chatRoomId === chatRoomId && m.employeeId === actor.employee.id)) {
        throw new ApiError('COM-002', '채팅방 멤버만 볼 수 있어요');
      }
      const messageIds = new Set(tables.message.filter((m) => m.chatRoomId === chatRoomId).map((m) => m.id));
      return tables.actionDraft
        .filter((d) => d.messageId !== null && messageIds.has(d.messageId))
        .sort((a, b) => b.id - a.id)
        .map((d) => ({ id: d.id, messageId: d.messageId ?? 0, draftStatus: d.draftStatus }));
    }),

  /** 메시지에서 구매요청 초안 만들기 (REQ-ACT-001). 같은 메시지에 반려되지 않은 초안이 있으면 그 초안을 돌려준다. */
  createFromMessage: (input: { messageId: number }): Promise<{ id: number; created: boolean }> =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: DRAFT_PERMISSION });
      const { draft, created } = createDraftFromMessage(tx, userActor(actor.employee.id), {
        messageId: input.messageId,
        actionType: 'PURCHASE_REQUISITION_CREATE',
      });
      return { id: draft.id, created };
    }),

  /** 요청자가 값을 고쳐 저장 (확인 대기일 때만) */
  update: (input: { actionDraftId: number; payload: DraftPayloadInput; expectedUpdatedAt?: string | null }): Promise<DraftDetailView> =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: DRAFT_PERMISSION });
      updateDraft(tx, userActor(actor.employee.id), input);
      return detailOf(tx.tables, input.actionDraftId, actor.employee.id);
    }),

  /** 요청자 확정 → 등록부 핸들러로 구매요청 생성 (ACT-001 · REQ-ACT-002) */
  confirm: (input: { actionDraftId: number; expectedUpdatedAt?: string | null }): Promise<DraftConfirmResult> =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: DRAFT_PERMISSION });
      const outcome = confirmDraft(tx, userActor(actor.employee.id), input);
      return confirmResultOf(tx.tables, outcome, actor.employee.id);
    }),

  /** 확정했지만 구매요청을 만들지 못한 초안을 다시 실행 (중복 실행은 core가 막는다) */
  execute: (input: { actionDraftId: number }): Promise<DraftConfirmResult> =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: DRAFT_PERMISSION });
      const outcome = executeDraft(tx, userActor(actor.employee.id), input);
      return confirmResultOf(tx.tables, outcome, actor.employee.id);
    }),

  /** 요청자 반려 (사유 필수) → REJECTED */
  reject: (input: { actionDraftId: number; rejectReason: string; expectedUpdatedAt?: string | null }): Promise<DraftDetailView> =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: DRAFT_PERMISSION });
      rejectDraft(tx, userActor(actor.employee.id), input);
      return detailOf(tx.tables, input.actionDraftId, actor.employee.id);
    }),

  /** 원료 품목 고르기 (기준정보에 등록된 원료) */
  listRawMaterials: (): Promise<DraftItemOption[]> =>
    mockQuery((tables) => {
      requireActor(tables, { view: DRAFT_PERMISSION });
      return tables.item
        .filter((item) => item.itemType === 'RAW_MATERIAL')
        .sort((a, b) => a.itemCode.localeCompare(b.itemCode))
        .map((item) => ({
          id: item.id,
          itemCode: item.itemCode,
          itemName: item.itemName,
          defaultSupplierName: tables.supplier.find((s) => s.id === item.defaultSupplierId)?.supplierName ?? null,
        }));
    }),
};
