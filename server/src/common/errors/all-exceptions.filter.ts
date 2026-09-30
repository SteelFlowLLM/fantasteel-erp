import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ERROR_CODE } from '@fantasteel/shared';
import { AppException } from './app.exception';

/** 실패 응답 `{ success: false, error: { code, message } }` 를 한 곳에서 만든다. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = 'COM-999';
    let message = '서버 오류가 발생했습니다';

    if (exception instanceof AppException) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      this.logger.warn(`${code} ${message}`);
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      const raw = typeof body === 'string' ? body : (body as { message?: string | string[] }).message;
      message = Array.isArray(raw) ? raw.join(', ') : (raw ?? exception.message);
      code =
        status === HttpStatus.UNAUTHORIZED ? ERROR_CODE.AUTH_002
        : status === HttpStatus.FORBIDDEN ? ERROR_CODE.COM_002
        : status === HttpStatus.NOT_FOUND ? ERROR_CODE.COM_004
        : ERROR_CODE.COM_003;
    } else {
      const e = exception as { code?: string; message?: string; stack?: string; meta?: { target?: unknown } };
      if (e?.code === 'P2002') {
        // unique 제약 위반: 같은 LOT의 CONFIRMED 배정 중복 등
        status = HttpStatus.CONFLICT;
        const target = JSON.stringify(e.meta?.target ?? '');
        if (target.includes('allocation') || target.includes('lot_id')) {
          code = ERROR_CODE.INV_003;
          message = '이미 배정된 LOT입니다';
        } else {
          code = ERROR_CODE.COM_001;
          message = '이미 등록된 값이거나 다른 사용자가 먼저 처리했습니다';
        }
      } else if (e?.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        code = ERROR_CODE.COM_004;
        message = '대상을 찾을 수 없습니다';
      } else {
        this.logger.error(e?.message ?? String(exception), e?.stack);
      }
    }
    res.status(status).json({ success: false, error: { code, message } });
  }
}
