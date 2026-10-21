// Message → ERP 초안 화면 ↔ 서버 API (server/src/modules/message-action, docs/backend/message-action.md).
// 서버 응답(ActionDraftView)을 화면 모양(DraftDetailView 등)으로 바꾼다. 요청자·방 멤버·권한·필수값·실행은 서버가 확인한다.
// 서버에 없는 값: 실행 실패 결과는 실패 코드·시도 횟수로, 실행·반려 시각은 그 상태가 된 마지막 변경 시각(updatedAt)으로 채운다.
import type { ActionDraftCreateResult, ActionDraftExecutionResult, ActionDraftView, AuthUser } from '@fantasteel/shared';
import type { ActionType } from '@/codes';
import type {
  DraftConfirmResult,
  DraftCreateResult,
  DraftDetailView,
  DraftItemOption,
  DraftListItemView,
  DraftPayloadInput,
  ExtendedDraftPatch,
  RoomDraftView,
} from '@/api/actionDrafts';
import { serverRequest } from '@/api/http';
import { serverLookupApi } from '@/api/server/lookups';
import { ACTION_TYPE_LABEL, CHAT_ROOM_TYPE_LABEL, ERROR_MESSAGE, isErrorCode } from '@/codes';

const me = () => serverRequest<AuthUser>('GET', '/auth/me');

const chatRoomLabelOf = (message: ActionDraftView['message']): string | null =>
  message ? (message.chatRoomName ?? `${CHAT_ROOM_TYPE_LABEL[message.chatRoomType]} 채팅방`) : null;

/** 실행 결과가 구매요청이면 화면의 구매요청 칸 모양으로 (다른 유형은 result로 본다) */
function purchaseRequisitionOf(v: ActionDraftView): DraftDetailView['purchaseRequisition'] {
  const r = v.result;
  return r && r.table === 'purchase_requisition' ? { id: r.id, purchaseRequisitionNo: r.no, purchaseRequisitionStatus: r.status ?? '' } : null;
}

/** 화면의 실행 실패 표시(getExecutionFailure)가 읽는 모양 */
function executionResultOf(v: ActionDraftView) {
  if (v.draftStatus !== 'APPROVED' || v.executionErrorCode === null) return null;
  const code = v.executionErrorCode;
  return { attempts: v.executionAttemptCount, errorCode: code, message: isErrorCode(code) ? ERROR_MESSAGE[code] : code };
}

function toDetail(v: ActionDraftView, employeeId: number): DraftDetailView {
  const message = v.message;
  return {
    id: v.id,
    actionType: v.actionType,
    actionTypeLabel: ACTION_TYPE_LABEL[v.actionType],
    draftStatus: v.draftStatus,
    payload: v.payload,
    payloadLabels: v.payloadLabels,
    itemCode: v.itemCode,
    itemName: v.itemName,
    requesterId: v.requesterId ?? 0,
    requesterName: v.requesterName,
    message: message ? { id: message.id, chatRoomId: message.chatRoomId, chatRoomName: message.chatRoomName, senderName: message.senderName, content: message.content, createdAt: message.createdAt } : null,
    meetingMinutes: v.meetingMinutes,
    unresolvedFields: v.unresolvedFields,
    purchaseRequisition: purchaseRequisitionOf(v),
    result: v.result,
    executionResult: executionResultOf(v),
    rejectReason: v.rejectReason,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    confirmedAt: v.confirmedAt,
    executedAt: v.draftStatus === 'EXECUTED' ? v.updatedAt : null,
    rejectedAt: v.draftStatus === 'REJECTED' ? v.updatedAt : null,
    requester: { id: v.requesterId ?? 0, employeeName: v.requesterName ?? '알 수 없는 사원', jobGradeName: v.requesterJobGradeName, departmentName: v.requesterDepartmentName },
    chatRoomLabel: chatRoomLabelOf(message),
    isRequester: v.requesterId === employeeId,
    itemDefaultSupplierName: v.itemDefaultSupplierName,
  };
}

async function get(actionDraftId: number): Promise<DraftDetailView> {
  const [view, user] = await Promise.all([serverRequest<ActionDraftView>('GET', `/action-drafts/${actionDraftId}`), me()]);
  return toDetail(view, user.employeeId);
}

async function toConfirmResult(result: ActionDraftExecutionResult): Promise<DraftConfirmResult> {
  const user = await me();
  const made = result.draft.result;
  return {
    draft: toDetail(result.draft, user.employeeId),
    executed: result.executed,
    target: result.executed && made ? { targetType: made.table, targetId: made.id, targetNo: made.no } : null,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
  };
}

/** 보낸 칸만 서버에 보낸다 (보내지 않은 칸은 그대로, 빈 값은 비운다) */
function patchBody(payload: DraftPayloadInput, expectedUpdatedAt: string | null | undefined) {
  const text = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);
  return {
    payload: {
      itemId: payload.itemId,
      requestedTon: text(payload.requestedTon),
      desiredReceiptDate: text(payload.desiredReceiptDate),
      requestReason: text(payload.requestReason),
    },
    expectedUpdatedAt: expectedUpdatedAt ?? undefined,
  };
}

export const serverActionDraftApi = {
  get,

  listMine: async (): Promise<DraftListItemView[]> =>
    (await serverRequest<ActionDraftView[]>('GET', '/action-drafts')).map((v) => ({
      id: v.id,
      actionType: v.actionType,
      actionTypeLabel: ACTION_TYPE_LABEL[v.actionType],
      draftStatus: v.draftStatus,
      chatRoomName: chatRoomLabelOf(v.message),
      messageContent: v.message?.content ?? null,
      resultNo: v.result?.no ?? null,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
    })),

  listOfRoom: async (chatRoomId: number): Promise<RoomDraftView[]> =>
    (await serverRequest<ActionDraftView[]>('GET', '/action-drafts', { query: { chatRoomId } })).map((v) => ({
      id: v.id,
      messageId: v.message?.id ?? 0,
      actionType: v.actionType,
      draftStatus: v.draftStatus,
      requesterId: v.requesterId,
      requesterName: v.requesterName,
    })),

  createFromMessage: (input: { messageId: number; actionType?: ActionType }): Promise<DraftCreateResult> =>
    serverRequest<ActionDraftCreateResult>('POST', `/messages/${input.messageId}/action-drafts`, input.actionType ? { body: { actionType: input.actionType } } : undefined),

  update: async (input: { actionDraftId: number; payload: DraftPayloadInput; expectedUpdatedAt?: string | null }): Promise<DraftDetailView> => {
    const [view, user] = await Promise.all([
      serverRequest<ActionDraftView>('PATCH', `/action-drafts/${input.actionDraftId}`, { body: patchBody(input.payload, input.expectedUpdatedAt) }),
      me(),
    ]);
    return toDetail(view, user.employeeId);
  },

  /** 확장 유형은 칸 이름 그대로 보낸다 (서버 유형 정의가 검증한다) */
  updateFields: async (input: { actionDraftId: number; fields: ExtendedDraftPatch; expectedUpdatedAt?: string | null }): Promise<DraftDetailView> => {
    const [view, user] = await Promise.all([
      serverRequest<ActionDraftView>('PATCH', `/action-drafts/${input.actionDraftId}`, { body: { payload: input.fields, expectedUpdatedAt: input.expectedUpdatedAt ?? undefined } }),
      me(),
    ]);
    return toDetail(view, user.employeeId);
  },

  confirm: async (input: { actionDraftId: number; expectedUpdatedAt?: string | null }): Promise<DraftConfirmResult> =>
    toConfirmResult(await serverRequest<ActionDraftExecutionResult>('POST', `/action-drafts/${input.actionDraftId}/confirm`, { body: { expectedUpdatedAt: input.expectedUpdatedAt ?? undefined } })),

  execute: async (input: { actionDraftId: number }): Promise<DraftConfirmResult> =>
    toConfirmResult(await serverRequest<ActionDraftExecutionResult>('POST', `/action-drafts/${input.actionDraftId}/execute`)),

  reject: async (input: { actionDraftId: number; rejectReason: string; expectedUpdatedAt?: string | null }): Promise<DraftDetailView> => {
    await serverRequest<ActionDraftView>('POST', `/action-drafts/${input.actionDraftId}/reject`, { body: { rejectReason: input.rejectReason, expectedUpdatedAt: input.expectedUpdatedAt ?? undefined } });
    return get(input.actionDraftId);
  },

  listRawMaterials: async (): Promise<DraftItemOption[]> =>
    (await serverLookupApi.listItems({ itemType: 'RAW_MATERIAL' }))
      .map((i) => ({ id: i.id, itemCode: i.itemCode, itemName: i.itemName, defaultSupplierName: i.defaultSupplierName }))
      .sort((a, b) => a.itemCode.localeCompare(b.itemCode)),
};
