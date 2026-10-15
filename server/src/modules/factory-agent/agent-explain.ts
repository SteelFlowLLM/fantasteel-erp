import type { ChatMessage } from '../llm/llm.client';

export interface AgentExplainInput {
  riskLabel: string;
  /** 규칙이 만든 한 줄 요약 */
  summary: string;
  /** 조회 근거 "항목: 값" */
  basis: readonly string[];
  /** Asia/Seoul YYYY-MM-DD */
  today: string;
}

/**
 * 상황 설명 요청 (REQ-AGT-006). AI는 대응 후보를 정하지 않고, 아래 조회 근거만으로 상황을 설명한다.
 * 근거에 없는 숫자나 원인은 말하지 않게 시스템 지시로 막는다.
 */
export function buildExplainMessages(input: AgentExplainInput): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        '당신은 철강 제조 ERP의 AI Factory Agent입니다. 규칙이 감지한 위험의 상황만 한국어로 짧게 설명합니다.',
        '- 아래 "조회 근거"에 있는 내용과 숫자만 말합니다. 근거에 없는 원인·추정·숫자는 말하지 않습니다.',
        '- 무엇을 해야 하는지 정하거나 권하지 않습니다. 대응은 담당 부서원이 후보별로 확정합니다.',
        '- 3문장 이내로, 현재 어떤 상황인지와 근거 숫자가 무엇을 뜻하는지만 씁니다.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [`오늘: ${input.today}`, `위험 유형: ${input.riskLabel}`, `규칙 요약: ${input.summary}`, '조회 근거:', ...input.basis.map((line) => `- ${line}`)].join('\n'),
    },
  ];
}
