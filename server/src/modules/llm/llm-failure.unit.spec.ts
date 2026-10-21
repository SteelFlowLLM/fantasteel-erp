// LLM 실패 → 오류 코드(AST-002~005) 변환 (이슈 #462). DB·네트워크 없음
import { ERROR_CODE } from '@fantasteel/shared';
import { llmFailureException, llmFailureOf, noModelException, LLM_FAILURE_CODE } from './llm-failure';
import { LlmAbortedError, LlmJsonParseError, LlmModelNotLoadedError, LlmRequestError, unslothNotLoadedMessage, type LlmFailureKind } from './llm.client';

describe('LLM 실패 오류 코드', () => {
  it('실패 종류마다 겹치지 않는 코드를 쓰고 모두 503이다', () => {
    const codes = Object.values(LLM_FAILURE_CODE);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(ERROR_CODE[code].status).toBe(503);
    expect(LLM_FAILURE_CODE).toEqual({ NO_MODEL: 'AST-002', CONNECT: 'AST-003', TIMEOUT: 'AST-004', SERVER: 'AST-005' });
  });

  it('Unsloth 모델 미적재는 AST-002이고 불러오기·auto-switch 안내 문구를 그대로 쓴다 (이슈 #465)', () => {
    const message = unslothNotLoadedMessage('a/think', ['b/plain']);
    expect(llmFailureOf(new LlmModelNotLoadedError(message))).toEqual({ code: 'AST-002', message });
  });

  it('새 코드는 이미 있는 코드(AST-001·RES-·VOC-)와 번호가 겹치지 않는다', () => {
    const astCodes = Object.keys(ERROR_CODE).filter((code) => code.startsWith('AST-'));
    expect(astCodes).toEqual(['AST-001', 'AST-002', 'AST-003', 'AST-004', 'AST-005']);
  });

  it.each<[LlmFailureKind, string]>([
    ['NO_MODEL', 'AST-002'],
    ['CONNECT', 'AST-003'],
    ['TIMEOUT', 'AST-004'],
  ])('%s는 %s와 코드의 안내 문구를 쓴다(LLM 주소가 든 원래 문구는 쓰지 않음)', (kind, code) => {
    const failure = llmFailureOf(new LlmRequestError('http://10.0.0.5:1234/v1에 연결할 수 없어요', undefined, kind));
    expect(failure).toEqual({ code, message: ERROR_CODE[code as 'AST-002'].message });
    expect(failure.message).not.toContain('10.0.0.5');
    const exception = llmFailureException(new LlmRequestError('x', undefined, kind));
    expect(exception.getStatus()).toBe(503);
    expect(exception.getResponse()).toEqual({ code, message: ERROR_CODE[code as 'AST-002'].message });
  });

  it('그 밖(SERVER)은 AST-005로 LLM 서버가 알려 준 이유를 그대로 둔다', () => {
    const exception = llmFailureException(new LlmRequestError('LLM 서버 오류 (HTTP 400): 문맥 길이를 넘었어요', 400));
    expect(exception.getStatus()).toBe(503);
    expect(exception.getResponse()).toEqual({ code: 'AST-005', message: 'LLM 서버 오류 (HTTP 400): 문맥 길이를 넘었어요' });
    // JSON을 읽지 못한 오류와 멈춤 오류도 기본 종류는 SERVER
    expect(new LlmJsonParseError('읽지 못함', '', null).kind).toBe('SERVER');
    expect(new LlmAbortedError().kind).toBe('SERVER');
  });

  it('모델이 없으면 AST-002(503)', () => {
    const exception = noModelException();
    expect(exception.getStatus()).toBe(503);
    expect(exception.getResponse()).toEqual({ code: 'AST-002', message: ERROR_CODE['AST-002'].message });
  });
});
