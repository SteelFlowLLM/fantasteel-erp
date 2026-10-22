import { Injectable } from '@nestjs/common';
import { manualText, processText, referenceText } from '../ai-assistant/assistant.prompt';
import { GLOSSARY_TERMS } from '../ai-assistant/knowledge/glossary.generated';
import { searchGlossary } from '../ai-assistant/knowledge/glossary.search';
import { KS_SEARCH_LIMIT, searchKs } from '../ai-assistant/knowledge/ks.search';
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
export const KNOWLEDGE_LIMITS = { ks: KS_SEARCH_LIMIT, glossary: 3, manual: 2, process: 2 } as const;
export const KNOWLEDGE_TEXT_MAX = 6_000;

// 심층 조사 시험이 여기서 가져오던 이름 (찾기 본문은 철강맨AI와 함께 쓰려고 ks.search.ts로 옮겼다)
export { searchKs };

/**
 * 🟡 심층 조사에 넣는 용어 사전 절: 철강 공정·품목·품질 용어만. 수주·재고·구매 같은 ERP 업무 용어는 웹 조사의 근거가 아니라 거의 모든 질문에 걸려 빼 둔다
 * (ERP 업무 숫자는 ERP 조회 출처가 맡는다)
 */
const GLOSSARY_SECTIONS: ReadonlySet<string> = new Set(['공정·설비', '기준정보', '품질']);

export interface CompanyKnowledgeHit {
  kind: CompanyKnowledgeKind;
  id: string;
  name: string;
  text: string;
}

/** 질문에 맞는 사내 지식: KS 규격 → 용어 사전 → 업무 매뉴얼 → 업무 프로세스 순 */
export function findCompanyKnowledge(question: string): CompanyKnowledgeHit[] {
  return [
    ...searchKs(question, undefined, KNOWLEDGE_LIMITS.ks).map((s) => ({ kind: 'ks' as const, id: s.id, name: s.title, text: s.text })),
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
