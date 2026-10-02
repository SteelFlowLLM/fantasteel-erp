import { HttpException } from '@nestjs/common';
import { ERROR_CODE, type ErrorCode } from '@fantasteel/shared';

/**
 * 업무 오류. 컨트롤러별 try/catch 없이 이 예외를 throw한다 (코드 컨벤션 5장).
 * message·status를 생략하면 shared의 ERROR_CODE(업무 프로세스 정의서 9.3) 값을 쓴다.
 *   throw new AppException('SO-002');
 *   throw new AppException('INV-001', `가용 매수가 ${available}매뿐이에요`);
 */
export class AppException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
    status?: number,
  ) {
    const def = ERROR_CODE[code];
    super({ code, message: message ?? def.message }, status ?? def.status);
  }
}
