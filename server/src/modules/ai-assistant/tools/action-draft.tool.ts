import { ACTION_TYPE, ACTION_TYPE_LABEL, DRAFT_STATUS, DRAFT_STATUS_LABEL, type ActionDraftView, type DraftStatus } from '@fantasteel/shared';
import type { MessageActionService } from '../../message-action/message-action.service';
import { codeLabelList, limitRows, OPEN_ACCESS, optionalEnum, seoulDateTimeText, type AssistantTool } from './assistant-tool';

const DRAFT_STATUSES = Object.values(DRAFT_STATUS) as DraftStatus[];
/** 원본 메시지 글은 앞부분만 보낸다 (작은 모델의 문맥을 넘지 않게) */
const MESSAGE_PREVIEW_MAX = 80;

/** 아직 사람이 처리해야 하는 초안: 확인 대기·확정했지만 업무를 만들지 못한 것 */
export const isOpenActionDraft = (draft: Pick<ActionDraftView, 'draftStatus'>): boolean =>
  draft.draftStatus === DRAFT_STATUS.AI_GENERATED || draft.draftStatus === DRAFT_STATUS.WAITING_APPROVAL || draft.draftStatus === DRAFT_STATUS.APPROVED;

export function draftRow(d: ActionDraftView) {
  const purchase = d.actionType === ACTION_TYPE.PURCHASE_REQUISITION_CREATE ? (d.payload as { requestedTon?: string | null; desiredReceiptDate?: string | null }) : null;
  return {
    초안id: d.id,
    '업무 유형': ACTION_TYPE_LABEL[d.actionType],
    상태: DRAFT_STATUS_LABEL[d.draftStatus],
    ...(d.itemCode ? { 원료: `${d.itemCode} ${d.itemName ?? ''}`.trim() } : {}),
    ...(purchase ? { '요청 톤': purchase.requestedTon ?? null, '희망 입고일': purchase.desiredReceiptDate ?? null } : {}),
    // 채워진 칸의 이름(고객사·규격·LOT 등 id가 아닌 읽을 수 있는 이름)
    ...(Object.keys(d.payloadLabels).length ? { 채워진값: d.payloadLabels } : {}),
    '확인할 칸': d.unresolvedFields,
    ...(d.message ? { '원본 메시지': `${d.message.chatRoomName ?? '대화방'} · ${d.message.senderName ?? '시스템'}: ${(d.message.content ?? '').slice(0, MESSAGE_PREVIEW_MAX)}` } : {}),
    ...(d.meetingMinutes ? { '원본 회의록': d.meetingMinutes.title } : {}),
    ...(d.result ? { '만든 업무': d.result.no } : {}),
    ...(d.executionErrorCode ? { '실행 오류 코드': d.executionErrorCode, '실행 시도': d.executionAttemptCount } : {}),
    ...(d.rejectReason ? { '반려 사유': d.rejectReason } : {}),
    만든시각: seoulDateTimeText(d.createdAt),
  };
}

/**
 * Message → ERP 초안 목록 (GET action-drafts, 문서에 없는 기능 이슈 #506). 확정하는 사람이 요청자(만든 사원 또는 메시지 작성자)라
 * 내가 만들었거나 내가 확인·확정해야 하는 초안만 service가 돌려준다. 남의 초안은 오지 않는다.
 * 기본은 처리할 초안(확인 대기·확정 뒤 실행 실패)이다. 사원 본인의 것이라 철강맨AI 패널에서만 알린다.
 */
export function myActionDraftsTool(messageActions: MessageActionService): AssistantTool {
  return {
    access: OPEN_ACCESS,
    panelOnly: true,
    definition: {
      name: 'get_my_action_drafts',
      description: `내가 만들었거나 내가 확인·확정해야 하는 Message→ERP 초안(메신저 메시지·회의록에서 만든 구매요청 등 초안)을 조회한다. 기본은 처리할 초안(확인 대기·확정 뒤 실행 실패)만. status로 상태를 정하면 그 상태만: ${codeLabelList(DRAFT_STATUS_LABEL)}. 초안을 확정·반려하지는 못한다.`,
      parameters: {
        type: 'object',
        properties: { status: { type: 'string', enum: DRAFT_STATUSES, description: '초안 상태 (생략하면 처리할 초안만)' } },
      },
    },
    async run(args, user) {
      const status = optionalEnum(args, 'status', DRAFT_STATUSES);
      const mine = await messageActions.list(user, {});
      const rows = mine.filter((d) => (status ? d.draftStatus === status : isOpenActionDraft(d)));
      const limited = limitRows(rows);
      return {
        label: `내 초안${status ? ` · ${DRAFT_STATUS_LABEL[status]}` : ' · 처리할 초안'}`,
        data: { '초안 수': rows.length, 초안: limited.rows.map(draftRow), '생략 줄 수': limited.omitted },
      };
    },
  };
}
