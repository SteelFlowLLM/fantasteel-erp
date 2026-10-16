import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ROLE_LABEL,
  type AiAssistantMessageInput,
  type AiAssistantCapabilitiesView,
  type AiAssistantReplyView,
  type AiAssistantStreamEvent,
  type AiAssistantSource,
  type AiAssistantSuggestedQuestionsView,
  type AiAssistantToolTrace,
  type AuthUser,
} from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { seoulToday } from '../../common/time/seoul-date';
import { LlmAbortedError, LlmClient, LlmRequestError, splitThinking, type LlmEndpoint, type LlmToolDefinition, type LlmToolMessage, type LlmToolReply } from '../llm/llm.client';
import { LlmSettingsStore } from '../llm/llm-settings.store';
import { assistantProfile } from '../llm/llm-profiles';
import { MeetingMinutesService } from '../meeting-minutes/meeting-minutes.service';
import { buildMeetingContext } from './assistant-meeting.context';
import { parseAssistantAnswer } from './assistant.answer';
import { buildAssistantMessages, recentHistory } from './assistant.prompt';
import { searchGlossary } from './knowledge/glossary.search';
import { findManualGuides } from './knowledge/manual.search';
import { findProcessSteps } from './knowledge/process.search';
import { FIRST_TIME_QUESTIONS, ROLE_SUGGESTED_QUESTIONS } from './suggested-questions';
import { AssistantToolbox } from './tools/assistant-toolbox';

/** 답을 만드는 과정의 이벤트를 받는 쪽 (스트리밍 API). 없으면 한 번에 답만 돌려준다 */
export type AssistantEmit = (event: Exclude<AiAssistantStreamEvent, { type: 'done' | 'error' }>) => void;

export interface PreparedAsk {
  run(emit?: AssistantEmit, signal?: AbortSignal): Promise<AiAssistantReplyView>;
}

const NO_VISION = '지금 모델은 사진을 볼 수 없어요. 사진을 빼고 물어보거나, 관리자에게 사진을 보는 모델을 요청해 주세요';

const MODEL_NOT_SET = 'AI 모델이 아직 정해지지 않았어요. 관리자에게 LLM 연결 설정을 요청해 주세요';

/** 한 질문에서 도구를 부르는 횟수 상한. 넘으면 도구 없이 지금까지의 결과로 답하게 한다 (모델이 같은 조회를 되풀이하는 것을 막음) */
export const MAX_TOOL_ROUNDS = 4;
/** AI 실행 기록에 담는 도구 입력·결과·생각 글의 길이. 답과 함께 화면에만 가므로 읽을 만큼만 */
const TRACE_ARGUMENTS_MAX = 500;
const TRACE_RESULT_MAX = 600;
const TRACE_THINKING_MAX = 8000;

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
    private readonly meetingMinutes: MeetingMinutesService,
  ) {}

  suggestedQuestions(user: AuthUser): AiAssistantSuggestedQuestionsView {
    return {
      roleCode: user.roleCode,
      roleQuestions: [...ROLE_SUGGESTED_QUESTIONS[user.roleCode]],
      firstTimeQuestions: [...FIRST_TIME_QUESTIONS],
    };
  }

  /** 지금 설정된 모델이 사진·생각 정도를 지원하는지 (화면이 버튼을 켜고 끈다) */
  async capabilities(): Promise<AiAssistantCapabilitiesView> {
    const settings = await this.settingsStore.read();
    if (!settings.model) return { model: null, vision: null, reasoning: null };
    const caps = await this.llm.modelCapabilities({ baseUrl: settings.baseUrl, apiKey: settings.apiKey }, settings.model);
    return { model: settings.model, ...caps };
  }

  /** 조회 도구가 보여 준 데이터를 이 사용자가 볼 수 있는지 (사내 채팅 @AI 답을 멤버마다 보일지 정할 때) */
  canViewData(user: AuthUser, toolNames: readonly string[]): boolean {
    return this.toolbox.canViewAll(user, toolNames);
  }

  async ask(user: AuthUser, input: AiAssistantMessageInput): Promise<AiAssistantReplyView> {
    const prepared = await this.prepare(user, input);
    try {
      return await prepared.run();
    } catch (error) {
      if (!(error instanceof LlmRequestError)) throw error;
      this.logger.warn(`AI 어시스턴트 LLM 호출 실패: ${error.message}`);
      throw new AppException('COM-999', error.message, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  /**
   * 답을 만들기 전 확인(모델 설정·회의록)과 프롬프트 준비. 여기서 던지는 오류는 평소 API 오류로 나가고,
   * 스트리밍 API는 이것이 통과한 뒤에야 응답을 시작한다. run은 LLM 실패를 LlmRequestError로 던진다.
   */
  async prepare(user: AuthUser, input: AiAssistantMessageInput): Promise<PreparedAsk> {
    const settings = await this.settingsStore.read();
    if (!settings.model) throw new AppException('COM-999', MODEL_NOT_SET, HttpStatus.SERVICE_UNAVAILABLE);
    const model = settings.model;

    // 없는 회의록이면 VOC-001(404). 회의록은 전 역할이 볼 수 있어 따로 권한을 보지 않는다
    const meetingContext = input.meetingMinutesId === undefined ? null : buildMeetingContext(await this.meetingMinutes.get(input.meetingMinutesId));
    const history = recentHistory(input.history ?? []);
    const references = this.referencesFor(input.question, history);
    const processSteps = findProcessSteps(input.question);
    const manualGuides = findManualGuides(input.question);
    const messages: LlmToolMessage[] = buildAssistantMessages({
      employeeName: user.employeeName,
      roleLabel: ROLE_LABEL[user.roleCode],
      today: seoulToday(),
      screen: input.screen ?? null,
      meetingContext,
      references,
      processSteps,
      manualGuides,
      history,
      question: input.question,
    });
    const profile = assistantProfile(input.reasoning);
    const endpoint: LlmEndpoint = { baseUrl: settings.baseUrl, apiKey: settings.apiKey };
    if (input.images?.length) {
      // 사진을 못 보는 모델은 사진을 무시하고 답을 지어내므로 보내기 전에 막는다. 모르면(외부 LLM) 보낸다
      if ((await this.llm.modelCapabilities(endpoint, model)).vision === false) throw new AppException('COM-004', NO_VISION, HttpStatus.BAD_REQUEST);
      const question = messages.length - 1;
      messages[question] = { role: 'user', content: input.question, images: input.images };
    }

    return {
      run: async (emit, signal) => {
        const started = Date.now();
        const dataSources: AiAssistantSource[] = [];
        const toolCalls: AiAssistantToolTrace[] = [];
        const tools = this.toolbox.definitions();
        const call = (roundTools: LlmToolDefinition[]): Promise<LlmToolReply> =>
          emit
            ? this.llm.streamWithTools(endpoint, model, messages, roundTools, profile, { onThinking: (text) => emit({ type: 'thinking', text }), onAnswer: (text) => emit({ type: 'answer', text }) }, signal)
            : this.llm.chatWithTools(endpoint, model, messages, roundTools, profile);
        let reply = await call(tools);
        for (let round = 1; reply.toolCalls.length && round <= MAX_TOOL_ROUNDS; round += 1) {
          messages.push({ role: 'assistant', content: reply.content || null, toolCalls: reply.toolCalls });
          for (const toolCall of reply.toolCalls) {
            if (signal?.aborted) throw new LlmAbortedError();
            const callStarted = Date.now();
            const traceId = `t${toolCalls.length + 1}`;
            emit?.({ type: 'tool_start', id: traceId, name: toolCall.name, arguments: cut(toolCall.arguments, TRACE_ARGUMENTS_MAX) });
            const result = await this.toolbox.run(user, toolCall);
            const trace = { name: toolCall.name, arguments: cut(toolCall.arguments, TRACE_ARGUMENTS_MAX), resultPreview: cut(result.content, TRACE_RESULT_MAX), durationMs: Date.now() - callStarted };
            toolCalls.push(trace);
            emit?.({ type: 'tool_end', id: traceId, label: result.source?.label ?? null, resultPreview: trace.resultPreview, durationMs: trace.durationMs });
            messages.push({ role: 'tool', toolCallId: toolCall.id, content: result.content });
            if (result.source && !dataSources.some((s) => s.id === result.source?.id)) dataSources.push(result.source);
          }
          reply = await call(round < MAX_TOOL_ROUNDS ? tools : []);
        }

        const parsed = parseAssistantAnswer(reply.content, references, processSteps, manualGuides);
        const thinking = reply.reasoning ?? splitThinking(reply.content).thinking;
        return {
          answer: parsed.answer,
          sources: [...dataSources, ...parsed.sources],
          model,
          latencyMs: Date.now() - started,
          toolCalls,
          thinking: thinking ? cut(thinking, TRACE_THINKING_MAX) : null,
          reasoningApplied: reply.reasoningApplied ?? true,
        };
      },
    };
  }

  /** "그건 언제 풀려?"처럼 용어 없이 이어 묻는 질문은 바로 앞 질문의 용어를 쓴다 */
  private referencesFor(question: string, history: readonly { role: string; content: string }[]) {
    const found = searchGlossary(question);
    if (found.length) return found;
    const previousQuestion = [...history].reverse().find((turn) => turn.role === 'user');
    return previousQuestion ? searchGlossary(previousQuestion.content) : [];
  }
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
