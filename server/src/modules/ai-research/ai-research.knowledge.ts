import { Injectable } from '@nestjs/common';
import { manualText, processText, referenceText } from '../ai-assistant/assistant.prompt';
import { GLOSSARY_TERMS } from '../ai-assistant/knowledge/glossary.generated';
import { searchGlossary } from '../ai-assistant/knowledge/glossary.search';
import { KS_SECTIONS } from '../ai-assistant/knowledge/ks.generated';
import type { KsSection } from '../ai-assistant/knowledge/ks.types';
import { findManualGuides } from '../ai-assistant/knowledge/manual.search';
import { findProcessSteps } from '../ai-assistant/knowledge/process.search';
import { cutText } from '../ai-assistant/web/web-text';
import type { StoredSource } from './ai-research.rules';

/**
 * 심층 조사의 사내 지식 출처 (이슈 #484). KS 규격 정리·용어 사전·업무 매뉴얼·업무 프로세스는 회사가 정한 기준이라 웹보다 먼저 근거로 쓴다.
 * LLM을 부르지 않고 질문 글로 찾는다(철강맨AI 지식 찾기와 같은 방식). 사내 문서라 회사 밖으로 보내지 않고 LLM에만 간다.
 */

export type CompanyKnowledgeKind = 'ks' | 'glossary' | 'manual' | 'process';

export const KNOWLEDGE_KIND_LABEL: Record<CompanyKnowledgeKind, string> = { ks: 'KS 규격', glossary: '용어 사전', manual: '업무 매뉴얼', process: '업무 프로세스' };

/** 🟡 종류마다 넣는 절·항목 수와 본문 길이 (가정값: 계획·근거 프롬프트를 사내 지식만으로 채우지 않게) */
export const KNOWLEDGE_LIMITS = { ks: 3, glossary: 3, manual: 2, process: 2 } as const;
export const KNOWLEDGE_TEXT_MAX = 6_000;

/**
 * 🟡 심층 조사에 넣는 용어 사전 절: 철강 공정·품목·품질 용어만. 수주·재고·구매 같은 ERP 업무 용어는 웹 조사의 근거가 아니라 거의 모든 질문에 걸려 빼 둔다
 * (ERP 업무 숫자는 ERP 조회 출처가 맡는다)
 */
const GLOSSARY_SECTIONS: ReadonlySet<string> = new Set(['공정·설비', '기준정보', '품질']);

/** 찾을 때 빼는 절: 문서 작업 메모라 근거가 아니다 */
const KS_SKIP = new Set(['KS-9', 'KS-10']);

/** 강종 기호 (SS275·SM355A·SPHC, 옛 기호 SS400·SM490A 포함) */
const GRADE = /\b(SPHC|SS\d{3}|SM\d{3}[A-D]?)\b/g;
/** KS 번호 (KS D 3503, KS E ISO 3082) */
const KS_NUMBER = /KS\s*[A-Z]\s*(?:ISO\s*)?\d{3,5}/g;
/** KS 문서에 자주 나오는 낱말. 질문에 있으면 그 낱말이 많이 나오는 절을 고른다 */
const KS_WORDS = ['인장강도', '항복강도', '연신율', '탄소당량', '샤르피', '충격', '화학성분', '성분', '허용차', '두께', '너비', '캠버', '굽힘', '밀시트', '합금철', '철광석', '석탄', '코크스', '석회석', '용선', '슬래브', '코일', '히트', '규격', '강종'];

const squeeze = (text: string) => text.toUpperCase().replace(/\s+/g, '');
const countOf = (haystack: string, needle: string) => (needle ? haystack.split(needle).length - 1 : 0);

/** 질문의 강종 기호·KS 번호·KS 낱말로 KS 규격 절을 고른다. 강종·번호는 낱말보다 무겁게 센다 */
export function searchKs(question: string, sections: readonly KsSection[] = KS_SECTIONS, limit: number = KNOWLEDGE_LIMITS.ks): KsSection[] {
  const asked = question.toUpperCase();
  const grades = [...new Set(asked.match(GRADE) ?? [])];
  const numbers = [...new Set((asked.match(KS_NUMBER) ?? []).map(squeeze))];
  const words = KS_WORDS.filter((word) => question.includes(word));
  if (grades.length + numbers.length + words.length === 0) return [];
  return sections
    .filter((section) => !KS_SKIP.has(section.id))
    .map((section, index) => {
      const body = `${section.title}\n${section.text}`;
      const upper = body.toUpperCase();
      const squeezed = squeeze(body);
      const title = section.title.toUpperCase();
      // 제목에 강종이 있는 절(강종별 기준값·SM355 등급별 차이)은 본문에서 지나가며 언급한 절보다 앞에 둔다. SM355A는 'SM355' 제목에도 맞는다
      const titled = grades.filter((grade) => title.includes(grade) || title.includes(grade.replace(/[A-D]$/, ''))).length;
      const score =
        8 * titled +
        grades.reduce((sum, grade) => sum + 4 * Math.min(3, countOf(upper, grade)), 0) +
        numbers.reduce((sum, number) => sum + 4 * Math.min(3, countOf(squeezed, number)), 0) +
        words.reduce((sum, word) => sum + Math.min(3, countOf(body, word)), 0);
      return { section, index, score };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((match) => match.section);
}

export interface CompanyKnowledgeHit {
  kind: CompanyKnowledgeKind;
  id: string;
  name: string;
  text: string;
}

/** 질문에 맞는 사내 지식: KS 규격 → 용어 사전 → 업무 매뉴얼 → 업무 프로세스 순 */
export function findCompanyKnowledge(question: string): CompanyKnowledgeHit[] {
  return [
    ...searchKs(question).map((s) => ({ kind: 'ks' as const, id: s.id, name: s.title, text: s.text })),
    ...searchGlossary(question, GLOSSARY_TERMS.filter((t) => GLOSSARY_SECTIONS.has(t.section)), KNOWLEDGE_LIMITS.glossary).map((t) => ({ kind: 'glossary' as const, id: t.id, name: t.name, text: referenceText(t) })),
    ...findManualGuides(question)
      .slice(0, KNOWLEDGE_LIMITS.manual)
      .map((g) => ({ kind: 'manual' as const, id: g.id, name: g.name, text: manualText(g) })),
    ...findProcessSteps(question)
      .slice(0, KNOWLEDGE_LIMITS.process)
      .map((p) => ({ kind: 'process' as const, id: p.id, name: p.name, text: processText(p) })),
  ];
}

export const knowledgeUrl = (kind: CompanyKnowledgeKind, id: string) => `knowledge:${kind}:${id}`;

/**
 * 찾은 사내 지식을 조사 출처로 (번호는 startId부터). 이미 있는 것(같은 주소)은 빼고, 본문은 readText로 두어 다시 읽지 않는다.
 * 웹 주소가 아니라 링크로 달지 않는다
 */
export function knowledgeSourcesFrom(hits: readonly CompanyKnowledgeHit[], existing: readonly StoredSource[], startId: number): StoredSource[] {
  const known = new Set(existing.map((s) => s.url));
  const fresh = hits.filter((hit) => !known.has(knowledgeUrl(hit.kind, hit.id)));
  return fresh.map((hit, i) => ({
    id: startId + i,
    title: `사내 지식 · ${KNOWLEDGE_KIND_LABEL[hit.kind]} ${hit.kind === 'ks' ? hit.id.replace(/^KS-/, '') + '.' : hit.id} ${hit.name}`,
    url: knowledgeUrl(hit.kind, hit.id),
    snippet: `우리 회사 ${KNOWLEDGE_KIND_LABEL[hit.kind]} 문서`,
    readText: cutText(hit.text, KNOWLEDGE_TEXT_MAX),
    knowledge: { kind: hit.kind, id: hit.id },
  }));
}

/** 일꾼이 쓰는 사내 지식 찾기. 시험이 바꿔 끼울 수 있게 provider로 둔다 */
@Injectable()
export class ResearchKnowledgeFinder {
  find(focus: string): CompanyKnowledgeHit[] {
    return findCompanyKnowledge(focus);
  }
}
