import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ROLE_LABEL, type AiAssistantMessageInput, type AiAssistantReplyView, type AiAssistantSuggestedQuestionsView, type AuthUser } from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { seoulToday } from '../../common/time/seoul-date';
import { LlmClient, LlmRequestError } from '../llm/llm.client';
import { LlmSettingsStore } from '../llm/llm-settings.store';
import { parseAssistantAnswer } from './assistant.answer';
import { buildAssistantMessages, recentHistory } from './assistant.prompt';
import { searchGlossary } from './knowledge/glossary.search';
import { FIRST_TIME_QUESTIONS, ROLE_SUGGESTED_QUESTIONS } from './suggested-questions';

const MODEL_NOT_SET = 'AI 모델이 아직 정해지지 않았어요. 관리자에게 LLM 연결 설정을 요청해 주세요';

/**
 * AI 어시스턴트 (BP-AST-01). 지금은 업무 지식(용어 사전, REQ-AST-003)만 답한다.
 * AI는 조회·설명만 하고 업무 데이터를 바꾸지 않으므로 DB를 쓰지 않고 작업 로그도 남기지 않는다(REQ-LOG-002 대상 아님).
 * LLM은 LLM 연결 설정(llm 모듈)에 저장된 주소·모델을 쓴다.
 */
@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name);

  constructor(
    private readonly settingsStore: LlmSettingsStore,
    private readonly llm: LlmClient,
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

    const history = recentHistory(input.history ?? []);
    const references = this.referencesFor(input.question, history);
    const messages = buildAssistantMessages({
      employeeName: user.employeeName,
      roleLabel: ROLE_LABEL[user.roleCode],
      today: seoulToday(),
      screen: input.screen ?? null,
      references,
      history,
      question: input.question,
    });

    const started = Date.now();
    let raw: string;
    try {
      raw = await this.llm.chat(settings, settings.model, messages);
    } catch (error) {
      if (!(error instanceof LlmRequestError)) throw error;
      this.logger.warn(`AI 어시스턴트 LLM 호출 실패: ${error.message}`);
      throw new AppException('COM-999', error.message, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { ...parseAssistantAnswer(raw, references), model: settings.model, latencyMs: Date.now() - started };
  }

  /** "그건 언제 풀려?"처럼 용어 없이 이어 묻는 질문은 바로 앞 질문의 용어를 쓴다 */
  private referencesFor(question: string, history: readonly { role: string; content: string }[]) {
    const found = searchGlossary(question);
    if (found.length) return found;
    const previousQuestion = [...history].reverse().find((turn) => turn.role === 'user');
    return previousQuestion ? searchGlossary(previousQuestion.content) : [];
  }
}
