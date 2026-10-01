// Message → ERP 구매요청 초안 api (REQ-ACT-001~004, BP-ACT-01, 13.4).
// 규칙(요청자만 확정·ACT-001·업무 유형 등록부 실행·중복 실행 방지·작업 로그)은 core 서비스(mock/services/actionDrafts.ts)가 한다.
// 이 파일은 권한 확인(requireActor) → core 호출 → 화면용 모양만 맡는다.
import { CHAT_ROOM_TYPE_LABEL, PERMISSION, type ActionType, type DraftStatus } from '@/codes';
import { ApiError, mockMutation, mockQuery } from '@/api/client';
import { requireActor } from '@/api/actor';
import { permissionMapOf } from '@/api/orgViews';
import { canUse } from '@/lib/permissions';
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
  type ActionTypeDefinition,
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
  requester: (employeeId: number, messageId: number) => ['action-drafts', 'requester', employeeId, messageId] as const,
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

/** 메시지 작성자(= 요청자)가 그 메시지의 초안을 확정할 수 있는지 (메시지 메뉴의 '구매요청 초안 만들기') */
export interface DraftRequesterCheck {
  requesterId: number;
  /** 만들기를 막는 까닭 (null = 만들 수 있음) */
  blockReason: string | null;
}

/** 업무 유형 등록부 표시 (REQ-ACT-004 · ACT-005 P2 준비 중) */
export interface ActionTypeCatalogEntry {
  actionType: ActionType;
  label: string;
  grade: 'P1' | 'P2';
  /** 실행 핸들러가 있는 유형 (P1 구매요청 생성만) */
  active: boolean;
  /** 추출 스키마 (TRM-095 · REQ-ACT-001): 구매요청 = 원료 품목 · 수량(톤) · 희망 입고일 · 요청자. 준비 중 유형은 빈 목록 */
  schemaFieldLabels: string[];
  /** 추출 스키마 밖의 선택 입력 (요청 근거 — drafts.md 5장 가정값) */
  optionalInputLabels: string[];
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

function buildRequesterView(tables: Tables, employeeId: number): DraftRequesterView {
  const employee = tables.employee.find((e) => e.id === employeeId);
  return {
    id: employeeId,
    employeeName: employee?.employeeName ?? '알 수 없는 사원',
    jobGradeName: tables.jobGrade.find((g) => g.id === employee?.jobGradeId)?.jobGradeName ?? null,
    departmentName: tables.department.find((d) => d.id === employee?.departmentId)?.departmentName ?? null,
  };
}

function getChatRoomLabel(tables: Tables, chatRoomId: number | null | undefined): string | null {
  const room = tables.chatRoom.find((r) => r.id === chatRoomId);
  if (!room) return null;
  return room.chatRoomName ?? `${CHAT_ROOM_TYPE_LABEL[room.chatRoomType]} 채팅방`;
}

function buildDetailView(tables: Tables, actionDraftId: number, employeeId: number): DraftDetailView {
  const view = actionDraftView(tables, actionDraftId);
  const item = tables.item.find((i) => i.id === view.payload.itemId);
  return {
    ...view,
    requester: buildRequesterView(tables, view.requesterId),
    chatRoomLabel: getChatRoomLabel(tables, view.message?.chatRoomId),
    isRequester: view.requesterId === employeeId,
    itemDefaultSupplierName: tables.supplier.find((s) => s.id === item?.defaultSupplierId)?.supplierName ?? null,
  };
}

const buildListItem = (tables: Tables, view: ActionDraftView): DraftListItemView => ({
  id: view.id,
  actionType: view.actionType,
  actionTypeLabel: view.actionTypeLabel,
  draftStatus: view.draftStatus,
  chatRoomName: getChatRoomLabel(tables, view.message?.chatRoomId),
  messageContent: view.message?.content ?? null,
  purchaseRequisitionNo: view.purchaseRequisition?.purchaseRequisitionNo ?? null,
  createdAt: view.createdAt,
  updatedAt: view.updatedAt,
});

function buildConfirmResult(tables: Tables, outcome: DraftExecutionOutcome, employeeId: number): DraftConfirmResult {
  return {
    draft: buildDetailView(tables, outcome.draft.id, employeeId),
    executed: outcome.executed,
    target: outcome.target,
    errorCode: outcome.errorCode,
    errorMessage: outcome.errorMessage,
  };
}

/** 요청자는 payload 칸이 아니라 초안의 requester_id(= 메시지 작성자, 바꿀 수 없음)로 둔다 */
const REQUESTER_FIELD_LABEL = '요청자';

/** 등록부 입력 칸 중 추출 스키마(TRM-095)에 들지 않는 선택 입력 */
const NON_SCHEMA_FIELD_KEYS: ReadonlySet<keyof PurchaseRequisitionDraftPayload> = new Set(['requestReason']);

function buildCatalogEntry(definition: ActionTypeDefinition): ActionTypeCatalogEntry {
  const active = definition.execute !== null;
  const schemaFields = definition.fields.filter((field) => !NON_SCHEMA_FIELD_KEYS.has(field.key));
  const optionalInputs = definition.fields.filter((field) => NON_SCHEMA_FIELD_KEYS.has(field.key));
  return {
    actionType: definition.actionType,
    label: definition.label,
    grade: definition.grade,
    active,
    // 준비 중(P2) 유형은 아직 추출 스키마가 정해지지 않았다
    schemaFieldLabels: active ? [...schemaFields.map((field) => field.label), REQUESTER_FIELD_LABEL] : [],
    optionalInputLabels: optionalInputs.map((field) => field.label),
  };
}

/** 업무 유형 등록부를 화면용으로 (P1 구매요청 생성만 실행 가능, 나머지는 준비 중) */
export const ACTION_TYPE_CATALOG: readonly ActionTypeCatalogEntry[] = Object.values(ACTION_TYPE_REGISTRY).map(buildCatalogEntry);

/**
 * 요청자(= 메시지 작성자, BP-ACT-01)가 초안을 확정할 수 없는 까닭. 수정·확정·반려는 요청자만 하므로(REQ-ACT-002·003)
 * 요청자가 사용 중이 아니거나 구매요청 등록 사용 권한이 없으면 초안이 확인 대기에 영영 남고, 그 메시지로 새 초안도 만들 수 없다.
 * 그래서 사용자 결정(drafts.md 열린 질문 2) 전까지는 만들기를 막는다. 막을 까닭이 없으면 null.
 */
function findRequesterBlockReason(tables: Tables, requesterId: number): string | null {
  const requester = tables.employee.find((e) => e.id === requesterId);
  if (!requester) return null; // 사원이 보낸 메시지가 아니면 core가 입력 오류로 막는다
  if (!requester.isActive) return '요청자(메시지 작성자)가 사용 중인 사원이 아니라 초안을 만들 수 없어요';
  if (!canUse({ permissions: permissionMapOf(tables, requester.roleId) }, ...DRAFT_PERMISSION)) {
    return '요청자(메시지 작성자)에게 구매요청 등록 권한이 없어 초안을 만들 수 없어요';
  }
  return null;
}

// ── api ─────────────────────────────────────────────────

export const actionDraftApi = {
  /** 초안 상세 (구매요청 조회 이상) */
  get: (actionDraftId: number): Promise<DraftDetailView> =>
    mockQuery((tables) => {
      const actor = requireActor(tables, { view: DRAFT_PERMISSION });
      return buildDetailView(tables, actionDraftId, actor.employee.id);
    }),

  /** 내가 요청자인 초안 (최근 것 먼저) */
  listMine: (): Promise<DraftListItemView[]> =>
    mockQuery((tables) => {
      const actor = requireActor(tables, { view: DRAFT_PERMISSION });
      return listActionDrafts(tables, { requesterId: actor.employee.id }).map((view) => buildListItem(tables, view));
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

  /** 이 메시지로 초안을 만들 수 있는지 — 요청자(메시지 작성자)가 확정할 수 있어야 한다 (방 멤버만) */
  checkRequester: (messageId: number): Promise<DraftRequesterCheck> =>
    mockQuery((tables) => {
      const actor = requireActor(tables, { view: DRAFT_PERMISSION });
      const message = tables.message.find((m) => m.id === messageId);
      if (!message) throw new ApiError('COM-003', `메시지 ${messageId}`);
      if (!tables.chatRoomMember.some((m) => m.chatRoomId === message.chatRoomId && m.employeeId === actor.employee.id)) {
        throw new ApiError('COM-002', '채팅방 멤버만 볼 수 있어요');
      }
      return { requesterId: message.senderId, blockReason: findRequesterBlockReason(tables, message.senderId) };
    }),

  /**
   * 메시지에서 구매요청 초안 만들기 (REQ-ACT-001). 같은 메시지에 반려되지 않은 초안이 있으면 그 초안을 돌려준다.
   * 요청자(메시지 작성자)가 확정할 수 없으면 COM-002 (findRequesterBlockReason).
   */
  createFromMessage: (input: { messageId: number }): Promise<{ id: number; created: boolean }> =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: DRAFT_PERMISSION });
      const message = tx.tables.message.find((m) => m.id === input.messageId); // 없으면 core가 COM-003
      const blockReason = message ? findRequesterBlockReason(tx.tables, message.senderId) : null;
      if (blockReason) throw new ApiError('COM-002', blockReason);
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
      return buildDetailView(tx.tables, input.actionDraftId, actor.employee.id);
    }),

  /** 요청자 확정 → 등록부 핸들러로 구매요청 생성 (ACT-001 · REQ-ACT-002) */
  confirm: (input: { actionDraftId: number; expectedUpdatedAt?: string | null }): Promise<DraftConfirmResult> =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: DRAFT_PERMISSION });
      const outcome = confirmDraft(tx, userActor(actor.employee.id), input);
      return buildConfirmResult(tx.tables, outcome, actor.employee.id);
    }),

  /** 확정했지만 구매요청을 만들지 못한 초안을 다시 실행 (중복 실행은 core가 막는다) */
  execute: (input: { actionDraftId: number }): Promise<DraftConfirmResult> =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: DRAFT_PERMISSION });
      const outcome = executeDraft(tx, userActor(actor.employee.id), input);
      return buildConfirmResult(tx.tables, outcome, actor.employee.id);
    }),

  /** 요청자 반려 (사유 필수) → REJECTED */
  reject: (input: { actionDraftId: number; rejectReason: string; expectedUpdatedAt?: string | null }): Promise<DraftDetailView> =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: DRAFT_PERMISSION });
      rejectDraft(tx, userActor(actor.employee.id), input);
      return buildDetailView(tx.tables, input.actionDraftId, actor.employee.id);
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
