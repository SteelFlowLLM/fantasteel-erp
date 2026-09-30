import { CallHandler, ExecutionContext, Injectable, NestInterceptor, PayloadTooLargeException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Observable } from 'rxjs';
import { ATTACHMENT_MAX_BYTES, attachmentTooLarge } from './message.service';

/**
 * multipart의 `file` 1개를 메모리로 받는다 (저장은 StorageService가 한다).
 * Nest 기본 FileInterceptor를 감싸 용량 초과를 한국어 업무 오류로 바꾼다.
 */
@Injectable()
export class AttachmentInterceptor implements NestInterceptor {
  // defParamCharset: 브라우저는 파일 이름을 UTF-8로 보내는데 multer 기본값(latin1)이면 한글 이름이 깨진다
  private readonly inner: NestInterceptor = new (FileInterceptor('file', { limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1 }, defParamCharset: 'utf8' }))();

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    try {
      return await this.inner.intercept(context, next);
    } catch (error) {
      if (error instanceof PayloadTooLargeException) throw attachmentTooLarge();
      throw error;
    }
  }
}
