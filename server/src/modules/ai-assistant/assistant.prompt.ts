import type { AiAssistantScreenContext, AiAssistantTurn } from '@fantasteel/shared';
import type { ChatMessage } from '../llm/llm.client';
import type { GlossaryTerm } from './knowledge/glossary.types';

/** 지난 대화는 최근 것만 보낸다. 작은 로컬 모델의 문맥 길이를 넘지 않게 한다 */
export const MAX_HISTORY_TURNS = 10;
export const MAX_TURN_LENGTH = 2000;

export interface AssistantPromptInput {
  employeeName: string;
  roleLabel: string;
  /** Asia/Seoul YYYY-MM-DD */
  today: string;
  screen: AiAssistantScreenContext | null;
  references: readonly GlossaryTerm[];
  history: readonly AiAssistantTurn[];
  question: string;
}

/**
 * 안전 규칙(REQ-AST-009)과 AI 사용 원칙(기획안: 조회·초안만, 데이터는 바꾸지 않음)을 시스템 지시로 넣는다.
 * 참고 자료는 질문으로 찾은 용어만 넣고, 답 문장 끝에 [TRM-056]처럼 용어 ID를 붙이게 해서 출처를 서버가 뽑는다.
 */
export function buildAssistantMessages(input: AssistantPromptInput): ChatMessage[] {
  const system = [
    '너는 철강 제조 ERP "FantaSteel"의 AI 어시스턴트야. 신입사원이 용어와 업무 절차를 이해하도록 돕는다.',
    '',
    '[답하는 규칙]',
    '1. 한국어 해요체로, 마크다운 없이 짧은 문장 3~6개로 답한다.',
    '2. 아래 [참고 자료]에 있는 내용만 근거로 답한다. 참고 자료를 쓴 문장 끝에는 [TRM-056]처럼 그 용어 ID를 붙인다.',
    '3. 참고 자료에 없는 내용은 지어내지 말고 "용어 사전에서 확인할 수 없어요"라고 답한다.',
    '4. 재고·매수·톤·건수·진행 상황 같은 업무 데이터는 아직 조회할 수 없다. 이런 질문에는 숫자를 말하지 말고 "아직 데이터를 조회할 수 없어요"라고 답한다.',
    '5. 너는 업무 데이터를 바꾸지 못한다. 등록·확정·승인을 해 달라고 하면 직접 할 수 없다고 답한다.',
    '6. 참고 자료의 "사용 금지 동의어"는 쓰지 말고 한글명으로 말한다.',
    '',
    '[사용자]',
    `${input.employeeName} · 역할 ${input.roleLabel}`,
    `오늘: ${input.today}`,
    '',
    '[보고 있는 화면]',
    screenText(input.screen),
    '',
    '[참고 자료]',
    input.references.length ? input.references.map(referenceText).join('\n\n') : '(질문에 맞는 용어를 찾지 못했어요)',
  ].join('\n');

  return [
    { role: 'system', content: system },
    ...recentHistory(input.history).map((turn) => ({ role: turn.role, content: turn.content })),
    { role: 'user', content: input.question },
  ];
}

export function recentHistory(history: readonly AiAssistantTurn[]): AiAssistantTurn[] {
  return history
    .filter((turn) => turn.content.trim())
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => ({ role: turn.role, content: turn.content.slice(0, MAX_TURN_LENGTH) }));
}

function screenText(screen: AiAssistantScreenContext | null): string {
  if (!screen) return '(알 수 없음)';
  return [`${screen.title} (${screen.path})`, screen.label ? `맥락: ${screen.label}` : null].filter(Boolean).join('\n');
}

function referenceText(term: GlossaryTerm): string {
  return [
    `[${term.id}] ${term.name}${term.englishName ? ` (${term.englishName})` : ''}`,
    `정의: ${term.definition}`,
    term.businessRule ? `업무 규칙: ${term.businessRule}` : null,
    term.relatedTerms.length ? `관련 용어: ${term.relatedTerms.join(', ')}` : null,
    term.forbiddenSynonyms.length ? `사용 금지 동의어: ${term.forbiddenSynonyms.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}
