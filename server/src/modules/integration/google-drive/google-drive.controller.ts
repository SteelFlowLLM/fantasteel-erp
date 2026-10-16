import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { pipeline } from 'node:stream';
import type { Request, Response } from 'express';
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
   * Range 한 구간을 받으면 206 + Content-Range (Safari·iOS는 이것이 있어야 오디오를 재생하고, 긴 녹음을 건너뛸 수 있다).
   * 상태 코드(200·206·416)를 직접 정해야 해서 StreamableFile 대신 응답에 바로 흘린다. 오류는 머리를 보내기 전이면 평소처럼 JSON이다.
   * 이 서버 주소로 열리므로 받은 내용이 스크립트로 돌지 않게 sandbox CSP와 nosniff를 붙인다.
   */
  @Get('files/:fileId/content')
  async readContent(@Param('fileId') fileId: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const abort = new AbortController();
    // 브라우저가 다 받기 전에 떠나면 Google 요청도 끊는다
    res.on('close', () => abort.abort());
    let result: Awaited<ReturnType<GoogleDriveService['openContent']>>;
    try {
      result = await this.service.openContent(fileId, { signal: abort.signal, range: req.headers.range });
    } catch (error) {
      // 브라우저가 이미 떠났으면 답할 곳이 없다
      if (abort.signal.aborted) return;
      throw error;
    }
    const { file } = result;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', 'sandbox');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Accept-Ranges', 'bytes');
    if ('unsatisfiable' in result) {
      if (file.size !== null) res.setHeader('Content-Range', `bytes */${file.size}`);
      res.status(416).end();
      return;
    }
    const { media } = result;
    res.status(media.status);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', contentDisposition(file.name));
    // 길이는 메타데이터가 아니라 Drive 응답의 것: 그 사이 파일이 바뀌어도 길이가 어긋나지 않는다. 없으면 조각 전송
    if (media.length !== null) res.setHeader('Content-Length', String(media.length));
    if (media.contentRange) res.setHeader('Content-Range', media.contentRange);
    // 받는 도중 실패(상한 초과·끊김)면 pipeline이 응답을 끊는다: 잘린 내용을 성공처럼 끝내지 않는다
    pipeline(media.stream, res, () => undefined);
  }
}
