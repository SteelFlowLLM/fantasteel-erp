import { GLOSSARY_TERMS } from './glossary.generated';
import type { GlossaryTerm } from './glossary.types';

/** 한 번에 AI에 넘기는 용어 수. 작은 로컬 모델도 읽을 수 있게 짧게 둔다 */
export const GLOSSARY_SEARCH_LIMIT = 5;

/** 이름이 맞으면 가장 높고, 사용 금지 동의어(사용자가 흔히 쓰는 말)·영문명·약어·변수명 순으로 낮다 */
const WEIGHT = { name: 10, synonym: 8, englishName: 6, abbreviation: 6, variableName: 3 } as const;

/** 영문·약어·변수명은 너무 짧으면 다른 낱말 안에서 우연히 맞으므로 이 길이부터 찾는다 */
const MIN_LATIN_KEY_LENGTH = 2;
const MIN_VARIABLE_KEY_LENGTH = 4;

interface SearchKey {
  text: string;
  weight: number;
}

/**
 * 질문에 들어 있는 용어를 찾는다(문서 검색 방식은 구현 단계 결정, REQ-AST-003).
 * 용어 사전이 117개뿐이라 색인 없이 이름·동의어가 질문 안에 있는지만 본다. 띄어쓰기·대소문자는 무시한다.
 * 같은 점수면 더 긴 이름(예약 매수 > 예약)을 앞에 둔다.
 */
export function searchGlossary(text: string, terms: readonly GlossaryTerm[] = GLOSSARY_TERMS, limit = GLOSSARY_SEARCH_LIMIT): GlossaryTerm[] {
  const haystack = normalize(text);
  if (!haystack) return [];
  return terms
    .map((term, index) => ({ term, index, score: scoreOf(term, haystack) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((match) => match.term);
}

function scoreOf(term: GlossaryTerm, haystack: string): number {
  let best = 0;
  for (const key of keysOf(term)) {
    const needle = normalize(key.text);
    if (needle && haystack.includes(needle)) best = Math.max(best, key.weight * 100 + needle.length);
  }
  return best;
}

function keysOf(term: GlossaryTerm): SearchKey[] {
  const keys: SearchKey[] = [{ text: term.name, weight: WEIGHT.name }];
  for (const synonym of term.forbiddenSynonyms) keys.push({ text: withoutNote(synonym), weight: WEIGHT.synonym });
  if (term.englishName && term.englishName.length >= MIN_LATIN_KEY_LENGTH) keys.push({ text: term.englishName, weight: WEIGHT.englishName });
  for (const abbreviation of splitSlash(term.abbreviation)) {
    if (abbreviation.length >= MIN_LATIN_KEY_LENGTH) keys.push({ text: abbreviation, weight: WEIGHT.abbreviation });
  }
  for (const variableName of splitSlash(term.variableName)) {
    if (variableName.length >= MIN_VARIABLE_KEY_LENGTH) keys.push({ text: variableName, weight: WEIGHT.variableName });
  }
  return keys;
}

/** '압연(공정명으로)'처럼 괄호 안 설명은 검색어가 아니다 */
function withoutNote(text: string): string {
  return text.replace(/\(.*$/, '').trim();
}

function splitSlash(text: string | null): string[] {
  return text === null ? [] : text.split('/').map((part) => part.trim()).filter(Boolean);
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[\s·]+/g, '');
}
