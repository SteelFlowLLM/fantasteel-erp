import type { AiAssistantSource } from '@fantasteel/shared';
import type { GlossaryTerm } from './knowledge/glossary.types';
import type { ManualGuide } from './knowledge/manual.types';
import type { ProcessStep } from './knowledge/process.types';

export const EMPTY_ANSWER = '답을 만들지 못했어요. 질문을 조금 바꿔 다시 물어봐 주세요.';

const TERM_ID = /TRM-\d{3}/g;
/** [TRM-056] · [TRM-056, TRM-060] · (TRM-056) 같은 출처 표시 */
const PROCESS_ID = /BP-[A-Z]+-\d{2}/g;
const MANUAL_ID = /MAN-[A-Z]+-\d{2}/g;
const CITATION = /\s*[[(]\s*(?:TRM-\d{3}|BP-[A-Z]+-\d{2}|MAN-[A-Z]+-\d{2})(?:\s*[,·/]\s*(?:TRM-\d{3}|BP-[A-Z]+-\d{2}|MAN-[A-Z]+-\d{2}))*\s*[\])]/g;

export interface ParsedAnswer {
  answer: string;
  sources: AiAssistantSource[];
}

/**
 * 모델 답에서 출처를 뽑고 본문의 출처 표시를 지운다 (REQ-AST-009).
 * 출처는 넘긴 참고 자료 안의 용어·업무만 인정한다: 모델이 지어낸 ID는 출처로 보이지 않는다.
 * 작은 모델이 ID를 빠뜨리면 답 본문에 이름이 나온 참고 용어를 출처로 둔다.
 */
export function parseAssistantAnswer(raw: string, references: readonly GlossaryTerm[], processSteps: readonly ProcessStep[] = [], manualGuides: readonly ManualGuide[] = []): ParsedAnswer {
  const text = withoutThinking(raw);
  const byId = new Map(references.map((term) => [term.id, term]));
  const citedIds = [...new Set(text.match(TERM_ID) ?? [])].filter((id) => byId.has(id));
  const answer = text.replace(CITATION, '').replace(/[ \t]+\n/g, '\n').trim();

  const cited = citedIds.length
    ? citedIds.map((id) => byId.get(id)).filter((term): term is GlossaryTerm => term !== undefined)
    : references.filter((term) => answer.includes(term.name));

  const processById = new Map(processSteps.map((step) => [step.id, step]));
  const citedSteps = [...new Set(text.match(PROCESS_ID) ?? [])]
    .map((id) => processById.get(id))
    .filter((step): step is ProcessStep => step !== undefined);

  const manualById = new Map(manualGuides.map((guide) => [guide.id, guide]));
  const citedGuides = [...new Set(text.match(MANUAL_ID) ?? [])]
    .map((id) => manualById.get(id))
    .filter((guide): guide is ManualGuide => guide !== undefined);

  return {
    answer: answer || EMPTY_ANSWER,
    sources: [
      ...citedGuides.map((guide) => ({ kind: 'MANUAL' as const, id: guide.id, label: guide.name })),
      ...citedSteps.map((step) => ({ kind: 'PROCESS' as const, id: step.id, label: step.name })),
      ...cited.map((term) => ({ kind: 'GLOSSARY' as const, id: term.id, label: term.name })),
    ],
  };
}

/** 추론 모델(LM Studio의 qwen·deepseek 등)이 답 앞에 붙이는 <think> 부분은 보이지 않는다 */
function withoutThinking(raw: string): string {
  const closed = raw.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const danglingEnd = closed.lastIndexOf('</think>');
  const text = (danglingEnd >= 0 ? closed.slice(danglingEnd + '</think>'.length) : closed).trim();
  // 생각하다 길이 제한에 걸려 끝나지 않은 답
  return /^<think>/i.test(text) ? '' : text;
}
