import { Injectable, Logger } from '@nestjs/common';
import { PERMISSION_LABEL, ROLE_LABEL, type AiAssistantStreamEvent, type AuthUser } from '@fantasteel/shared';
import { AppException } from '../../../common/errors/app.exception';
import { PrismaService } from '../../../prisma/prisma.service';
import type { LlmToolCall } from '../../llm/llm.client';
import { AiAssistantRepository } from '../ai-assistant.repository';
import { ToolArgumentError } from '../tools/assistant-tool';
import type { AssistantWriteTool, PreparedWrite } from '../tools/assistant-write-tool';
import { AssistantWriteToolbox } from '../tools/assistant-write-toolbox';
import { parseToolArguments } from '../tools/tool-schema';
import { AssistantApprovalRegistry, type ApprovalOutcome } from './approval.registry';
import { isFixableError, runWithTransientRetry, type WriteFixBudget } from './write-call.rules';

type ApprovalEvent = Extract<AiAssistantStreamEvent, { type: 'approval_required' | 'approval_resolved' | 'tool_execution' | 'heartbeat' }>;

/** 카드를 기다리는 동안 빈 이벤트를 보내는 간격. 프록시가 조용한 연결(최대 10분)을 끊지 않게 한다 */
export const APPROVAL_HEARTBEAT_MS = 20_000;

export interface WriteCallContext {
  user: AuthUser;
  call: LlmToolCall;
  /** 같은 호출의 tool_start.id */
  toolId: string;
  question: string;
  emit: (event: ApprovalEvent) => void;
  signal?: AbortSignal;
  /** 이 질문의 고칠 기회 (질문마다 하나) */
  budget: WriteFixBudget;
}

export interface WriteCallOutcome {
  /** 모델에 tool 메시지로 넘길 JSON */
  content: string;
  /** true면 더 고치지 않는다: 다음 차례는 도구 없이 지금까지의 결과로 답하게 한다 */
  stop: boolean;
}

const json = (value: Record<string, unknown>) => JSON.stringify(value);

/**
 * 쓰기 도구 호출 하나를 처리한다 (철강맨AI 승인 카드, 이슈 #362).
 * 인자 스키마 → 사전 확인(dry-run) → 승인 카드 → 허용이면 실행(일시 오류만 같은 내용으로 다시) 순서다.
 * 실패와 거부는 예외가 아니라 결과로 모델에 돌려줘 사용자에게 설명하게 한다.
 */
@Injectable()
export class AssistantActionRunner {
  private readonly logger = new Logger(AssistantActionRunner.name);

  constructor(
    private readonly writeTools: AssistantWriteToolbox,
    private readonly approvals: AssistantApprovalRegistry,
    private readonly prisma: PrismaService,
    private readonly repository: AiAssistantRepository,
  ) {}

  async run(ctx: WriteCallContext): Promise<WriteCallOutcome> {
    const { user, call } = ctx;
    const tool = this.writeTools.get(call.name);
    if (!tool) return { content: json({ 오류: `없는 도구예요: ${call.name}` }), stop: false };
    if (ctx.budget.isRepeat(call.name, call.arguments)) {
      return { content: json({ 오류: '앞에서 실패한 것과 같은 인자로 다시 불렀어요', 안내: '고치지 못해 이번에는 실행하지 않아요. 무엇이 맞지 않았는지 사용자에게 짧게 알려요' }), stop: true };
    }

    const parsed = parseToolArguments(call.arguments, tool.definition.parameters);
    if (!parsed.ok) return this.fixable(ctx, parsed.errors.join(' / '));

    let prepared: PreparedWrite;
    try {
      prepared = await tool.prepare(user, parsed.args, { question: ctx.question });
    } catch (error) {
      if (error instanceof ToolArgumentError) return this.fixable(ctx, error.message);
      if (error instanceof AppException) return isFixableError(error) ? this.fixable(ctx, messageOf(error)) : this.unfixable(user, tool, error);
      this.logger.error(`철강맨AI 쓰기 도구 사전 확인 실패 (${call.name})`, error instanceof Error ? error.stack : String(error));
      return { content: json({ 오류: '확인 중 서버 오류가 났어요', 안내: '이번에는 실행하지 않았다고 알려요' }), stop: true };
    }

    // 자리를 먼저 만들고 카드를 보낸다 (화면이 빨리 허용해도 자리가 있다)
    const pending = this.approvals.open(user.employeeId, ctx.signal);
    ctx.emit({
      type: 'approval_required',
      approvalId: pending.id,
      toolId: ctx.toolId,
      toolName: tool.definition.name,
      title: prepared.card.title,
      details: prepared.card.details,
      expiresAt: pending.expiresAt.toISOString(),
    });
    const heartbeat = setInterval(() => ctx.emit({ type: 'heartbeat' }), APPROVAL_HEARTBEAT_MS);
    let decided: ApprovalOutcome;
    try {
      decided = await pending.decision;
    } finally {
      clearInterval(heartbeat);
    }
    const decision = decided.resolution;
    ctx.emit({ type: 'approval_resolved', approvalId: pending.id, decision });
    if (decision !== 'ALLOW' || !decided.decidedBy) {
      // 사용자가 싫다고 했거나 자리를 비웠다: 다시 제안해 스트림을 더 붙잡지 않게 다음 차례는 도구 없이 답하게 한다
      const outcome = decision === 'TIMEOUT' ? '10분 안에 허용하지 않아 실행하지 않았어요' : '사용자가 거부해 실행하지 않았어요';
      return { content: json({ 결과: outcome, 안내: '실행하지 않았다고 짧게 알려요' }), stop: true };
    }

    // 실행은 허용을 보낸 순간의 사원 정보로 한다(같은 사원, 권한은 그때 DB에서 다시 읽은 값)
    const actor = decided.decidedBy;
    const executed = await runWithTransientRetry(() => prepared.execute(actor, pending.id), { idempotent: true });
    if (executed.ok) {
      const { message, result } = executed.value;
      ctx.emit({ type: 'tool_execution', approvalId: pending.id, status: 'SUCCESS', message, result, attempts: executed.attempts });
      return { content: json({ 결과: '실행했어요', 내용: message, 화면: result.linkPath }), stop: false };
    }
    const reason = this.failureReason(call.name, executed.error, executed.attempts);
    ctx.emit({ type: 'tool_execution', approvalId: pending.id, status: 'FAILED', message: reason, result: null, attempts: executed.attempts });
    return {
      content: json({ 오류: '실행 실패', 이유: reason, 안내: '실행하지 못했다고 이유와 함께 알려요. 내용을 바꿔야 하면 바꾼 내용으로 새로 제안해요(새 승인 카드)' }),
      stop: false,
    };
  }

  /** 모델이 고칠 수 있는 실패: 고칠 기회가 남았으면 이유를 돌려주고, 다 썼으면 멈춘다 */
  private fixable(ctx: WriteCallContext, reason: string): WriteCallOutcome {
    const remaining = ctx.budget.fail(ctx.call.name, ctx.call.arguments);
    if (remaining === 0) {
      return { content: json({ 오류: reason, 안내: '여러 번 고쳐도 맞지 않아 이번에는 실행하지 않아요. 무엇이 맞지 않았는지 사용자에게 짧게 알려요' }), stop: true };
    }
    return { content: json({ 오류: reason, 안내: `인자를 고쳐 다시 불러요(남은 기회 ${remaining}번). 사용자에게 물어야 알 수 있는 값이면 지어내지 말고 물어요` }), stop: false };
  }

  /** 모델이 고칠 수 없는 실패(권한 없음·승인권자 없음·상태 충돌): 바로 멈추고 이유와 담당 역할을 알린다 */
  private async unfixable(user: AuthUser, tool: AssistantWriteTool, error: AppException): Promise<WriteCallOutcome> {
    if (error.code !== 'COM-002') {
      return { content: json({ 오류: messageOf(error), 안내: '고칠 수 없는 이유라 실행하지 않아요. 이유를 사용자에게 알려요' }), stop: true };
    }
    const roles = await this.repository.findRoleCodesWithAnyPermission(this.prisma, tool.permissions, 'USE');
    const names = tool.permissions.map((permission) => `'${PERMISSION_LABEL[permission]}'`).join(' 또는 ');
    return {
      content: json({
        오류: '권한 없음',
        안내: `${messageOf(error)}. ${names ? `이 일은 ${names} 사용 권한이 필요하고, ` : ''}사용자 역할(${ROLE_LABEL[user.roleCode]})로는 할 수 없어요. 실행하지 않았다고 알리고 할 수 있는 역할을 안내해요`,
        '할 수 있는 역할': roles.map((role) => ROLE_LABEL[role]),
      }),
      stop: true,
    };
  }

  private failureReason(name: string, error: unknown, attempts: number): string {
    if (error instanceof AppException) return messageOf(error);
    this.logger.error(`철강맨AI 쓰기 도구 실행 실패 (${name}, ${attempts}번 시도)`, error instanceof Error ? error.stack : String(error));
    return attempts > 1 ? `일시적인 서버 오류로 ${attempts}번 시도했지만 실행하지 못했어요` : '서버 오류로 실행하지 못했어요';
  }
}

function messageOf(error: AppException): string {
  const response = error.getResponse();
  return typeof response === 'object' && response !== null && 'message' in response ? String(response.message) : error.message;
}
