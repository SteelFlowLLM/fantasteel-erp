import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ROLE_LABEL,
  type AiActionCard,
  type AiActionCardExecuteResult,
  type AiAssistantMessageInput,
  type AiAssistantReplyView,
  type AiAssistantSource,
  type AiAssistantSuggestedQuestionsView,
  type AiAssistantToolTrace,
  type AuthUser,
} from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { seoulToday } from '../../common/time/seoul-date';
import { LlmClient, LlmRequestError, splitThinking, type LlmEndpoint, type LlmToolDefinition, type LlmToolMessage, type LlmToolReply } from '../llm/llm.client';
import { LlmSettingsStore } from '../llm/llm-settings.store';
import { MeetingMinutesService } from '../meeting-minutes/meeting-minutes.service';
import { actionCardExamplesFor } from './action-card-examples';
import { AiActionCardService } from './ai-action-card.service';
import { ACTION_CARD_TOOLS } from './tools/action-card.tool';
import { AiOpsCardService } from './ai-ops-card.service';
import { buildMeetingContext } from './assistant-meeting.context';
import type { ExecuteAiActionCardDto } from './dto/ai-assistant.dto';
import { parseAssistantAnswer } from './assistant.answer';
import { buildAssistantMessages, recentHistory } from './assistant.prompt';
import { searchGlossary } from './knowledge/glossary.search';
import { findManualGuides } from './knowledge/manual.search';
import { findProcessSteps } from './knowledge/process.search';
import { FIRST_TIME_QUESTIONS, ROLE_SUGGESTED_QUESTIONS } from './suggested-questions';
import { AssistantToolbox } from './tools/assistant-toolbox';

const MODEL_NOT_SET = 'AI 모델이 아직 정해지지 않았어요. 관리자에게 LLM 연결 설정을 요청해 주세요';

/** 한 질문에서 도구를 부르는 횟수 상한. 넘으면 도구 없이 지금까지의 결과로 답하게 한다 (모델이 같은 조회를 되풀이하는 것을 막음) */
export const MAX_TOOL_ROUNDS = 4;
/** AI 실행 기록에 담는 도구 입력·결과·생각 글의 길이. 답과 함께 화면에만 가므로 읽을 만큼만 */
const TRACE_ARGUMENTS_MAX = 500;
const TRACE_RESULT_MAX = 600;
const TRACE_THINKING_MAX = 8000;
/** 한 답에 담는 실행 카드 수 상한. 카드가 늘면 사용자가 하나하나 확인하기 어렵다 (가정값) */
export const MAX_ACTION_CARDS = 5;
/** 회의록 후보와 같은 규칙으로 실행하는 카드 종류 */
const WORK_KINDS: readonly string[] = ['TASK', 'EVENT', 'PURCHASE'];

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
    private readonly cards: AiActionCardService,
    private readonly opsCards: AiOpsCardService,
  ) {}

  /** 사용자가 실행 카드의 [실행]을 눌렀을 때 (REQ-AST-005). 값은 카드에서 사용자가 확인·수정한 것이고 서버가 다시 검증한다 */
  executeActionCard(user: AuthUser, dto: ExecuteAiActionCardDto): Promise<AiActionCardExecuteResult> {
    // 업무·일정·구매요청은 회의록 등록과 같은 규칙, 나머지는 각 모듈의 확정 기능을 그대로 부른다
    return WORK_KINDS.includes(dto.kind) ? this.cards.execute(user, dto) : this.opsCards.execute(user, dto);
  }

  suggestedQuestions(user: AuthUser): AiAssistantSuggestedQuestionsView {
    return {
      roleCode: user.roleCode,
      roleQuestions: [...ROLE_SUGGESTED_QUESTIONS[user.roleCode]],
      firstTimeQuestions: [...FIRST_TIME_QUESTIONS],
      actionCardExamples: actionCardExamplesFor(user),
    };
  }

  /** 조회 도구가 보여 준 데이터를 이 사용자가 볼 수 있는지 (사내 채팅 @AI 답을 멤버마다 보일지 정할 때) */
  canViewData(user: AuthUser, toolNames: readonly string[]): boolean {
    return this.toolbox.canViewAll(user, toolNames);
  }

  async ask(user: AuthUser, input: AiAssistantMessageInput): Promise<AiAssistantReplyView> {
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
      actionCards: input.actionCards === true,
      history,
      question: input.question,
    });

    const started = Date.now();
    const dataSources: AiAssistantSource[] = [];
    const toolCalls: AiAssistantToolTrace[] = [];
    const actionCards: AiActionCard[] = [];
    const tools = this.toolbox.definitions({ actionCards: input.actionCards });
    let reply = await this.call(settings, model, messages, tools);
    // 작은 모델은 카드 도구를 부르지 않고 "카드를 만들었어요"라고만 말하기도 한다. 한 번만 도구를 부르게 다시 시킨다
    if (input.actionCards && reply.toolCalls.length === 0 && claimsCardMade(reply.content)) {
      messages.push({ role: 'assistant', content: reply.content }, { role: 'user', content: CARD_TOOL_NUDGE });
      reply = await this.call(settings, model, messages, tools.filter((tool) => ACTION_CARD_TOOLS.includes(tool.name)));
    }
    for (let round = 1; reply.toolCalls.length && round <= MAX_TOOL_ROUNDS; round += 1) {
      messages.push({ role: 'assistant', content: reply.content || null, toolCalls: reply.toolCalls });
      for (const call of reply.toolCalls) {
        const callStarted = Date.now();
        const result = await this.toolbox.run(user, call);
        toolCalls.push({ name: call.name, arguments: cut(call.arguments, TRACE_ARGUMENTS_MAX), resultPreview: cut(result.content, TRACE_RESULT_MAX), durationMs: Date.now() - callStarted });
        messages.push({ role: 'tool', toolCallId: call.id, content: result.content });
        if (result.source && !dataSources.some((s) => s.id === result.source?.id)) dataSources.push(result.source);
        // 카드를 보여 줄 수 없는 화면에는 모델이 도구를 불러도 카드를 담지 않는다
        for (const card of input.actionCards ? (result.cards ?? []) : []) {
          if (actionCards.length < MAX_ACTION_CARDS) actionCards.push({ key: `a${actionCards.length + 1}`, ...card });
        }
      }
      reply = await this.call(settings, model, messages, round < MAX_TOOL_ROUNDS ? tools : []);
    }

    const parsed = parseAssistantAnswer(reply.content, references, processSteps, manualGuides);
    // 카드가 없는데 만들었다고 말하면 사용자가 없는 카드를 기다리므로, 만들지 못했다고 바로잡는다
    if (input.actionCards && actionCards.length === 0 && claimsCardMade(parsed.answer)) parsed.answer = CARD_NOT_MADE;
    const thinking = reply.reasoning ?? splitThinking(reply.content).thinking;
    return { answer: parsed.answer, sources: [...dataSources, ...parsed.sources], model, latencyMs: Date.now() - started, toolCalls, thinking: thinking ? cut(thinking, TRACE_THINKING_MAX) : null, actionCards };
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

/** 답이 "카드를 만들었다"고 말하는지 */
export const claimsCardMade = (text: string): boolean => /카드(를|가)?\s*(만들었|만들어\s*(두|드렸|놓)|만들어졌|준비했|생성했)/.test(text);

const CARD_TOOL_NUDGE = '방금 답은 카드를 만들었다고 했지만 도구를 부르지 않았어요. 카드는 propose_ 도구를 불러야 화면에 생겨요. 요청에 맞는 propose_ 도구를 지금 불러요. 카드로 만들 수 없는 요청이면 카드를 만들었다고 하지 말고 이유를 말해요.';
const CARD_NOT_MADE = '카드를 만들지 못했어요. 요청을 조금 더 구체적으로 다시 말해 주세요. 업무·일정·구매요청·수주 등록, 열연 배정, 히트 편성 확정, 과거 사례 등록을 카드로 만들 수 있어요.';

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
