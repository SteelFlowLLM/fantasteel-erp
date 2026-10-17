import { manualText, processText, referenceText } from '../assistant.prompt';
import { GLOSSARY_TERMS } from './glossary.generated';
import { searchGlossary } from './glossary.search';
import type { GlossaryTerm } from './glossary.types';
import { MANUAL_GUIDES } from './manual.generated';
import type { ManualGuide } from './manual.types';
import { PROCESS_STEPS } from './process.generated';
import type { ProcessStep } from './process.types';

export const KNOWLEDGE_KINDS = ['manual', 'process', 'glossary'] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

/** 한 번에 모델에 넘기는 본문 길이 상한. 작은 모델의 문맥을 넘지 않게 한다 */
export const KNOWLEDGE_TEXT_MAX = 4000;

export type KnowledgeLookup =
  | { found: true; kind: 'manual'; entry: ManualGuide; name: string; text: string }
  | { found: true; kind: 'process'; entry: ProcessStep; name: string; text: string }
  | { found: true; kind: 'glossary'; entry: GlossaryTerm; name: string; text: string }
  | { found: false; message: string };

const normalize = (text: string): string => text.toLowerCase().replace(/[\s·]+/g, '');

/**
 * read_knowledge가 읽을 항목을 찾는다 (REQ-AST-003). 매뉴얼·업무는 ID(MAN-SO-01·BP-SO-01) 또는 이름,
 * 용어는 이름·TRM ID로 찾는다. 못 찾으면 모델이 다시 부를 수 있게 후보를 알려 준다.
 */
export function lookupKnowledge(
  kind: KnowledgeKind,
  id: string,
  sources: { guides: readonly ManualGuide[]; steps: readonly ProcessStep[]; terms: readonly GlossaryTerm[] } = { guides: MANUAL_GUIDES, steps: PROCESS_STEPS, terms: GLOSSARY_TERMS },
): KnowledgeLookup {
  const key = normalize(id);
  if (kind === 'manual') {
    const guide = sources.guides.find((g) => normalize(g.id) === key || normalize(g.processId) === key) ?? uniqueByName(sources.guides, key);
    if (guide) return { found: true, kind, entry: guide, name: guide.name, text: capped(manualText(guide)) };
    return { found: false, message: `없는 매뉴얼이에요: ${id}. 가능한 값: ${sources.guides.map((g) => `${g.id} ${g.name}`).join(', ')}` };
  }
  if (kind === 'process') {
    const step = sources.steps.find((s) => normalize(s.id) === key) ?? uniqueByName(sources.steps, key);
    if (step) return { found: true, kind, entry: step, name: step.name, text: capped(processText(step)) };
    return { found: false, message: `없는 업무예요: ${id}. 가능한 값: ${sources.steps.map((s) => `${s.id} ${s.name}`).join(', ')}` };
  }
  const term = sources.terms.find((t) => normalize(t.id) === key || normalize(t.name) === key) ?? uniqueByName(sources.terms, key);
  if (term) return { found: true, kind, entry: term, name: term.name, text: capped(referenceText(term)) };
  const candidates = searchGlossary(id, sources.terms, 5);
  return { found: false, message: `없는 용어예요: ${id}.${candidates.length ? ` 비슷한 용어: ${candidates.map((t) => `${t.id} ${t.name}`).join(', ')}` : ' 용어 이름이나 TRM ID로 다시 불러 보세요.'}` };
}

/** 이름에 key가 들어 있는 항목이 딱 하나일 때만 (여럿이면 모호하니 후보를 알려 준다) */
function uniqueByName<T extends { name: string }>(entries: readonly T[], key: string): T | undefined {
  if (!key) return undefined;
  const matched = entries.filter((entry) => normalize(entry.name).includes(key));
  return matched.length === 1 ? matched[0] : undefined;
}

function capped(text: string): string {
  return text.length <= KNOWLEDGE_TEXT_MAX ? text : `${text.slice(0, KNOWLEDGE_TEXT_MAX)}… (길어서 여기까지만 읽었어요)`;
}
