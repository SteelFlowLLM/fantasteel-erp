import { ERROR_CODE, type AiLlmFailureCode } from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { LlmModelNotLoadedError, type LlmFailureKind, type LlmRequestError } from './llm.client';

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
 * 시간 초과·모델 없음도 코드 문구를 쓴다. 다만 Unsloth 모델 미적재(LlmModelNotLoadedError)는 주소가 없고 고치는 방법이 든 안내라 그대로 둔다. 그 밖(LLM 서버가 돌려준 HTTP 오류·API 키·읽을 수 없는 응답)은 고칠 단서가 되므로 이유를 그대로 둔다.
 */
export function llmFailureOf(error: Failure): { code: AiLlmFailureCode; message: string } {
  const code = LLM_FAILURE_CODE[error.kind];
  // 모델 없음 중 Unsloth Studio에 모델이 불러와 있지 않은 경우는 '모델을 불러오거나 auto-switch'라는 안내가 고치는 방법이라 그대로 둔다 (이슈 #465)
  return { code, message: error.kind === 'SERVER' || error instanceof LlmModelNotLoadedError ? error.message : ERROR_CODE[code].message };
}

export const llmFailureException = (error: Failure): AppException => {
  const { code, message } = llmFailureOf(error);
  return new AppException(code, message);
};

/** 모델이 정해지지 않았을 때 */
export const noModelException = (): AppException => new AppException(LLM_FAILURE_CODE.NO_MODEL);
