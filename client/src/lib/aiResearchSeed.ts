// 철강맨AI 대화 → 심층 조사 (이슈 #408). 웹 검색으로 답한 질문과 그 답·출처를 조사의 "먼저 알아본 것"(seed)으로 넘긴다.
// 서버도 같은 상한으로 다시 다듬는다(http·https만, 같은 주소 한 번). 여기서는 보낼지 말지와 보낼 모양만 정한다.
import { AI_RESEARCH_LIMITS, type AiResearchSeed } from '@fantasteel/shared';
import type { AiChatEntry } from '@/stores/useAiChatStore';

export interface AiWebResearchStart {
  question: string;
  seed: AiResearchSeed;
}

const isWebUrl = (url: string): boolean => /^https?:\/\//i.test(url.trim());

/**
 * entries[index]가 웹 검색을 켜고 물은 질문의 답이면 그 질문과 seed. 아니면 null.
 * 답의 webSources에는 Notion·Drive 출처도 섞일 수 있어 질문의 웹 검색 표시와 http(s) 주소로 가른다.
 */
export function webResearchStartAt(entries: readonly AiChatEntry[], index: number): AiWebResearchStart | null {
  const answer = entries[index];
  const asked = entries[index - 1];
  if (answer?.role !== 'assistant' || asked?.role !== 'user' || asked.webSearch !== true) return null;
  const sources = (answer.webSources ?? []).filter((s) => isWebUrl(s.url)).slice(0, AI_RESEARCH_LIMITS.seedSourcesMax);
  const question = asked.content.trim().slice(0, AI_RESEARCH_LIMITS.questionMax);
  if (sources.length === 0 || question.length < AI_RESEARCH_LIMITS.questionMin) return null;
  return {
    question,
    seed: { answer: answer.content.trim().slice(0, AI_RESEARCH_LIMITS.seedAnswerMax), sources: sources.map((s) => ({ title: s.title.slice(0, AI_RESEARCH_LIMITS.seedTitleMax), url: s.url })) },
  };
}

/**
 * 심층 조사 카드가 함께 넘길 웹 검색 결과: 카드가 달린 답이 웹 검색 답이면 그것, 아니면 바로 앞 질문의 답.
 * 더 앞의 답은 맥락이 달라졌을 수 있어 넘기지 않는다.
 */
export function researchCardSeedAt(entries: readonly AiChatEntry[], index: number): AiResearchSeed | null {
  return webResearchStartAt(entries, index)?.seed ?? webResearchStartAt(entries, index - 2)?.seed ?? null;
}
