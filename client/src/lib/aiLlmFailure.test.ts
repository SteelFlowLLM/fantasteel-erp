import { AI_LLM_FAILURE_CODES } from '@fantasteel/shared';
import { describe, expect, it } from 'vitest';
import { AI_LLM_FAILURE_GUIDE, aiLlmFailureCodeOf } from '@/lib/aiLlmFailure';

describe('철강맨AI LLM 실패 안내 (이슈 #462)', () => {
  it('AST-002~005만 LLM 실패 코드로 읽는다 (대화를 찾을 수 없는 AST-001·다른 영역 코드·빈 값은 아님)', () => {
    expect(aiLlmFailureCodeOf('AST-002')).toBe('AST-002');
    expect(aiLlmFailureCodeOf('AST-005')).toBe('AST-005');
    for (const other of ['AST-001', 'RES-005', 'COM-999', '', null, undefined]) expect(aiLlmFailureCodeOf(other)).toBeNull();
  });

  it('코드마다 머리글과 할 일 안내가 있고 서로 다르다', () => {
    const titles = AI_LLM_FAILURE_CODES.map((code) => AI_LLM_FAILURE_GUIDE[code].title);
    expect(new Set(titles).size).toBe(AI_LLM_FAILURE_CODES.length);
    for (const code of AI_LLM_FAILURE_CODES) {
      expect(AI_LLM_FAILURE_GUIDE[code].hint.length).toBeGreaterThan(10);
      // 문구는 해요체
      expect(AI_LLM_FAILURE_GUIDE[code].hint).toMatch(/요\.?$/);
    }
  });

  it('모델 없음·연결 실패·그 밖은 AI 연결 화면으로 안내하고, 시간 초과는 질문을 줄이게 안내한다', () => {
    expect(AI_LLM_FAILURE_GUIDE['AST-002'].needsSettings).toBe(true);
    expect(AI_LLM_FAILURE_GUIDE['AST-003'].needsSettings).toBe(true);
    expect(AI_LLM_FAILURE_GUIDE['AST-004'].needsSettings).toBe(false);
    expect(AI_LLM_FAILURE_GUIDE['AST-004'].hint).toContain('질문을 줄이');
  });
});
