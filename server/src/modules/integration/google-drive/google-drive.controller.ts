import { Controller, Get, Param, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import type { DriveFilePage } from '@fantasteel/shared';
import { ListDriveFilesQuery } from '../dto/integration.dto';
import { contentDisposition } from './google-drive.query';
import { GoogleDriveService } from './google-drive.service';

/**
 * 회사 Google Drive 폴더의 녹음·사진 읽기 (문서에 없는 기능, 이슈 #361). 경로는 API 명세서에 없어 새로 정했다.
 * 로그인한 사원 누구나 읽는다: 회사가 녹음·사진을 함께 올리는 폴더이고, 읽기만 하며, 설정한 폴더 밖은 열지 않는다.
 */
@Controller('integrations/google-drive')
export class GoogleDriveController {
  constructor(private readonly service: GoogleDriveService) {}

  /** 폴더 안 녹음(kind=audio) 또는 사진(kind=image), 최신 수정순 50개. nextPageToken으로 다음 쪽 */
  @Get('files')
  listFiles(@Query() query: ListDriveFilesQuery): Promise<DriveFilePage> {
    return this.service.listFiles(query.kind, query.pageToken);
  }

  /**
   * 파일 내용을 그대로 흘려보낸다 (응답 포맷으로 감싸지 않는다). 폴더 밖·없는 파일은 INT-012, 녹음·사진이 아니면 INT-013, 너무 크면 INT-014.
   * 이 서버 주소로 열리므로 받은 내용이 스크립트로 돌지 않게 sandbox CSP와 nosniff를 붙인다.
   */
  @Get('files/:fileId/content')
  async readContent(@Param('fileId') fileId: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const abort = new AbortController();
    // 브라우저가 다 받기 전에 떠나면 Google 요청도 끊는다
    res.on('close', () => abort.abort());
    const { file, stream } = await this.service.openContent(fileId, abort.signal);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', 'sandbox');
    res.setHeader('Cache-Control', 'private, max-age=300');
    const streamable = new StreamableFile(stream, {
      type: file.mimeType,
      disposition: contentDisposition(file.name),
      ...(file.size !== null ? { length: file.size } : {}),
    });
    // 받는 도중 실패(상한 초과·끊김)면 잘린 내용을 성공처럼 끝내지 않고 연결을 끊는다
    streamable.setErrorHandler(() => {
      if (!res.destroyed) res.destroy();
    });
    return streamable;
  }
}
