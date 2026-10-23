// Message → ERP AI 추출 (모듈 문서 10장). LLM은 칸 값을 제안만 하고, 서버가 유형 정의(fromExtraction)로 다시 검증한다.
// 모델이 없거나 연결·형식이 실패해도 초안 만들기는 실패하지 않고 빈 칸으로 만든다.
import { Injectable, Logger } from '@nestjs/common';
import type { AiExtractionStatus } from '@fantasteel/shared';
import { seoulToday } from '../../common/time/seoul-date';
import { LlmClient, LlmRequestError } from '../llm/llm.client';
import { llmEndpointOf, LlmSettingsStore } from '../llm/llm-settings.store';
import { LLM_PROFILE } from '../llm/llm-profiles';

/**
 * 사용자가 초안 만들기 응답을 기다리므로 기본 대화(120초)보다 짧게 끊는다. 가정값 90초(이슈 #472): 개발 모델의 측정값 대부분을 덮는다.
 * MESSAGE_EXTRACT_TIMEOUT_SECONDS로 바꾼다(1~600초, 그 밖이면 기본값)
 */
const DEFAULT_EXTRACT_TIMEOUT_SECONDS = 90;

export function extractTimeoutMs(raw: string | undefined = process.env.MESSAGE_EXTRACT_TIMEOUT_SECONDS): number {
  const seconds = Number(raw);
  return (raw !== undefined && raw.trim() !== '' && Number.isFinite(seconds) && seconds >= 1 && seconds <= 600 ? seconds : DEFAULT_EXTRACT_TIMEOUT_SECONDS) * 1000;
}

/** AI 추출 결과: 찾은 칸 값(없으면 null)과 어떻게 끝났는지. 칸을 채웠는지(FILLED·NOTHING_FOUND)는 유형 정의가 검증한 뒤 정한다 */
export interface ExtractionOutcome {
  values: Record<string, unknown> | null;
  status: Exclude<AiExtractionStatus, 'FILLED' | 'NOTHING_FOUND'> | null;
}
const WEEKDAY = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'short' });

/** 답에서 JSON 객체 하나를 꺼낸다. 생각 과정(<think>)이나 코드블록으로 감싼 답도 받는다 */
export function parseJsonObject(reply: string): Record<string, unknown> | null {
  const text = reply.replace(/<think>[\s\S]*?<\/think>/g, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function systemPrompt(guide: string, writtenAt: Date): string {
  return [
    '너는 철강 ERP의 업무 초안 도우미다. 사내 메신저 메시지에서 아래 칸의 값을 찾아 JSON 객체 하나로만 답한다. 설명이나 코드블록은 쓰지 않는다.',
    '메시지에 없거나 확실하지 않은 칸은 null로 둔다. 추측해서 채우지 않는다.',
    `메시지 작성일은 ${seoulToday(writtenAt)}(${WEEKDAY.format(writtenAt)})이다. "내일", "다음 주 화요일" 같은 상대 날짜는 이 날을 기준으로 YYYY-MM-DD로 바꾼다.`,
    '',
    '칸:',
    guide,
  ].join('\n');
}

/** 모델이 AI 서버에 불러와 있지 않은 것(Unsloth Studio 등)은 연결 실패가 아니라 모델 문제로 알린다 (#519) */
function failureStatusOf(error: unknown): ExtractionOutcome['status'] {
  if (!(error instanceof LlmRequestError)) return 'FAILED';
  if (error.kind === 'TIMEOUT') return 'TIMEOUT';
  return error.kind === 'NO_MODEL' ? 'NO_MODEL' : 'FAILED';
}

@Injectable()
export class DraftExtractor {
  private readonly logger = new Logger(DraftExtractor.name);

  constructor(
    private readonly settings: LlmSettingsStore,
    private readonly llm: LlmClient,
  ) {}

  /** 칸 이름 → LLM이 찾은 값과 실패 이유. 모델이 없거나 실패하면 values는 null. guide는 모델이 있을 때만 읽는다 */
  async extract(guide: () => Promise<string>, content: string, writtenAt: Date): Promise<ExtractionOutcome> {
    try {
      const settings = await this.settings.read();
      if (!settings.model) return { values: null, status: 'NO_MODEL' };
      const messages = [
        { role: 'system' as const, content: systemPrompt(await guide(), writtenAt) },
        { role: 'user' as const, content },
      ];
      const extracted = parseJsonObject(await this.llm.chat(llmEndpointOf(settings), settings.model, messages, LLM_PROFILE.MESSAGE_EXTRACT, undefined, extractTimeoutMs()));
      if (!extracted) this.logger.warn('AI 추출 답이 JSON 객체가 아니라 빈 초안으로 만듭니다');
      return extracted ? { values: extracted, status: null } : { values: null, status: 'NOT_JSON' };
    } catch (error) {
      // 초안 만들기는 LLM 상태와 상관없이 되어야 한다
      this.logger.warn(`AI 추출에 실패해 빈 초안으로 만듭니다: ${error instanceof Error ? error.message : String(error)}`);
      return { values: null, status: failureStatusOf(error) };
    }
  }
}
