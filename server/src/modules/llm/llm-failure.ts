import { ERROR_CODE, type AiLlmFailureCode } from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import type { LlmFailureKind, LlmRequestError } from './llm.client';

/** LLM 실패 종류 → 오류 코드. 9.3에 없어 AST-002~005를 새로 두었다 (이슈 #462) */
export const LLM_FAILURE_CODE: Record<LlmFailureKind, AiLlmFailureCode> = {
  NO_MODEL: 'AST-002',
  CONNECT: 'AST-003',
  TIMEOUT: 'AST-004',
  SERVER: 'AST-005',
};

type Failure = Pick<LlmRequestError, 'kind' | 'message'>;

/**
 * 사용자에게 보일 오류 코드와 문구. 연결 실패는 내부 LLM 주소가 문구에 들어 있어 코드의 안내 문구로 바꾸고(이유는 부르는 쪽이 서버 로그에 남긴다),
 * 시간 초과·모델 없음도 코드 문구를 쓴다. 그 밖(LLM 서버가 돌려준 HTTP 오류·API 키·읽을 수 없는 응답)은 고칠 단서가 되므로 이유를 그대로 둔다.
 */
export function llmFailureOf(error: Failure): { code: AiLlmFailureCode; message: string } {
  const code = LLM_FAILURE_CODE[error.kind];
  return { code, message: error.kind === 'SERVER' ? error.message : ERROR_CODE[code].message };
}

export const llmFailureException = (error: Failure): AppException => {
  const { code, message } = llmFailureOf(error);
  return new AppException(code, message);
};

/** 모델이 정해지지 않았을 때 */
export const noModelException = (): AppException => new AppException(LLM_FAILURE_CODE.NO_MODEL);
