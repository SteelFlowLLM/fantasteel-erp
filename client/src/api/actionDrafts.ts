// Message → ERP 초안 (docs/api/message-action.md 의 응답 모양 그대로). 메신저의 "초안 만들기"는 api/messenger.ts 가 맡는다.
import type { ActionType, DraftStatus, PurchaseRequisitionDraftPayload } from '@fantasteel/shared';
import { api } from '@/api/client';
import type { EmployeeBrief } from '@/api/purchasing';

export type DraftExecutionResult =
  | { purchaseRequisitionId: number; purchaseRequisitionNo: string; attemptCount: number }
  | { errorCode: string | null; errorMessage: string; attemptCount: number; lastAttemptAt: string };

export interface ActionDraftView {
  id: number;
  actionType: ActionType;
  actionTypeLabel: string;
  confirmer: 'REQUESTER';
  payload: PurchaseRequisitionDraftPayload;
  /** 아직 확정할 수 없는 payload 필드. 비어 있어야 확정할 수 있다 */
  unresolvedFields: string[];
  fieldLabels: Record<string, string>;
  draftStatus: DraftStatus;
  requesterId: number;
  requester: EmployeeBrief;
  messageId: number | null;
  message: {
    id: number;
    content: string;
    messageType: string;
    createdAt: string;
    sender: EmployeeBrief | null;
    chatRoom: { id: number; chatRoomType: string; chatRoomName: string | null };
  } | null;
  executionResult: DraftExecutionResult | null;
  purchaseRequisition: { id: number; purchaseRequisitionNo: string; purchaseRequisitionStatus: string } | null;
  rejectReason: string | null;
  confirmedAt: string | null;
  executedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActionDraftPayloadPatch {
  rawMaterialId?: number | null;
  requiredTon?: string | number | null;
  desiredReceiptDate?: string | null;
  requestReason?: string | null;
}
export interface ActionDraftListQuery { mine?: boolean; status?: DraftStatus }

export const actionDraftApi = {
  list: (q: ActionDraftListQuery = {}) => api.get<ActionDraftView[]>('/action-drafts', { mine: q.mine ? true : undefined, status: q.status }),
  get: (id: number) => api.get<ActionDraftView>(`/action-drafts/${id}`),
  update: ({ id, payload }: { id: number; payload: ActionDraftPayloadPatch }) => api.patch<ActionDraftView>(`/action-drafts/${id}`, { payload }),
  confirm: (id: number) => api.post<ActionDraftView>(`/action-drafts/${id}/confirm`),
  reject: ({ id, rejectReason }: { id: number; rejectReason: string }) => api.post<ActionDraftView>(`/action-drafts/${id}/reject`, { rejectReason }),
};

/** 실행 결과가 실패 기록인지 (초안은 APPROVED로 남아 있다) */
export const isExecutionFailure = (r: DraftExecutionResult | null): r is { errorCode: string | null; errorMessage: string; attemptCount: number; lastAttemptAt: string } =>
  !!r && 'errorMessage' in r;
