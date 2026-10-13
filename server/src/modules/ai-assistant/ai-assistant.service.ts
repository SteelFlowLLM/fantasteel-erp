import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ROLE_LABEL,
  type AiAssistantMessageInput,
  type AiAssistantReplyView,
  type AiAssistantSource,
  type AiAssistantSuggestedQuestionsView,
  type AuthUser,
} from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { seoulToday } from '../../common/time/seoul-date';
import { LlmClient, LlmRequestError, type LlmEndpoint, type LlmToolDefinition, type LlmToolMessage, type LlmToolReply } from '../llm/llm.client';
import { LlmSettingsStore } from '../llm/llm-settings.store';
import { parseAssistantAnswer } from './assistant.answer';
import { buildAssistantMessages, recentHistory } from './assistant.prompt';
import { searchGlossary } from './knowledge/glossary.search';
import { FIRST_TIME_QUESTIONS, ROLE_SUGGESTED_QUESTIONS } from './suggested-questions';
import { AssistantToolbox } from './tools/assistant-toolbox';

const MODEL_NOT_SET = 'AI 모델이 아직 정해지지 않았어요. 관리자에게 LLM 연결 설정을 요청해 주세요';

/** 한 질문에서 도구를 부르는 횟수 상한. 넘으면 도구 없이 지금까지의 결과로 답하게 한다 (모델이 같은 조회를 되풀이하는 것을 막음) */
export const MAX_TOOL_ROUNDS = 4;

/**
 * AI 어시스턴트 (BP-AST-01). 업무 지식(용어 사전, REQ-AST-003)과 데이터 조회(REQ-AST-004)를 답한다.
 * 데이터는 모델이 고른 조회 도구를 서버가 사용자 권한으로 실행해 얻는다. AI는 조회·설명만 하고 업무 데이터를 바꾸지 않으므로
 * 작업 로그도 남기지 않는다(REQ-LOG-002 대상 아님). LLM은 LLM 연결 설정(llm 모듈)에 저장된 주소·모델을 쓴다.
 */
@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name);

  constructor(
    private readonly settingsStore: LlmSettingsStore,
    private readonly llm: LlmClient,
    private readonly toolbox: AssistantToolbox,
  ) {}

  suggestedQuestions(user: AuthUser): AiAssistantSuggestedQuestionsView {
    return {
      roleCode: user.roleCode,
      roleQuestions: [...ROLE_SUGGESTED_QUESTIONS[user.roleCode]],
      firstTimeQuestions: [...FIRST_TIME_QUESTIONS],
    };
  }

  async ask(user: AuthUser, input: AiAssistantMessageInput): Promise<AiAssistantReplyView> {
    const settings = await this.settingsStore.read();
    if (!settings.model) throw new AppException('COM-999', MODEL_NOT_SET, HttpStatus.SERVICE_UNAVAILABLE);
    const model = settings.model;

    const history = recentHistory(input.history ?? []);
    const references = this.referencesFor(input.question, history);
    const messages: LlmToolMessage[] = buildAssistantMessages({
      employeeName: user.employeeName,
      roleLabel: ROLE_LABEL[user.roleCode],
      today: seoulToday(),
      screen: input.screen ?? null,
      references,
      history,
      question: input.question,
    });

    const started = Date.now();
    const dataSources: AiAssistantSource[] = [];
    const tools = this.toolbox.definitions();
    let reply = await this.call(settings, model, messages, tools);
    for (let round = 1; reply.toolCalls.length && round <= MAX_TOOL_ROUNDS; round += 1) {
      messages.push({ role: 'assistant', content: reply.content || null, toolCalls: reply.toolCalls });
      for (const call of reply.toolCalls) {
        const result = await this.toolbox.run(user, call);
        messages.push({ role: 'tool', toolCallId: call.id, content: result.content });
        if (result.source && !dataSources.some((s) => s.label === result.source?.label)) dataSources.push(result.source);
      }
      reply = await this.call(settings, model, messages, round < MAX_TOOL_ROUNDS ? tools : []);
    }

    const parsed = parseAssistantAnswer(reply.content, references);
    return { answer: parsed.answer, sources: [...dataSources, ...parsed.sources], model, latencyMs: Date.now() - started };
  }

  private async call(endpoint: LlmEndpoint, model: string, messages: LlmToolMessage[], tools: LlmToolDefinition[]): Promise<LlmToolReply> {
    try {
      return await this.llm.chatWithTools(endpoint, model, messages, tools);
    } catch (error) {
      if (!(error instanceof LlmRequestError)) throw error;
      this.logger.warn(`AI 어시스턴트 LLM 호출 실패: ${error.message}`);
      throw new AppException('COM-999', error.message, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  /** "그건 언제 풀려?"처럼 용어 없이 이어 묻는 질문은 바로 앞 질문의 용어를 쓴다 */
  private referencesFor(question: string, history: readonly { role: string; content: string }[]) {
    const found = searchGlossary(question);
    if (found.length) return found;
    const previousQuestion = [...history].reverse().find((turn) => turn.role === 'user');
    return previousQuestion ? searchGlossary(previousQuestion.content) : [];
  }
}
