import { KNOWLEDGE_KINDS, lookupKnowledge } from '../knowledge/knowledge.read';
import { OPEN_ACCESS, ToolArgumentError, requiredString, type AssistantTool } from './assistant-tool';

export const READ_KNOWLEDGE_TOOL = 'read_knowledge';

/**
 * 지식 읽기 (REQ-AST-003). 시스템 프롬프트의 [지식 목록]에 있는 업무 매뉴얼·업무 프로세스·용어를 전체 내용으로 읽는다.
 * 질문에서 자동으로 고른 자료로 모자랄 때 모델이 직접 찾아 읽는 길이다. 조회만 하고 전 역할이 쓴다.
 * 읽은 항목은 답의 출처로 인정되므로(서버가 부른 쪽에서 모은다) 조회 출처(DATA)는 따로 남기지 않는다.
 */
export function knowledgeTool(): AssistantTool {
  return {
    access: OPEN_ACCESS,
    definition: {
      name: READ_KNOWLEDGE_TOOL,
      description:
        '[지식 목록]의 업무 매뉴얼(화면 절차)·업무 프로세스(업무 순서)·용어 사전 항목 하나의 전체 내용을 읽는다. 질문에 맞는 자료가 [참고 자료]·[업무 프로세스 자료]·[업무 매뉴얼 자료]에 없을 때 쓴다.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...KNOWLEDGE_KINDS], description: 'manual(업무 매뉴얼), process(업무 프로세스), glossary(용어)' },
          id: { type: 'string', description: 'manual·process는 MAN-SO-01·BP-SO-01 같은 ID, glossary는 용어 이름(예: 예약 매수) 또는 TRM-056' },
        },
        required: ['kind', 'id'],
      },
    },
    async run(args) {
      const kind = requiredString(args, 'kind');
      if (!(KNOWLEDGE_KINDS as readonly string[]).includes(kind)) throw new ToolArgumentError(`kind는 ${KNOWLEDGE_KINDS.join(', ')} 중 하나예요`);
      const id = requiredString(args, 'id', 100);
      const found = lookupKnowledge(kind as (typeof KNOWLEDGE_KINDS)[number], id);
      if (!found.found) throw new ToolArgumentError(found.message);
      return { label: `지식 · ${found.name}`, data: { 종류: kind, id: found.entry.id, 이름: found.name, 내용: found.text }, hideSource: true };
    },
  };
}
