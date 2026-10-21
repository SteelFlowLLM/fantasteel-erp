import { MEETING_ANALYSIS_MAX_CHARS } from '@fantasteel/shared';

/** 1토큰 ≈ 2자 (지난 대화·심층 조사와 같은 어림) */
const CHARS_PER_TOKEN = 2;
/** 문맥이 아주 작아도 이만큼은 넣는다 (그보다 작은 모델은 회의를 다루기 어렵다) */
const MIN_TRANSCRIPT_CHARS = 6_000;

/** 회의 질문의 회의 내용 몫: 문맥의 절반. 나머지는 시스템 지시·도구·지난 대화(25%)·답 자리 (🟡 가정값, 이슈 #522) */
export const MEETING_QUESTION_CONTEXT_SHARE = 0.5;
/** 회의 질문의 회의 내용 글자 수 (문맥 길이를 모를 때, 예전 값) */
export const MEETING_CONTEXT_DEFAULT_CHARS = 30_000;
/** AI 화자 추정의 전사 몫: 문맥의 절반 (🟡 가정값) */
export const SPEAKER_SUGGEST_CONTEXT_SHARE = 0.5;
/** AI 화자 추정의 전사 글자 수 (문맥 길이를 모를 때, 예전 값) */
export const SPEAKER_SUGGEST_DEFAULT_CHARS = 24_000;
/** AI 화자 추정은 작성자가 버튼을 누르고 2분 안에 답을 기다리므로 문맥이 커도 이만큼까지만 읽힌다 (🟡 가정값) */
export const SPEAKER_SUGGEST_MAX_CHARS = 80_000;

/**
 * 모델 문맥 길이(토큰, #468 관리자 설정·LM Studio·Unsloth가 알려 준 값)로 회의 전사에 쓸 글자 수를 정한다 (이슈 #522).
 * AI 정리는 20만 자(MEETING_ANALYSIS_MAX_CHARS)까지 읽으므로 그보다 크게 잡지 않는다. 문맥 길이를 모르면(외부 LLM·옛 LM Studio) 예전 값
 */
export function transcriptCharsFor(contextLength: number | null, share: number, fallback: number, max: number = MEETING_ANALYSIS_MAX_CHARS): number {
  if (!contextLength || contextLength <= 0) return fallback;
  return Math.min(max, MEETING_ANALYSIS_MAX_CHARS, Math.max(MIN_TRANSCRIPT_CHARS, Math.floor(contextLength * share * CHARS_PER_TOKEN)));
}
