import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_CODE } from '@fantasteel/shared';

/** 업무 오류. 컨트롤러별 try/catch 없이 이 예외를 throw한다 (코드 컨벤션 5장). */
export class AppException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super({ code, message }, status);
  }
}

export const notFound = (what: string) => new AppException(ERROR_CODE.COM_004, `${what}을(를) 찾을 수 없습니다`, HttpStatus.NOT_FOUND);
export const forbidden = (message = '해당 업무 권한이 없습니다') => new AppException(ERROR_CODE.COM_002, message, HttpStatus.FORBIDDEN);
export const invalidState = (message: string) => new AppException(ERROR_CODE.COM_005, message, HttpStatus.CONFLICT);
export const badInput = (message: string) => new AppException(ERROR_CODE.COM_003, message, HttpStatus.BAD_REQUEST);
