// Google Drive 연결의 순수 함수: 폴더 주소 읽기, 토큰 응답 읽기·만료, 허용 화면 주소, Drive 검색어·파일 읽기, Range,
// 내용 스트림 지키기(상한·기다림)·메모리로 받기 (DB 없음)
import { pipeline, Readable, Writable } from 'node:stream';
import { DRIVE_DOCUMENT_MAX_BYTES, DRIVE_EXPORT_MAX_BYTES, DRIVE_FILE_LIST_KINDS, DRIVE_IMAGE_MAX_BYTES, MEETING_AUDIO_MAX_BYTES } from '@fantasteel/shared';
import { AppException } from '../../../common/errors/app.exception';
import { guardStream, readStreamToBuffer } from './google-drive.client';
import {
  buildDriveFolderQuery,
  buildDriveListQuery,
  contentDisposition,
  driveDelivery,
  driveFileKind,
  driveMaxBytes,
  isDriveDownloadOnly,
  isDriveGoogleDoc,
  normalizeDriveFolderId,
  parseRangeHeader,
  readDriveFile,
  toDriveFileView,
} from './google-drive.query';
import {
  buildAuthorizationUrl,
  classifyTokenFailure,
  clientInputError,
  createPkcePair,
  GoogleTokenResponseError,
  googleEndpoints,
  hasDriveReadScope,
  isAccessTokenFresh,
  isGoogleClientId,
  isGoogleTokens,
  parseTokenResponse,
  pkceChallenge,
  TOKEN_REFRESH_MARGIN_MS,
} from './google-oauth';

const FOLDER = '1AbCdEfGhIjKlMnOpQrStUvWxYz_-0123';

describe('normalizeDriveFolderId', () => {
  it('id를 그대로 받는다 (공유 드라이브 최상위 19자 포함)', () => {
    expect(normalizeDriveFolderId(FOLDER)).toBe(FOLDER);
    expect(normalizeDriveFolderId(`  ${FOLDER}  `)).toBe(FOLDER);
    expect(normalizeDriveFolderId('0AAbCdEfGhIjUk9PVA0')).toBe('0AAbCdEfGhIjUk9PVA0');
  });

  it('폴더 주소의 여러 모양에서 id를 읽는다', () => {
    expect(normalizeDriveFolderId(`https://drive.google.com/drive/folders/${FOLDER}`)).toBe(FOLDER);
    expect(normalizeDriveFolderId(`https://drive.google.com/drive/folders/${FOLDER}?usp=sharing`)).toBe(FOLDER);
    expect(normalizeDriveFolderId(`https://drive.google.com/drive/u/1/folders/${FOLDER}/`)).toBe(FOLDER);
    expect(normalizeDriveFolderId(`https://drive.google.com/drive/mobile/folders/${FOLDER}?usp=drive_link`)).toBe(FOLDER);
    expect(normalizeDriveFolderId(`drive.google.com/drive/folders/${FOLDER}`)).toBe(FOLDER);
    expect(normalizeDriveFolderId(`https://drive.google.com/open?id=${FOLDER}`)).toBe(FOLDER);
    expect(normalizeDriveFolderId(`https://drive.google.com/embeddedfolderview?id=${FOLDER}#list`)).toBe(FOLDER);
  });

  it('파일 주소·내 드라이브·다른 호스트·짧거나 이상한 값은 거절한다', () => {
    expect(normalizeDriveFolderId(`https://drive.google.com/file/d/${FOLDER}/view`)).toBeNull();
    expect(normalizeDriveFolderId('https://drive.google.com/drive/my-drive')).toBeNull();
    expect(normalizeDriveFolderId(`https://evil.example.com/drive/folders/${FOLDER}`)).toBeNull();
    expect(normalizeDriveFolderId(`https://drive.google.com.evil.com/drive/folders/${FOLDER}`)).toBeNull();
    expect(normalizeDriveFolderId(`javascript:alert(1)//drive.google.com/drive/folders/${FOLDER}`)).toBeNull();
    expect(normalizeDriveFolderId('root')).toBeNull();
    expect(normalizeDriveFolderId("abc' or 1=1 or 'x")).toBeNull();
    expect(normalizeDriveFolderId('')).toBeNull();
  });
});

describe('Drive 검색어', () => {
  it('녹음: 설정한 폴더 바로 아래, 휴지통 제외, 오디오·브라우저 녹음 MIME', () => {
    expect(buildDriveListQuery(FOLDER, 'audio')).toBe(
      `'${FOLDER}' in parents and trashed = false and (mimeType contains 'audio/' or mimeType = 'video/webm' or mimeType = 'video/mp4')`,
    );
  });

  it('사진: 허용 목록의 형식만', () => {
    expect(buildDriveListQuery(FOLDER, 'image')).toBe(
      `'${FOLDER}' in parents and trashed = false and (mimeType = 'image/jpeg' or mimeType = 'image/png' or mimeType = 'image/gif' or mimeType = 'image/webp' or mimeType = 'image/heic' or mimeType = 'image/heif' or mimeType = 'image/bmp' or mimeType = 'image/tiff')`,
    );
  });

  it('문서: PDF·Office·Google 문서·스프레드시트·프레젠테이션', () => {
    const query = buildDriveListQuery(FOLDER, 'document');
    expect(query.startsWith(`'${FOLDER}' in parents and trashed = false and (mimeType = 'application/pdf'`)).toBe(true);
    for (const mime of [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.google-apps.document',
      'application/vnd.google-apps.spreadsheet',
      'application/vnd.google-apps.presentation',
    ]) {
      expect(query).toContain(`mimeType = '${mime}'`);
    }
    // 폴더·Google 양식 같은 것은 검색어에 없다
    expect(query).not.toContain('google-apps.folder');
    expect(query).not.toContain('google-apps.form');
  });

  it('all: 녹음·사진·문서를 한 검색어에 묶는다', () => {
    const query = buildDriveListQuery(FOLDER, 'all');
    expect(query).toContain("mimeType contains 'audio/'");
    expect(query).toContain("mimeType = 'image/jpeg'");
    expect(query).toContain("mimeType = 'application/pdf'");
    expect(query.startsWith(`'${FOLDER}' in parents and trashed = false and ((`)).toBe(true);
    expect(DRIVE_FILE_LIST_KINDS).toEqual(['audio', 'image', 'document', 'all']);
  });

  it('따옴표·역슬래시를 막는다', () => {
    expect(buildDriveFolderQuery("a'b\\c")).toBe("'a\\'b\\\\c' in parents and trashed = false");
  });
});

describe('파일 종류·크기', () => {
  it('녹음은 회의 음성 올리기와 같게 판정한다', () => {
    expect(driveFileKind('audio/mp4', '회의.m4a')).toBe('audio');
    expect(driveFileKind('video/webm', 'rec.webm')).toBe('audio');
    expect(driveFileKind('application/octet-stream', '회의.mp3')).toBe('audio');
    expect(driveFileKind('image/jpeg', '현장.jpg')).toBe('image');
    expect(driveFileKind('image/svg+xml', 'logo.svg')).toBeNull();
    // 대소문자·매개변수와 상관없이: 대문자 SVG도 빼고 대문자 JPEG는 받는다. 목록에 없는 형식(ico)은 뺀다
    expect(driveFileKind('IMAGE/SVG+XML', 'LOGO.SVG')).toBeNull();
    expect(driveFileKind('Image/Svg+Xml; charset=utf-8', 'x.svg')).toBeNull();
    expect(driveFileKind('IMAGE/JPEG', 'A.JPG')).toBe('image');
    expect(driveFileKind('image/x-icon', 'favicon.ico')).toBeNull();
    expect(driveFileKind('AUDIO/MPEG', 'A.MP3')).toBe('audio');
    expect(driveFileKind('application/pdf', '보고서.pdf')).toBe('document');
    expect(driveFileKind('APPLICATION/PDF', '보고서.PDF')).toBe('document');
    expect(driveFileKind('application/vnd.google-apps.document', '문서')).toBe('document');
    expect(driveFileKind('application/vnd.google-apps.spreadsheet', '시트')).toBe('document');
    expect(driveFileKind('application/vnd.google-apps.presentation', '발표')).toBe('document');
    expect(driveFileKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document', '견적.docx')).toBe('document');
    // 폴더·바로가기·양식·HTML·압축 파일은 문서가 아니다
    for (const mime of ['application/vnd.google-apps.folder', 'application/vnd.google-apps.shortcut', 'application/vnd.google-apps.form', 'text/html', 'application/zip']) {
      expect(driveFileKind(mime, 'x')).toBeNull();
    }
  });

  it('상한: 녹음은 회의 음성 상한, 사진은 20MB, 문서는 50MB, Google 문서는 내보내기 상한 10MB', () => {
    expect(driveMaxBytes('audio')).toBe(MEETING_AUDIO_MAX_BYTES);
    expect(driveMaxBytes('image')).toBe(DRIVE_IMAGE_MAX_BYTES);
    expect(driveMaxBytes('document', 'application/pdf')).toBe(DRIVE_DOCUMENT_MAX_BYTES);
    expect(driveMaxBytes('document', 'application/vnd.google-apps.spreadsheet')).toBe(DRIVE_EXPORT_MAX_BYTES);
    expect(DRIVE_EXPORT_MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  it('Google 문서류는 PDF로 내보내 보낸다 (MIME·이름), 나머지는 그대로', () => {
    expect(isDriveGoogleDoc('application/vnd.google-apps.document')).toBe(true);
    expect(isDriveGoogleDoc('application/pdf')).toBe(false);
    expect(driveDelivery({ mimeType: 'application/vnd.google-apps.document', name: '회의 안건' })).toEqual({ mimeType: 'application/pdf', name: '회의 안건.pdf' });
    expect(driveDelivery({ mimeType: 'application/vnd.google-apps.document', name: '계약서.PDF' })).toEqual({ mimeType: 'application/pdf', name: '계약서.PDF' });
    expect(driveDelivery({ mimeType: 'application/pdf', name: '보고서.pdf' })).toEqual({ mimeType: 'application/pdf', name: '보고서.pdf' });
    expect(driveDelivery({ mimeType: 'image/png', name: 'a.png' })).toEqual({ mimeType: 'image/png', name: 'a.png' });
  });

  it('Office 파일만 내려받기 전용이다 (PDF·사진·녹음은 열어 볼 수 있다)', () => {
    expect(isDriveDownloadOnly('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(true);
    expect(isDriveDownloadOnly('application/pdf')).toBe(false);
    expect(isDriveDownloadOnly('application/vnd.google-apps.spreadsheet')).toBe(false);
    expect(isDriveDownloadOnly('image/png')).toBe(false);
  });

  it('Drive 응답을 읽는다: 문자열 크기, 없는 칸, https가 아닌 미리보기', () => {
    const meta = readDriveFile({
      id: 'f1',
      name: '회의.m4a',
      mimeType: 'audio/mp4',
      size: '12345',
      modifiedTime: '2026-10-16T01:02:03.000Z',
      thumbnailLink: 'https://lh3.googleusercontent.com/x',
      parents: [FOLDER, 3],
      trashed: false,
    });
    expect(meta).toEqual({
      id: 'f1',
      name: '회의.m4a',
      mimeType: 'audio/mp4',
      size: 12345,
      modifiedTime: '2026-10-16T01:02:03.000Z',
      thumbnailLink: 'https://lh3.googleusercontent.com/x',
      parents: [FOLDER],
      trashed: false,
    });
    expect(meta && toDriveFileView(meta, 'audio')).not.toHaveProperty('parents');
    expect(meta && toDriveFileView(meta, 'audio')).toMatchObject({ kind: 'audio', id: 'f1' });
    expect(readDriveFile({ id: 'f2', name: 'a', mimeType: 'image/png', thumbnailLink: 'javascript:x' })).toMatchObject({ size: null, thumbnailLink: null, parents: [], trashed: false });
    expect(readDriveFile({ id: 'f3', name: 'a' })).toBeNull();
    expect(readDriveFile(null)).toBeNull();
  });

  it('Content-Disposition: 내려받기는 attachment, 기본은 inline', () => {
    expect(contentDisposition('보고서.pdf')).toMatch(/^inline; /);
    expect(contentDisposition('보고서.pdf', 'attachment')).toBe(`attachment; filename="___.pdf"; filename*=UTF-8''${encodeURIComponent('보고서.pdf')}`);
    expect(contentDisposition('\uD800abc.pdf', 'attachment')).toBe('attachment; filename="_abc.pdf"');
  });

  it('Content-Disposition: 짝 없는 대리 문자로 인코딩할 수 없으면 ASCII 이름만', () => {
    expect(contentDisposition('\uD800abc.png')).toBe('inline; filename="_abc.png"');
  });

  it('Content-Disposition: 한글 이름은 RFC 5987, 따옴표 안은 ASCII만', () => {
    expect(contentDisposition('회의 "1".m4a')).toBe(`inline; filename="__ _1_.m4a"; filename*=UTF-8''${encodeURIComponent('회의 "1".m4a')}`);
  });
});

describe('토큰 응답', () => {
  const now = 1_700_000_000_000;

  it('인가 코드 교환 응답을 저장 모양으로 읽는다', () => {
    expect(parseTokenResponse({ access_token: 'a1', refresh_token: 'r1', expires_in: 3599, scope: 'x y', token_type: 'Bearer' }, now)).toEqual({
      accessToken: 'a1',
      refreshToken: 'r1',
      expiresAt: now + 3_599_000,
      scope: 'x y',
    });
  });

  it('갱신 응답에 없는 리프레시 토큰·권한은 이전 값을 잇는다. expires_in이 문자열이거나 없어도 읽는다', () => {
    const previous = { accessToken: 'a1', refreshToken: 'r1', expiresAt: now, scope: 'x y', accountId: 'acct-1' };
    expect(parseTokenResponse({ access_token: 'a2', expires_in: '120' }, now, previous)).toEqual({ accessToken: 'a2', refreshToken: 'r1', expiresAt: now + 120_000, scope: 'x y', accountId: 'acct-1' });
    expect(parseTokenResponse({ access_token: 'a3' }, now, previous).expiresAt).toBe(now + 3_600_000);
  });

  it('액세스 토큰·리프레시 토큰이 없거나 Bearer가 아니면 거절한다', () => {
    expect(() => parseTokenResponse({ refresh_token: 'r' }, now)).toThrow(GoogleTokenResponseError);
    expect(() => parseTokenResponse({ access_token: 'a' }, now)).toThrow(/리프레시 토큰/);
    expect(() => parseTokenResponse({ access_token: 'a', refresh_token: 'r', token_type: 'mac' }, now)).toThrow(GoogleTokenResponseError);
    expect(() => parseTokenResponse('nope', now)).toThrow(GoogleTokenResponseError);
  });

  it('만료 1분 전부터 갱신 대상이다', () => {
    const tokens = { accessToken: 'a', refreshToken: 'r', expiresAt: now + TOKEN_REFRESH_MARGIN_MS + 1, scope: '' };
    expect(isAccessTokenFresh(tokens, now)).toBe(true);
    expect(isAccessTokenFresh({ ...tokens, expiresAt: now + TOKEN_REFRESH_MARGIN_MS }, now)).toBe(false);
  });

  it('저장 모양 확인', () => {
    expect(isGoogleTokens({ accessToken: 'a', refreshToken: 'r', expiresAt: 1, scope: '' })).toBe(true);
    expect(isGoogleTokens({ access_token: 'a' })).toBe(false);
  });

  it('Drive 읽기 권한이 있는지', () => {
    expect(hasDriveReadScope('openid https://www.googleapis.com/auth/drive.readonly')).toBe(true);
    expect(hasDriveReadScope('https://www.googleapis.com/auth/drive')).toBe(true);
    expect(hasDriveReadScope('https://www.googleapis.com/auth/drive.file')).toBe(false);
  });

  it('토큰 요청 실패 종류', () => {
    expect(classifyTokenFailure(400, { error: 'invalid_grant' }).kind).toBe('invalid_grant');
    expect(classifyTokenFailure(401, { error: 'invalid_client' }).kind).toBe('invalid_client');
    expect(classifyTokenFailure(400, { error: 'unauthorized_client' }).kind).toBe('invalid_client');
    expect(classifyTokenFailure(503, null).kind).toBe('transient');
    expect(classifyTokenFailure(429, { error: 'rate_limit' }).kind).toBe('transient');
    expect(classifyTokenFailure(400, { error: 'invalid_request' }).kind).toBe('other');
  });
});

describe('허용 화면 주소·PKCE', () => {
  it('Google 표준 주소에 오프라인 접근·동의·PKCE S256·두 권한을 붙인다', () => {
    const { verifier, challenge } = createPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(pkceChallenge(verifier));
    const url = new URL(
      buildAuthorizationUrl('https://accounts.google.com/o/oauth2/v2/auth', { clientId: 'c.apps.googleusercontent.com', redirectUri: 'https://erp.test/api/v1/integrations/oauth/callback', state: 's1', codeChallenge: challenge }),
    );
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'c.apps.googleusercontent.com',
      redirect_uri: 'https://erp.test/api/v1/integrations/oauth/callback',
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file',
      access_type: 'offline',
      prompt: 'consent',
      state: 's1',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
  });

  it('RFC 7636 부록 B 예시와 같은 challenge', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('client id 모양', () => {
    expect(isGoogleClientId('123-abc.apps.googleusercontent.com')).toBe(true);
    expect(isGoogleClientId('123-abc')).toBe(false);
    expect(isGoogleClientId('x.apps.googleusercontent.com.evil')).toBe(false);
  });

  it('client id·secret 입력 확인 (비우기는 통과)', () => {
    expect(clientInputError({ clientId: '1-a.apps.googleusercontent.com', clientSecret: 'GOCSPX-x' })).toBeNull();
    expect(clientInputError({ clientId: null, clientSecret: '' })).toBeNull();
    expect(clientInputError({ clientId: 'nope' })).toMatch(/apps\.googleusercontent\.com/);
    expect(clientInputError({ clientSecret: 'a b' })).toMatch(/client secret/);
  });

  it('테스트 주소 바꾸기는 NODE_ENV=test일 때만 읽는다', () => {
    const saved = { origin: process.env.GOOGLE_API_TEST_ORIGIN, env: process.env.NODE_ENV };
    try {
      process.env.GOOGLE_API_TEST_ORIGIN = 'http://127.0.0.1:9/';
      process.env.NODE_ENV = 'test';
      expect(googleEndpoints().token).toBe('http://127.0.0.1:9/token');
      // 테스트가 아니면 개발(값 없음·development)·운영 모두 무시한다
      for (const env of ['production', 'development', '']) {
        process.env.NODE_ENV = env;
        expect(googleEndpoints().token).toBe('https://oauth2.googleapis.com/token');
      }
      process.env.NODE_ENV = 'production';
      expect(googleEndpoints()).toEqual({
        authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
        token: 'https://oauth2.googleapis.com/token',
        revoke: 'https://oauth2.googleapis.com/revoke',
        drive: 'https://www.googleapis.com/drive/v3',
      });
    } finally {
      if (saved.origin === undefined) delete process.env.GOOGLE_API_TEST_ORIGIN;
      else process.env.GOOGLE_API_TEST_ORIGIN = saved.origin;
      process.env.NODE_ENV = saved.env;
    }
  });
});

describe('parseRangeHeader', () => {
  it('한 구간만 Drive로 넘긴다', () => {
    expect(parseRangeHeader('bytes=0-99', 1000)).toEqual({ range: 'bytes=0-99' });
    expect(parseRangeHeader('bytes=500-', 1000)).toEqual({ range: 'bytes=500-' });
    expect(parseRangeHeader('bytes=-200', 1000)).toEqual({ range: 'bytes=-200' });
    expect(parseRangeHeader(' bytes=0-0 ', null)).toEqual({ range: 'bytes=0-0' });
  });

  it('없거나 여러 구간·다른 단위·거꾸로·빈 범위는 무시(전체)', () => {
    for (const header of [undefined, '', 'bytes=0-1,5-6', 'items=0-1', 'bytes=9-3', 'bytes=-', 'bytes=a-b', 'bytes=99999999999999999999-']) {
      expect([header, parseRangeHeader(header, 1000)]).toEqual([header, null]);
    }
  });

  it('크기를 넘는 시작·0바이트 끝 범위는 416', () => {
    expect(parseRangeHeader('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(parseRangeHeader('bytes=-0', 1000)).toBe('unsatisfiable');
    // 크기를 모르면 Drive에 맡긴다
    expect(parseRangeHeader('bytes=1000-', null)).toEqual({ range: 'bytes=1000-' });
  });
});

/** 조각을 주는 대로 내보내고, 다 주면 끝나는 소스. stallAfter개 뒤에는 멈춘다(끝나지 않는다) */
function sourceOf(chunks: Buffer[], stallAfter = Infinity): Readable {
  let i = 0;
  return new Readable({
    read() {
      if (i >= stallAfter) return;
      if (i >= chunks.length) {
        this.push(null);
        return;
      }
      this.push(chunks[i]);
      i += 1;
    },
  });
}

describe('guardStream', () => {
  const kb = (n: number) => Buffer.alloc(n * 1024, 7);

  it('받는 쪽이 느려 소스가 멈춘 동안은 기다림 시간을 재지 않는다 (멈춘 재생·느린 회선)', async () => {
    const abort = jest.fn();
    const guarded = guardStream(sourceOf(Array.from({ length: 64 }, () => kb(64))), 100 * 1024 * 1024, abort, 50);
    // 처음 조금만 읽고 기다림 상한의 몇 배 동안 읽지 않는다
    await new Promise<void>((resolve) => guarded.once('readable', () => resolve()));
    guarded.read();
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(guarded.destroyed).toBe(false);
    const rest = await readStreamToBuffer(guarded, null);
    expect(rest.length).toBeGreaterThan(0);
    expect(abort).not.toHaveBeenCalled();
  });

  it('소스(Google)가 조각을 보내지 않으면 끊고 Google 요청도 끊는다', async () => {
    const abort = jest.fn();
    const guarded = guardStream(sourceOf([kb(1), kb(1), kb(1)], 1), 1024 * 1024, abort, 50);
    const error = await readStreamToBuffer(guarded, null).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).code).toBe('INT-004');
    expect(abort).toHaveBeenCalled();
  });

  it('상한을 넘으면 INT-014로 끊는다', async () => {
    const abort = jest.fn();
    const guarded = guardStream(sourceOf([kb(1), kb(1), kb(1)]), 2 * 1024, abort, 1000);
    await expect(readStreamToBuffer(guarded, null)).rejects.toMatchObject({ code: 'INT-014' });
    expect(abort).toHaveBeenCalled();
  });

  it('받는 쪽이 중간에 끊으면 Google 요청도 끊는다', async () => {
    const abort = jest.fn();
    const guarded = guardStream(sourceOf(Array.from({ length: 10 }, () => kb(64))), 100 * 1024 * 1024, abort, 1000);
    const sink = new Writable({
      write(_chunk, _enc, callback) {
        sink.destroy();
        callback();
      },
    });
    // controller·전사 작업처럼 pipeline으로 이어 받는 쪽이 끊으면 지키는 스트림도 닫힌다
    pipeline(guarded, sink, () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(abort).toHaveBeenCalled();
  });
});

describe('readStreamToBuffer', () => {
  const parts = [Buffer.from('abc'), Buffer.from('defg'), Buffer.from('h')];

  it('크기를 알면 한 번 잡은 메모리에 채운다', async () => {
    expect((await readStreamToBuffer(Readable.from(parts), 8)).toString()).toBe('abcdefgh');
  });

  it('덜 오거나 더 오거나 모르면 받은 그대로', async () => {
    expect((await readStreamToBuffer(Readable.from(parts), 20)).toString()).toBe('abcdefgh');
    expect((await readStreamToBuffer(Readable.from(parts), 5)).toString()).toBe('abcdefgh');
    expect((await readStreamToBuffer(Readable.from(parts), null)).toString()).toBe('abcdefgh');
    expect((await readStreamToBuffer(Readable.from([]), 4)).length).toBe(0);
  });
});
