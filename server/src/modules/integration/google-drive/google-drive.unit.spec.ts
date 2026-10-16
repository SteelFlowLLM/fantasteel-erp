// Google Drive 연결의 순수 함수: 폴더 주소 읽기, 토큰 응답 읽기·만료, 허용 화면 주소, Drive 검색어·파일 읽기 (DB 없음)
import { DRIVE_IMAGE_MAX_BYTES, MEETING_AUDIO_MAX_BYTES } from '@fantasteel/shared';
import {
  buildDriveFolderQuery,
  buildDriveListQuery,
  contentDisposition,
  driveFileKind,
  driveMaxBytes,
  normalizeDriveFolderId,
  readDriveFile,
  toDriveFileView,
} from './google-drive.query';
import {
  buildAuthorizationUrl,
  classifyTokenFailure,
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

  it('사진: image/*에서 SVG를 뺀다', () => {
    expect(buildDriveListQuery(FOLDER, 'image')).toBe(`'${FOLDER}' in parents and trashed = false and (mimeType contains 'image/' and mimeType != 'image/svg+xml')`);
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
    expect(driveFileKind('application/pdf', '보고서.pdf')).toBeNull();
    expect(driveFileKind('application/vnd.google-apps.document', '문서')).toBeNull();
  });

  it('상한: 녹음은 회의 음성 상한, 사진은 20MB', () => {
    expect(driveMaxBytes('audio')).toBe(MEETING_AUDIO_MAX_BYTES);
    expect(driveMaxBytes('image')).toBe(DRIVE_IMAGE_MAX_BYTES);
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
    expect(meta && toDriveFileView(meta)).not.toHaveProperty('parents');
    expect(readDriveFile({ id: 'f2', name: 'a', mimeType: 'image/png', thumbnailLink: 'javascript:x' })).toMatchObject({ size: null, thumbnailLink: null, parents: [], trashed: false });
    expect(readDriveFile({ id: 'f3', name: 'a' })).toBeNull();
    expect(readDriveFile(null)).toBeNull();
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
    const previous = { accessToken: 'a1', refreshToken: 'r1', expiresAt: now, scope: 'x y' };
    expect(parseTokenResponse({ access_token: 'a2', expires_in: '120' }, now, previous)).toEqual({ accessToken: 'a2', refreshToken: 'r1', expiresAt: now + 120_000, scope: 'x y' });
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

  it('테스트 주소 바꾸기는 운영에서 무시한다', () => {
    const saved = { origin: process.env.GOOGLE_API_TEST_ORIGIN, env: process.env.NODE_ENV };
    try {
      process.env.GOOGLE_API_TEST_ORIGIN = 'http://127.0.0.1:9/';
      expect(googleEndpoints().token).toBe('http://127.0.0.1:9/token');
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
