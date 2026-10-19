import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  AI_RESEARCH_STATUS,
  ROLE_LABEL,
  type AiActionCard,
  type AiActionCardExecuteResult,
  type AiAssistantMessageInput,
  type AiAssistantCapabilitiesView,
  type AiAssistantReplyView,
  type AiAssistantStreamEvent,
  type AiAssistantSource,
  type AiAssistantSuggestedQuestionsView,
  type AiAssistantToolTrace,
  type AiChatThreadRef,
  type AiWebSource,
  type AiScreenActionResultInput,
  type AuthUser,
} from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { seoulToday } from '../../common/time/seoul-date';
import { LlmAbortedError, LlmClient, LlmRequestError, splitThinking, type LlmEndpoint, type LlmToolDefinition, type LlmToolMessage, type LlmToolReply } from '../llm/llm.client';
import { LlmSettingsStore } from '../llm/llm-settings.store';
import { assistantProfile } from '../llm/llm-profiles';
import { MeetingMinutesService } from '../meeting-minutes/meeting-minutes.service';
import { actionCardExamplesFor } from './action-card-examples';
import { AiActionCardService } from './ai-action-card.service';
import { ACTION_CARD_TOOLS } from './tools/action-card.tool';
import { READ_KNOWLEDGE_TOOL } from './tools/knowledge.tool';
import { AiOpsCardService } from './ai-ops-card.service';
import { buildMeetingContext } from './assistant-meeting.context';
import { buildResearchContext, citedResearchSources, type ResearchContext } from './assistant-research.context';
import { PrismaService } from '../../prisma/prisma.service';
import type { ExecuteAiActionCardDto } from './dto/ai-assistant.dto';
import { parseAssistantAnswer } from './assistant.answer';
import { buildAssistantMessages, recentHistory } from './assistant.prompt';
import { searchGlossary } from './knowledge/glossary.search';
import { KnowledgeReads } from './knowledge/knowledge.reads';
import { findManualGuides } from './knowledge/manual.search';
import { findProcessSteps } from './knowledge/process.search';
import { FIRST_TIME_QUESTIONS, ROLE_SUGGESTED_QUESTIONS } from './suggested-questions';
import { AssistantToolbox, type ToolRunResult } from './tools/assistant-toolbox';
import { AssistantWebToolbox } from './web/assistant-web-toolbox';
import { AssistantBrowserToolbox, type BrowserToolSessionLike } from './browser/assistant-browser-toolbox';
import { AssistantScreenToolbox, type ScreenControlSession } from './screen/assistant-screen-toolbox';
import { AiChatThreadService } from './chat/ai-chat-thread.service';

/** 답을 만드는 과정의 이벤트를 받는 쪽 (스트리밍 API). 없으면 한 번에 답만 돌려준다 */
export type AssistantEmit = (event: Exclude<AiAssistantStreamEvent, { type: 'done' | 'error' }>) => void;

export interface PreparedAsk {
  run(emit?: AssistantEmit, signal?: AbortSignal): Promise<AiAssistantReplyView>;
  /** 저장을 요청한 질문(이슈 #399)이면 답을 저장한다. 저장하지 못하면 null (답은 그대로 보낸다) */
  saveThread?(reply: AiAssistantReplyView): Promise<AiChatThreadRef | null>;
}

export interface PrepareOptions {
  /** 화면이 답을 실시간으로 보고 있는지 (스트리밍 API). 아니면 웹 도구를 알리지 않는다 (이슈 #367) */
  interactive?: boolean;
}

const NO_VISION = '지금 모델은 사진을 볼 수 없어요. 사진을 빼고 물어보거나, 관리자에게 사진을 보는 모델을 요청해 주세요';

const MODEL_NOT_SET = 'AI 모델이 아직 정해지지 않았어요. 관리자에게 LLM 연결 설정을 요청해 주세요';

/** 한 질문에서 도구를 부르는 횟수 상한. 넘으면 도구 없이 지금까지의 결과로 답하게 한다 (모델이 같은 조회를 되풀이하는 것을 막음) */
export const MAX_TOOL_ROUNDS = 4;
/** 웹 검색을 켠 질문의 도구 횟수 상한. 검색 → 읽기 → (다른 결과 읽기·다시 검색) → 답에 4번은 빠듯해서 늘린다 (이슈 #367) */
export const MAX_WEB_TOOL_ROUNDS = 6;
/** 브라우저 사용을 켠 질문의 도구 횟수 상한. 열기 → 읽기 → 입력 → 누르기 …가 이어져서 늘린다 (이슈 #373 결정값) */
export const MAX_BROWSER_TOOL_ROUNDS = 12;
/** 화면 조작을 켠 질문의 도구 횟수 상한. 읽기 → 열기 → 채우기 …가 이어진다 (이슈 #382, 화면 동작 12번과 맞춤) */
export const MAX_SCREEN_TOOL_ROUNDS = 12;
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
 * 작업 로그도 남기지 않는다(REQ-LOG-002 대상 아님). 웹 도구(웹 검색·페이지 읽기·장소 검색)는 웹 검색을 켠
 * 실시간 답에서만 알린다(이슈 #367). 브라우저 도구는 브라우저 사용을 켠 실시간 답에서만(이슈 #373). LLM은 LLM 연결 설정(llm 모듈)에 저장된 주소·모델을 쓴다.
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
    private readonly webTools: AssistantWebToolbox,
    private readonly browserTools: AssistantBrowserToolbox,
    private readonly screenTools: AssistantScreenToolbox,
    private readonly prisma: PrismaService,
    private readonly chatThreads: AiChatThreadService,
  ) {}

  /** 화면 조작 결과 (이슈 #382). 묻는 사원 본인의 기다리는 자리만, 처음 온 결과만 받는다 */
  settleUiAction(user: AuthUser, actionId: string, result: AiScreenActionResultInput): void {
    if (!this.screenTools.broker.settle(user.employeeId, actionId, result)) throw new AppException('COM-003', '기다리는 화면 조작이 없어요');
  }

  /** 사용자가 실행 카드의 [실행]을 눌렀을 때 (REQ-AST-005). 값은 카드에서 사용자가 확인·수정한 것이고 서버가 다시 검증한다 */
  async executeActionCard(user: AuthUser, dto: ExecuteAiActionCardDto): Promise<AiActionCardExecuteResult> {
    // 업무·일정·구매요청은 회의록 등록과 같은 규칙, 나머지는 각 모듈의 확정 기능을 그대로 부른다
    const result = WORK_KINDS.includes(dto.kind) ? await this.cards.execute(user, dto) : await this.opsCards.execute(user, dto);
    // 저장한 대화의 카드면 실행됨으로 남긴다 (이슈 #399). 업무는 이미 만들었으므로 이것이 실패해도 실행은 성공으로 돌려준다
    if (dto.chat) {
      await this.chatThreads.markCardDone(user, dto.chat, result.registered).catch((error: unknown) => {
        this.logger.warn(`실행한 카드를 대화에 남기지 못함 (답 ${dto.chat?.messageId}): ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    return result;
  }

  suggestedQuestions(user: AuthUser): AiAssistantSuggestedQuestionsView {
    return {
      roleCode: user.roleCode,
      roleQuestions: [...ROLE_SUGGESTED_QUESTIONS[user.roleCode]],
      firstTimeQuestions: [...FIRST_TIME_QUESTIONS],
      actionCardExamples: actionCardExamplesFor(user),
    };
  }

  /** 지금 설정된 모델이 사진·생각 정도를 지원하는지, 웹 검색으로 무엇을 쓸 수 있는지 (화면이 버튼을 켜고 끈다) */
  async capabilities(): Promise<AiAssistantCapabilitiesView> {
    const settings = await this.settingsStore.read();
    const webSearch = this.webTools.capabilities();
    const browser = this.browserTools.capabilities();
    const screenControl = this.screenTools.capabilities();
    if (!settings.model) return { model: null, vision: null, reasoning: null, webSearch, browser, deepResearch: { available: false }, screenControl };
    const caps = await this.llm.modelCapabilities({ baseUrl: settings.baseUrl, apiKey: settings.apiKey }, settings.model);
    return { model: settings.model, ...caps, webSearch, browser, deepResearch: { available: true }, screenControl };
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
  async prepare(user: AuthUser, input: AiAssistantMessageInput, options: PrepareOptions = {}): Promise<PreparedAsk> {
    const settings = await this.settingsStore.read();
    if (!settings.model) throw new AppException('COM-999', MODEL_NOT_SET, HttpStatus.SERVICE_UNAVAILABLE);
    const model = settings.model;

    // 없는 회의록이면 VOC-001(404). 회의록은 전 역할이 볼 수 있어 따로 권한을 보지 않는다
    const meetingContext = input.meetingMinutesId === undefined ? null : buildMeetingContext(await this.meetingMinutes.get(input.meetingMinutesId));
    // 심층 조사 보고서에 대한 질문 (이슈 #384): 내 완료한 조사만. 남의 조사는 없는 것처럼 RES-001
    const research = input.researchRunId === undefined ? null : await this.researchContext(user, input.researchRunId);
    // 저장하는 대화(이슈 #399, 실시간 답만)는 지난 대화를 화면이 보낸 것 대신 DB에서 읽는다. 내 대화가 아니면 AST-001. 새 대화는 지난 대화가 없다
    const saving = options.interactive === true && (input.saveThread === true || input.threadId !== undefined);
    const history = recentHistory(saving ? (input.threadId === undefined ? [] : await this.chatThreads.historyFor(user, input.threadId)) : (input.history ?? []));
    const references = this.referencesFor(input.question, history);
    const processSteps = findProcessSteps(input.question);
    const manualGuides = findManualGuides(input.question);
    // 웹 도구는 화면이 실시간으로 보고 있는 답에서만 (사내 채팅 @AI는 웹 내용을 방 멤버 모두에게 보이게 되므로 쓰지 않는다)
    const webSearch = options.interactive === true && input.webSearch === true;
    // 브라우저도 화면이 실시간으로 볼 때만, 서버 설정(AI_BROWSER_ENABLED)과 Chrome이 있을 때만 (이슈 #373)
    const browserOn = options.interactive === true && input.browser === true && this.browserTools.capabilities().available;
    // 화면 조작도 화면이 실시간으로 볼 때만, 서버 설정(AI_SCREEN_CONTROL_ENABLED)이 켜졌을 때만. 동작은 그 화면이 한다 (이슈 #382)
    const screenOn = options.interactive === true && input.screenControl === true && this.screenTools.capabilities().available;
    const screens = screenOn ? (input.screenMap ?? []) : [];
    const messages: LlmToolMessage[] = buildAssistantMessages({
      employeeName: user.employeeName,
      roleLabel: ROLE_LABEL[user.roleCode],
      today: seoulToday(),
      screen: input.screen ?? null,
      meetingContext,
      researchContext: research?.text ?? null,
      references,
      processSteps,
      manualGuides,
      actionCards: input.actionCards === true,
      history,
      question: input.question,
      webTools: webSearch ? { places: this.webTools.placeSearchEnabled } : null,
      browserTools: browserOn,
      screenControl: screenOn ? { screens } : null,
    });
    const profile = assistantProfile(input.reasoning);
    const endpoint: LlmEndpoint = { baseUrl: settings.baseUrl, apiKey: settings.apiKey };
    if (input.images?.length) {
      // 사진을 못 보는 모델은 사진을 무시하고 답을 지어내므로 보내기 전에 막는다. 모르면(외부 LLM) 보낸다
      if ((await this.llm.modelCapabilities(endpoint, model)).vision === false) throw new AppException('COM-004', NO_VISION, HttpStatus.BAD_REQUEST);
      const question = messages.length - 1;
      messages[question] = { role: 'user', content: input.question, images: input.images };
    }

    const saveThread = async (reply: AiAssistantReplyView): Promise<AiChatThreadRef | null> => {
      try {
        return await this.chatThreads.saveTurn(
          user,
          input.threadId,
          { question: input.question, reasoning: input.reasoning, webSearch: input.webSearch, browser: input.browser, imageCount: input.images?.length },
          reply,
        );
      } catch (error) {
        this.logger.warn(`대화를 저장하지 못함: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    };

    return {
      ...(saving ? { saveThread } : {}),
      run: async (emit, signal) => {
        const started = Date.now();
        const dataSources: AiAssistantSource[] = [];
        const toolCalls: AiAssistantToolTrace[] = [];
        const actionCards: AiActionCard[] = [];
        // read_knowledge로 읽은 항목은 이 답의 출처로 인정한다 (REQ-AST-003)
        const readKnowledge = new KnowledgeReads();
        // 답마다 새 세션: 이 답의 검색 결과 주소만 읽고, 답의 링크도 그 주소만 남긴다.
        // 브라우저만 켰으면 웹 도구는 알리지 않고 주소 허용 목록·링크 거르기·회사 안 정보 막기만 쓴다
        const streaming = emit !== undefined;
        const web = (webSearch || browserOn) && streaming ? this.webTools.session(user.employeeId, { offerTools: webSearch }) : null;
        // 브라우저는 답마다 새 시크릿 컨텍스트(첫 브라우저 도구 때 연다). 끝·멈춤·오류 때 닫는다
        const browser: BrowserToolSessionLike | null = browserOn && web ? this.browserTools.session({ question: input.question, web, signal }) : null;
        // 화면 조작: 동작은 ui_action 이벤트로 그 화면에 보내고 결과를 기다린다 (이슈 #382)
        const screen: ScreenControlSession | null = screenOn && emit ? this.screenTools.session({ owner: user.employeeId, screens, emit, signal }) : null;
        const tools = [
          ...this.toolbox.definitions({ actionCards: input.actionCards }),
          ...(webSearch && web ? this.webTools.definitions() : []),
          ...(browser ? this.browserTools.definitions() : []),
          ...(screen ? this.screenTools.definitions() : []),
        ];
        const maxRounds = browser ? MAX_BROWSER_TOOL_ROUNDS : screen ? MAX_SCREEN_TOOL_ROUNDS : webSearch && web ? MAX_WEB_TOOL_ROUNDS : MAX_TOOL_ROUNDS;
        try {
          const call = (roundTools: LlmToolDefinition[]): Promise<LlmToolReply> =>
            emit
              ? this.llm.streamWithTools(endpoint, model, messages, roundTools, profile, { onThinking: (text) => emit({ type: 'thinking', text }), onAnswer: (text) => emit({ type: 'answer', text }) }, signal)
              : this.llm.chatWithTools(endpoint, model, messages, roundTools, profile);
          let reply = await call(tools);
          // 작은 모델은 카드 도구를 부르지 않고 "카드를 만들었어요"라고만 말하기도 한다. 한 번만 도구를 부르게 다시 시킨다
          if (input.actionCards && reply.toolCalls.length === 0 && claimsCardMade(reply.content)) {
            messages.push({ role: 'assistant', content: reply.content }, { role: 'user', content: CARD_TOOL_NUDGE });
            reply = await call(tools.filter((tool) => ACTION_CARD_TOOLS.includes(tool.name)));
          }
          for (let round = 1; reply.toolCalls.length && round <= maxRounds; round += 1) {
            messages.push({ role: 'assistant', content: reply.content || null, toolCalls: reply.toolCalls });
            for (const toolCall of reply.toolCalls) {
              if (signal?.aborted) throw new LlmAbortedError();
              const callStarted = Date.now();
              const traceId = `t${toolCalls.length + 1}`;
              emit?.({ type: 'tool_start', id: traceId, name: toolCall.name, arguments: cut(toolCall.arguments, TRACE_ARGUMENTS_MAX) });
              // 조회·실행 카드·웹 도구는 읽기만 해서 묻지 않고 바로 실행한다. 브라우저 도구도 묻지 않지만 위험한 동작은 서버가 막는다(이슈 #373)
              let webSources: AiWebSource[] | undefined;
              let result: ToolRunResult;
              if (web?.has(toolCall.name)) {
                const webResult = await web.run(toolCall, signal);
                result = { content: webResult.content, source: null };
                webSources = webResult.webSources;
              } else if (browser?.has(toolCall.name)) {
                const browserResult = await browser.run(toolCall, signal);
                result = { content: browserResult.content, source: null };
                webSources = browserResult.webSources;
                // 화면 사진은 화면에만 보낸다(모델에는 글만)
                if (browserResult.frame) emit?.({ type: 'browser_frame', ...browserResult.frame });
              } else if (screen?.has(toolCall.name)) {
                result = { content: await screen.run(toolCall), source: null };
              } else {
                result = await this.toolbox.run(user, toolCall);
                if (toolCall.name === READ_KNOWLEDGE_TOOL) readKnowledge.add(toolCall.arguments);
                // ERP 조회 결과의 거래처 이름은 이번 답의 웹 검색어로 내보내지 않는다
                web?.observeErpResult(result.content);
              }
              const trace = { name: toolCall.name, arguments: cut(toolCall.arguments, TRACE_ARGUMENTS_MAX), resultPreview: cut(result.content, TRACE_RESULT_MAX), durationMs: Date.now() - callStarted };
              toolCalls.push(trace);
              emit?.({ type: 'tool_end', id: traceId, label: result.source?.label ?? null, resultPreview: trace.resultPreview, durationMs: trace.durationMs, ...(webSources ? { webSources } : {}) });
              messages.push({ role: 'tool', toolCallId: toolCall.id, content: result.content });
              if (result.source && !dataSources.some((s) => s.id === result.source?.id)) dataSources.push(result.source);
              // 카드를 보여 줄 수 없는 화면에는 모델이 도구를 불러도 카드를 담지 않는다
              for (const card of input.actionCards ? (result.cards ?? []) : []) {
                if (actionCards.length < MAX_ACTION_CARDS) actionCards.push({ key: `a${actionCards.length + 1}`, ...card });
              }
            }
            if (signal?.aborted) throw new LlmAbortedError();
            reply = await call(round < maxRounds ? tools : []);
          }

          const parsed = parseAssistantAnswer(reply.content, [...references, ...readKnowledge.terms], [...processSteps, ...readKnowledge.steps], [...manualGuides, ...readKnowledge.guides]);
          // 카드가 없는데 만들었다고 말하면 사용자가 없는 카드를 기다리므로, 만들지 못했다고 바로잡는다
          if (input.actionCards && actionCards.length === 0 && claimsCardMade(parsed.answer)) parsed.answer = CARD_NOT_MADE;
          const thinking = reply.reasoning ?? splitThinking(reply.content).thinking;
          const webFinal = web?.finalize(parsed.answer) ?? null;
          const finalAnswer = webFinal?.answer ?? parsed.answer;
          // 조사 보고서의 출처를 [n]으로 쓴 답은 그 출처를 웹 출처로 함께 돌려준다
          const researchSources = research ? citedResearchSources(finalAnswer, research).filter((s) => !webFinal?.webSources.some((w) => w.url === s.url)) : [];
          const webSources = webFinal || researchSources.length ? [...(webFinal?.webSources ?? []), ...researchSources] : null;
          return {
            answer: finalAnswer,
            sources: [...dataSources, ...parsed.sources],
            model,
            latencyMs: Date.now() - started,
            toolCalls,
            thinking: thinking ? cut(thinking, TRACE_THINKING_MAX) : null,
            reasoningApplied: reply.reasoningApplied ?? true,
            actionCards,
            ...(webSources ? { webSources } : {}),
          };
        } finally {
          await browser?.close();
        }
      },
    };
  }

  private async researchContext(user: AuthUser, id: number): Promise<ResearchContext> {
    const run = await this.prisma.aiResearchRun.findUnique({ where: { id }, select: { id: true, employeeId: true, question: true, plan: true, report: true, sources: true, status: true } });
    if (!run || run.employeeId !== user.employeeId) throw new AppException('RES-001');
    if (run.status !== AI_RESEARCH_STATUS.COMPLETED || !run.report) throw new AppException('RES-002', '보고서가 나온 조사에 대해서만 물어볼 수 있어요');
    return buildResearchContext(run);
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
