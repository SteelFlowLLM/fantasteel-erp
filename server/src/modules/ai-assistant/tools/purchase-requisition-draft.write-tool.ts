import { PERMISSION, type AuthUser } from '@fantasteel/shared';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { AssistantDraftInput, MessageActionService } from '../../message-action/message-action.service';
import { retryOnNumberConflict } from '../../purchasing/purchasing.service';
import type { AiAssistantRepository } from '../ai-assistant.repository';
import { optionalDate, optionalString, requiredString } from './assistant-tool';
import type { AssistantWriteTool } from './assistant-write-tool';

const DATE = '^\\d{4}-\\d{2}-\\d{2}$';
/** 초안 원본 글로 남기는 질문 길이 (질문 상한 1000자와 같다) */
const QUESTION_MAX = 1000;

export interface PurchaseRequisitionDraftWriteToolDeps {
  prisma: PrismaService;
  messageActions: MessageActionService;
  repository: AiAssistantRepository;
}

/**
 * 구매요청 초안 만들기. Message → ERP와 같은 구매요청 초안(action_draft)을 만들고, 확정은 지금처럼 초안 화면에서 요청자가 한다.
 * 요청자 = 묻는 사원. 검증·저장·작업 로그(DRAFT_CREATED, AI 경유)는 MessageActionService가 한다.
 */
export function purchaseRequisitionDraftWriteTool(deps: PurchaseRequisitionDraftWriteToolDeps): AssistantWriteTool {
  return {
    definition: {
      name: 'create_purchase_request_draft',
      description:
        '사용자 본인을 요청자로 하는 구매요청 초안을 만들어요(구매요청을 바로 등록하지 않아요). 사용자가 구매요청을 분명히 부탁했을 때만 불러요. 실행 전에 사용자가 승인 카드에서 허용해야 하고, 만든 뒤 사용자가 초안 화면에서 확인·확정하면 구매요청이 등록돼요. 원료와 수량을 모르면 지어내지 말고 먼저 물어요.',
      parameters: {
        type: 'object',
        properties: {
          itemCode: { type: 'string', description: '원료 품목 코드나 이름 (예: ORE01, 철광석)', minLength: 1, maxLength: 60 },
          requestedTon: { type: 'number', description: '요청 수량(톤). 0보다 큰 숫자, 소수 3자리까지', exclusiveMinimum: 0 },
          desiredReceiptDate: { type: 'string', description: '희망 입고일 YYYY-MM-DD. 모르면 비워요(초안 화면에서 채워요)', pattern: DATE },
          requestReason: { type: 'string', description: '요청 근거 (사용자가 말한 내용만)', maxLength: 500 },
        },
        required: ['itemCode', 'requestedTon'],
        additionalProperties: false,
      },
    },
    permissions: [PERMISSION.PURCHASE_REQUISITION_CREATE],
    async prepare(user: AuthUser, args, context) {
      const input: AssistantDraftInput = {
        itemCode: requiredString(args, 'itemCode', 60),
        // 스키마가 숫자를 확인했다. 형식(소수 3자리)은 초안 검증이 본다
        requestedTon: String(args.requestedTon),
        desiredReceiptDate: optionalDate(args, 'desiredReceiptDate') ?? null,
        requestReason: optionalString(args, 'requestReason', 500) ?? null,
        question: context.question.slice(0, QUESTION_MAX),
      };
      const preview = await deps.messageActions.previewFromAssistant(deps.prisma, user, input);
      const { payload } = preview;
      return {
        card: {
          title: `구매요청 초안 만들기: ${preview.itemName} ${payload.requestedTon}t`,
          details: [
            { label: '원료', value: `${preview.itemCode} ${preview.itemName}` },
            { label: '수량(톤)', value: payload.requestedTon ?? '' },
            { label: '희망 입고일', value: payload.desiredReceiptDate ?? '비어 있음 (초안 화면에서 채워요)' },
            ...(payload.requestReason ? [{ label: '요청 근거', value: payload.requestReason }] : []),
            { label: '요청자', value: user.employeeName },
            { label: '다음 단계', value: '초안 화면에서 확인·확정하면 구매요청이 등록되고 부서장 승인을 기다려요' },
          ],
        },
        execute: async (actor, approvalId) => {
          // 카드에 보인 원료로만 만든다: 그 사이 코드가 다른 원료를 가리키면 COM-001로 멈춘다(다시 하지 않음)
          const confirmed = { ...input, expectedItemId: payload.itemId ?? undefined };
          const id = await retryOnNumberConflict(() =>
            deps.prisma.$transaction(async (tx) => {
              // 같은 카드로 이미 만들었으면(COMMIT 뒤 연결이 끊겨 다시 하는 경우) 그 초안을 돌려준다
              const done = await deps.repository.findApprovalEvent(tx, approvalId);
              return done ? done.targetId : deps.messageActions.createFromAssistantIn(tx, actor, confirmed, approvalId);
            }),
          );
          return {
            message: `구매요청 초안 #${id}을(를) 만들었어요. 초안 화면에서 확인·확정해 주세요`,
            result: { table: 'action_draft', id, label: `구매요청 초안 #${id}`, linkPath: `/action-drafts/${id}` },
          };
        },
      };
    },
  };
}
