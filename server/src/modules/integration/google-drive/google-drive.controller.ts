import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { pipeline } from 'node:stream';
import type { Request, Response } from 'express';
import type { DriveFilePage } from '@fantasteel/shared';
import { DriveContentQuery, ListDriveFilesQuery } from '../dto/integration.dto';
import { contentDisposition, isDriveDownloadOnly } from './google-drive.query';
import { GoogleDriveService } from './google-drive.service';

/**
 * 회사 Google Drive 폴더의 녹음·사진·문서 읽기 (문서에 없는 기능, 이슈 #361). 경로는 API 명세서에 없어 새로 정했다.
 * 로그인한 사원 누구나 읽는다: 회사가 녹음·사진·문서를 함께 올리는 폴더이고, 읽기만 하며, 설정한 폴더 밖은 열지 않는다.
 */
@Controller('integrations/google-drive')
export class GoogleDriveController {
  constructor(private readonly service: GoogleDriveService) {}

  /** 폴더 안 녹음(audio)·사진(image)·문서(document), all이면 모두. 최신 수정순 50개. nextPageToken으로 다음 쪽 */
  @Get('files')
  listFiles(@Query() query: ListDriveFilesQuery): Promise<DriveFilePage> {
    return this.service.listFiles(query.kind, query.pageToken);
  }

  /**
   * 파일 내용을 그대로 흘려보낸다 (응답 포맷으로 감싸지 않는다). 폴더 밖·없는 파일은 INT-012, 녹음·사진·문서가 아니면 INT-013, 너무 크면 INT-014.
   * ?download=1이면 attachment로 보내 브라우저가 저장하게 한다 (기본은 inline). Google 문서·스프레드시트·프레젠테이션은 PDF로 내보내 보낸다.
   * Range 한 구간을 받으면 206 + Content-Range (Safari·iOS는 이것이 있어야 오디오를 재생하고, 긴 녹음을 건너뛸 수 있다).
   * 상태 코드(200·206·416)를 직접 정해야 해서 StreamableFile 대신 응답에 바로 흘린다. 오류는 머리를 보내기 전이면 평소처럼 JSON이다.
   * 이 서버 주소로 열리므로 받은 내용이 스크립트로 돌지 않게 sandbox CSP와 nosniff를 붙인다. PDF도 같다:
   * sandbox는 Chrome 내장 PDF 뷰어를 막으므로, 화면은 PDF를 이 주소가 아니라 받아 둔 Blob으로 보여 준다 (CSP를 낮추지 않는다).
   */
  @Get('files/:fileId/content')
  async readContent(@Param('fileId') fileId: string, @Query() query: DriveContentQuery, @Req() req: Request, @Res() res: Response): Promise<void> {
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
    // 내보낸 PDF는 Range를 받지 않는다
    res.setHeader('Accept-Ranges', file.exportMimeType ? 'none' : 'bytes');
    if ('unsatisfiable' in result) {
      if (file.size !== null) res.setHeader('Content-Range', `bytes */${file.size}`);
      res.status(416).end();
      return;
    }
    const { media } = result;
    res.status(media.status);
    res.setHeader('Content-Type', file.contentType);
    // Office 파일은 브라우저가 열지 못하니 inline이어도 저장이 된다: 처음부터 attachment로 밝힌다
    res.setHeader('Content-Disposition', contentDisposition(file.contentName, query.download === '1' || isDriveDownloadOnly(file.mimeType) ? 'attachment' : 'inline'));
    // 길이는 메타데이터가 아니라 Drive 응답의 것: 그 사이 파일이 바뀌어도 길이가 어긋나지 않는다. 없으면 조각 전송
    if (media.length !== null) res.setHeader('Content-Length', String(media.length));
    if (media.contentRange) res.setHeader('Content-Range', media.contentRange);
    // 받는 도중 실패(상한 초과·끊김)면 pipeline이 응답을 끊는다: 잘린 내용을 성공처럼 끝내지 않는다
    pipeline(media.stream, res, () => undefined);
  }
}
