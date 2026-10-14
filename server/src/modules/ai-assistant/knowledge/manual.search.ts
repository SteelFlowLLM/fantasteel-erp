import { MANUAL_GUIDES } from './manual.generated';
import type { ManualGuide } from './manual.types';

/** 화면에서 어떻게 하는지·어디를 눌러야 하는지 묻는 말 */
const SCREEN_PROCEDURE_QUESTION = /어떻게|방법|절차|과정|단계|어디|눌러|누르|클릭|버튼|메뉴|화면/;

export const MANUAL_MATCH_LIMIT = 2;

/** 업무 이름 조각 중 너무 흔해서 다른 업무 질문에도 들어가는 말 */
const COMMON_WORDS = new Set(['등록', '입력', '확정', '승인', '계획', '조회', '관리']);
const MIN_TOKEN_LENGTH = 2;

/**
 * 화면 절차를 묻는 질문일 때만 업무 매뉴얼에서 근거를 고른다 (구매요청은 어떻게 등록해? · 출고 확정은 어디서 눌러?).
 * 업무 이름 조각이 질문에 들어 있는 업무를 많이 맞는 순으로 2개까지. 맞는 업무가 없으면 아무것도 넘기지 않는다
 * (매뉴얼 전체는 분량이 커서 순서를 묻는 질문에 쓰지 않는다. 그건 업무 프로세스 표가 답한다).
 */
export function findManualGuides(text: string, guides: readonly ManualGuide[] = MANUAL_GUIDES): ManualGuide[] {
  if (!SCREEN_PROCEDURE_QUESTION.test(text)) return [];
  const haystack = normalize(text);
  return guides
    .map((guide, index) => ({ guide, index, score: scoreOf(guide, haystack) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MANUAL_MATCH_LIMIT)
    .map((match) => match.guide);
}

function scoreOf(guide: ManualGuide, haystack: string): number {
  return [...new Set(tokensOf(guide.name))].filter((token) => haystack.includes(token)).reduce((sum, token) => sum + token.length, 0);
}

function tokensOf(name: string): string[] {
  return name
    .split(/[·\s()]+/)
    .map(normalize)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !COMMON_WORDS.has(token));
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[\s·]+/g, '');
}
