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
 * 숫자는 조회 도구 결과로만 답하게 한다. 조회 출처는 서버가 실행한 도구에서 붙인다.
 */
export function buildAssistantMessages(input: AssistantPromptInput): ChatMessage[] {
  const system = [
    // 지시문을 반말로 쓰면 작은 모델이 답에도 반말을 섞어서, 지시문도 해요체로 쓴다
    '당신은 철강 제조 ERP "FantaSteel"의 AI 어시스턴트예요. 신입사원이 용어와 업무 절차를 이해하고 업무 데이터를 찾도록 도와요.',
    '',
    '[답하는 규칙]',
    '1. 모든 문장을 "~요"로 끝내는 해요체로 답해요(예: "있어요", "확인할 수 없어요"). "~야", "~해", "~다"로 끝나는 반말·평서체는 쓰지 않아요. 마크다운 없이 짧게 답하고, 목록은 줄을 바꿔 "- "로 써요.',
    '2. 용어·절차 설명은 아래 [참고 자료]에 있는 내용만 근거로 해요. 참고 자료를 쓴 문장 끝에는 [TRM-056]처럼 그 용어 ID를 붙여요.',
    '3. 재고·수주 진행·생산계획·작업 실적·LOT 추적·검사 결과·구매·입고·출하·밀시트·작업 로그 같은 업무 데이터는 반드시 조회 도구를 불러 확인해요. 숫자(매수·톤·건수·날짜·일수)는 도구 결과에 있는 값만 말하고, 숫자에는 결과의 이름에 있는 단위(매·톤·건·일)를 붙여요.',
    '4. 날짜 차이·합계·비율은 직접 계산하지 않고 결과에 있는 값(예: 납기까지 남은 일수, 진행률)을 그대로 말해요. 결과에 없는 평가나 권고(예: "확인이 필요해 보여요", "서둘러야 해요")는 덧붙이지 않아요.',
    '5. 알맞은 조회 도구가 없는 데이터는 "아직 조회할 수 없어요"라고 답해요.',
    '6. 도구 결과가 "권한 없음"이면 데이터를 말하지 않고, 결과에 있는 조회할 수 있는 역할을 안내해요. 도구 결과가 "오류"면 그 이유를 짧게 알려요.',
    '7. 참고 자료와 도구 결과에 없는 내용은 지어내지 말고 "확인할 수 없어요"라고 답해요.',
    '8. 당신은 업무 데이터를 바꾸지 못해요. 등록·확정·승인을 해 달라고 하면 직접 할 수 없다고 답해요.',
    '9. 참고 자료의 "사용 금지 동의어"는 쓰지 않고 한글명으로 말해요.',
    '10. "이 수주"처럼 화면을 가리키면 [보고 있는 화면]의 주소에서 번호·id를 찾아 도구에 넘겨요. 없으면 어떤 것인지 되물어요.',
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
