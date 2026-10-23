import type { GlossaryTerm } from './glossary.types';
import { KNOWLEDGE_KINDS, lookupKnowledge, type KnowledgeKind } from './knowledge.read';
import type { KsSection } from './ks.types';
import type { ManualGuide } from './manual.types';
import type { ProcessStep } from './process.types';

/** 한 답에서 read_knowledge로 읽은 항목. parseAssistantAnswer가 이 항목들의 ID도 출처로 인정한다 */
export class KnowledgeReads {
  readonly terms: GlossaryTerm[] = [];
  readonly steps: ProcessStep[] = [];
  readonly guides: ManualGuide[] = [];
  readonly sections: KsSection[] = [];

  /** 도구 인자(JSON)로 읽은 항목을 기록한다. 인자가 틀렸거나 없는 항목이면 기록하지 않는다 */
  add(argumentsJson: string): void {
    let args: unknown;
    try {
      args = JSON.parse(argumentsJson || '{}');
    } catch {
      return;
    }
    if (typeof args !== 'object' || args === null) return;
    const { kind, id } = args as { kind?: unknown; id?: unknown };
    if (typeof kind !== 'string' || typeof id !== 'string' || !(KNOWLEDGE_KINDS as readonly string[]).includes(kind)) return;
    const found = lookupKnowledge(kind as KnowledgeKind, id.trim());
    if (!found.found) return;
    if (found.kind === 'glossary') pushOnce(this.terms, found.entry);
    else if (found.kind === 'process') pushOnce(this.steps, found.entry);
    else if (found.kind === 'ks') pushOnce(this.sections, found.entry);
    else pushOnce(this.guides, found.entry);
  }
}

function pushOnce<T extends { id: string }>(list: T[], entry: T): void {
  if (!list.some((item) => item.id === entry.id)) list.push(entry);
}
