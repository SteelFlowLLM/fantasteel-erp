import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ERROR_CODE, type ErrorCode } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { AppException } from './app.exception';

/** 이 부분 unique가 깨지면 업무 오류로 바꾼다 (마이그레이션 SQL의 인덱스 이름) */
const UNIQUE_INDEX_ERROR: Record<string, ErrorCode> = {
  allocation_confirmed_lot_key: 'INV-003',
};

/** 실패 응답 `{ success: false, error: { code, message } }`를 한 곳에서 만든다 (코드 컨벤션 5장). */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const { code, message, status } = this.toError(exception);
    host.switchToHttp().getResponse<Response>().status(status).json({ success: false, error: { code, message } });
  }

  private toError(exception: unknown): { code: string; message: string; status: number } {
    if (exception instanceof AppException) {
      const body = exception.getResponse() as { message: string };
      // 업무 규칙 위반은 WARN (컨벤션 11장)
      this.logger.warn(`${exception.code} ${body.message}`);
      return { code: exception.code, message: body.message, status: exception.getStatus() };
    }
    if (exception instanceof BadRequestException) {
      // ValidationPipe(DTO 검증) 실패
      const raw = (exception.getResponse() as { message?: string | string[] }).message;
      const message = Array.isArray(raw) ? raw.join(', ') : (raw ?? ERROR_CODE['COM-004'].message);
      return { code: 'COM-004', message, status: HttpStatus.BAD_REQUEST };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code: ErrorCode = status === HttpStatus.UNAUTHORIZED ? 'AUTH-002' : status === HttpStatus.FORBIDDEN ? 'COM-002' : status === HttpStatus.NOT_FOUND ? 'COM-003' : 'COM-004';
      return { code, message: ERROR_CODE[code].message, status };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        // unique 위반: 채번 경합이나 동시 배정 등. 다시 시도하면 된다.
        const target = JSON.stringify(exception.meta ?? {});
        const mapped = Object.entries(UNIQUE_INDEX_ERROR).find(([index]) => target.includes(index))?.[1];
        const code: ErrorCode = mapped ?? 'COM-001';
        return { code, message: ERROR_CODE[code].message, status: ERROR_CODE[code].status };
      }
      if (exception.code === 'P2025') return { code: 'COM-003', message: ERROR_CODE['COM-003'].message, status: HttpStatus.NOT_FOUND };
    }
    const e = exception as { message?: string; stack?: string };
    this.logger.error(e?.message ?? String(exception), e?.stack);
    return { code: 'COM-999', message: ERROR_CODE['COM-999'].message, status: HttpStatus.INTERNAL_SERVER_ERROR };
  }
}
