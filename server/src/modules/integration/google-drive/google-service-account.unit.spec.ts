// Google 서비스 계정(이슈 #395) 순수 단위: 키 읽기(파일·JSON·base64·잘못된 값), JWT 서명, .env 폴더, 토큰 기억·한 번만 요청.
import { generateKeyPairSync, verify } from 'node:crypto';
import { resolve } from 'node:path';
import { AppException } from '../../../common/errors/app.exception';
import { effectiveDriveFolder, loadServiceAccountConfig, parseServiceAccountKey, readEnvDriveFolder, serviceAccountSignature } from './google-drive.env';
import { buildServiceAccountAssertion, GoogleServiceAccount, JWT_BEARER_GRANT_TYPE, parseServiceAccountTokenResponse, SERVICE_ACCOUNT_SCOPE } from './google-service-account';

const EMAIL = 'erp-drive@fantasteel-erp.iam.gserviceaccount.com';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

function keyJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'service_account',
    project_id: 'fantasteel-erp',
    private_key_id: 'abc123',
    private_key: PEM,
    client_email: EMAIL,
    token_uri: 'https://oauth2.googleapis.com/token',
    ...overrides,
  });
}

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('parseServiceAccountKey', () => {
  it('Cloud Console JSON을 그대로, 또는 base64로 받는다', () => {
    expect(parseServiceAccountKey(keyJson()).clientEmail).toBe(EMAIL);
    expect(parseServiceAccountKey(`  ${Buffer.from(keyJson()).toString('base64')}\n`).clientEmail).toBe(EMAIL);
    expect(parseServiceAccountKey(keyJson()).privateKey.asymmetricKeyType).toBe('rsa');
  });

  it('줄바꿈이 글자 \\n으로 남은 개인 키도 읽는다', () => {
    expect(parseServiceAccountKey(keyJson({ private_key: PEM.replace(/\n/g, '\\n') })).clientEmail).toBe(EMAIL);
  });

  it('JSON·서비스 계정이 아니거나 칸이 없거나 키가 깨졌으면 키 내용 없이 거절한다', () => {
    const cases: [string, RegExp][] = [
      ['not json at all', /읽지 못했어요/],
      ['{"type":', /JSON이 아니에요/],
      ['{"client_email":"a@b.co"}', /서비스 계정 키가 아니에요/],
      [keyJson({ type: 'authorized_user' }), /서비스 계정 키가 아니에요/],
      [JSON.stringify({ web: { client_id: 'x.apps.googleusercontent.com' } }), /서비스 계정 키가 아니에요/],
      [keyJson({ client_email: undefined }), /client_email/],
      [keyJson({ client_email: 'not-an-email' }), /client_email/],
      [keyJson({ private_key: '' }), /private_key가 없어요/],
      [keyJson({ private_key: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n' }), /private_key를 읽지 못했어요/],
    ];
    for (const [raw, message] of cases) {
      expect(() => parseServiceAccountKey(raw)).toThrow(message);
    }
    try {
      parseServiceAccountKey(keyJson({ type: 'other' }));
    } catch (error) {
      expect((error as Error).message).not.toContain('PRIVATE KEY');
    }
  });

  it('RSA가 아닌 키는 거절한다', () => {
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    expect(() => parseServiceAccountKey(keyJson({ private_key: ec }))).toThrow(/RSA/);
  });
});

describe('loadServiceAccountConfig', () => {
  // 상대 경로는 운영체제 방식으로 풀린다 (Windows에서는 D:\srv\server\...)
  const files: Record<string, string> = { [resolve('/srv/server', 'secrets/key.json')]: keyJson(), '/abs/key.json': keyJson({ client_email: 'abs@p.iam.gserviceaccount.com' }) };
  const readFile = (path: string): string => {
    const content = files[path];
    if (content === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return content;
  };

  it('아무것도 넣지 않으면 서비스 계정을 쓰지 않는다', () => {
    expect(loadServiceAccountConfig({}, '/srv/server', readFile)).toEqual({ configured: false });
    expect(loadServiceAccountConfig({ GOOGLE_SERVICE_ACCOUNT_KEY: '  ', GOOGLE_SERVICE_ACCOUNT_KEY_FILE: '' }, '/srv/server', readFile)).toEqual({ configured: false });
  });

  it('상대 경로는 서버 폴더 기준, 절대 경로는 그대로 읽는다', () => {
    const relative = loadServiceAccountConfig({ GOOGLE_SERVICE_ACCOUNT_KEY_FILE: 'secrets/key.json' }, '/srv/server', readFile);
    expect(relative.configured && relative.key?.clientEmail).toBe(EMAIL);
    const absolute = loadServiceAccountConfig({ GOOGLE_SERVICE_ACCOUNT_KEY_FILE: '/abs/key.json' }, '/srv/server', readFile);
    expect(absolute.configured && absolute.key?.clientEmail).toBe('abs@p.iam.gserviceaccount.com');
  });

  it('값(JSON·base64)으로도 받고, 둘 다 있으면 파일이 먼저다', () => {
    const inline = loadServiceAccountConfig({ GOOGLE_SERVICE_ACCOUNT_KEY: Buffer.from(keyJson({ client_email: 'inline@p.iam.gserviceaccount.com' })).toString('base64') }, '/srv/server', readFile);
    expect(inline.configured && inline.key?.clientEmail).toBe('inline@p.iam.gserviceaccount.com');
    const both = loadServiceAccountConfig({ GOOGLE_SERVICE_ACCOUNT_KEY_FILE: '/abs/key.json', GOOGLE_SERVICE_ACCOUNT_KEY: keyJson() }, '/srv/server', readFile);
    expect(both.configured && both.key?.clientEmail).toBe('abs@p.iam.gserviceaccount.com');
  });

  it('없는 파일·잘못된 값은 넣었지만 쓸 수 없는 상태로, 어느 변수인지 알린다', () => {
    expect(loadServiceAccountConfig({ GOOGLE_SERVICE_ACCOUNT_KEY_FILE: 'secrets/none.json' }, '/srv/server', readFile)).toEqual({
      configured: true,
      key: null,
      error: `GOOGLE_SERVICE_ACCOUNT_KEY_FILE: 키 파일을 찾을 수 없어요 (${resolve('/srv/server', 'secrets/none.json')})`,
    });
    const bad = loadServiceAccountConfig({ GOOGLE_SERVICE_ACCOUNT_KEY: keyJson({ type: 'x' }) }, '/srv/server', readFile);
    expect(bad).toMatchObject({ configured: true, key: null });
    expect(bad.configured && bad.error).toMatch(/^GOOGLE_SERVICE_ACCOUNT_KEY: 서비스 계정 키가 아니에요/);
  });

  it('설정 서명은 두 값이 바뀔 때만 바뀐다', () => {
    expect(serviceAccountSignature({ GOOGLE_SERVICE_ACCOUNT_KEY_FILE: ' a ' })).toBe(serviceAccountSignature({ GOOGLE_SERVICE_ACCOUNT_KEY_FILE: 'a', OTHER: 'x' }));
    expect(serviceAccountSignature({ GOOGLE_SERVICE_ACCOUNT_KEY_FILE: 'a' })).not.toBe(serviceAccountSignature({ GOOGLE_SERVICE_ACCOUNT_KEY: 'a' }));
  });
});

describe('GOOGLE_DRIVE_FOLDER', () => {
  const FOLDER = '1FolderAbCdEfGhIjKlMnOpQrStUv';

  it('넣지 않으면 화면에서 저장한 폴더를 쓴다', () => {
    expect(readEnvDriveFolder({})).toBeNull();
    expect(effectiveDriveFolder('saved000000000000000', {})).toEqual({ folderId: 'saved000000000000000', fromEnv: false, error: null });
    expect(effectiveDriveFolder(undefined, {})).toEqual({ folderId: null, fromEnv: false, error: null });
  });

  it('주소·id를 읽어 화면 폴더보다 먼저 쓴다', () => {
    expect(effectiveDriveFolder('saved000000000000000', { GOOGLE_DRIVE_FOLDER: `https://drive.google.com/drive/folders/${FOLDER}?usp=sharing` })).toEqual({ folderId: FOLDER, fromEnv: true, error: null });
    expect(readEnvDriveFolder({ GOOGLE_DRIVE_FOLDER: FOLDER })).toEqual({ folderId: FOLDER });
  });

  it('읽을 수 없는 값이면 화면 폴더로 넘어가지 않고 오류다', () => {
    const result = effectiveDriveFolder('saved000000000000000', { GOOGLE_DRIVE_FOLDER: `https://drive.google.com/file/d/${FOLDER}/view` });
    expect(result).toMatchObject({ folderId: null, fromEnv: true });
    expect(result.error).toContain('GOOGLE_DRIVE_FOLDER');
  });
});

describe('JWT bearer assertion', () => {
  const key = parseServiceAccountKey(keyJson());

  it('RS256 머리·클레임을 만들고, 공개 키로 서명을 확인할 수 있다', () => {
    const jwt = buildServiceAccountAssertion(key, { audience: 'https://oauth2.googleapis.com/token', nowSec: 1_760_000_000.7 });
    const [header, claims, signature] = jwt.split('.');
    expect(decodePart(header)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decodePart(claims)).toEqual({ iss: EMAIL, scope: SERVICE_ACCOUNT_SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: 1_760_000_000, exp: 1_760_003_600 });
    expect(SERVICE_ACCOUNT_SCOPE).toBe('https://www.googleapis.com/auth/drive.readonly');
    expect(verify('sha256', Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
    // 다른 키나 바뀐 클레임으로는 확인되지 않는다
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey;
    expect(verify('sha256', Buffer.from(`${header}.${claims}`), other, Buffer.from(signature, 'base64url'))).toBe(false);
    expect(verify('sha256', Buffer.from(`${header}.${claims}x`), publicKey, Buffer.from(signature, 'base64url'))).toBe(false);
  });

  it('토큰 응답: expires_in이 없거나 문자열이어도 읽고, 액세스 토큰·Bearer를 확인한다', () => {
    expect(parseServiceAccountTokenResponse({ access_token: 'a', expires_in: 3599, token_type: 'Bearer' }, 1000)).toEqual({ accessToken: 'a', expiresAt: 1000 + 3599 * 1000 });
    expect(parseServiceAccountTokenResponse({ access_token: 'a', expires_in: '120' }, 0)).toEqual({ accessToken: 'a', expiresAt: 120_000 });
    expect(parseServiceAccountTokenResponse({ access_token: 'a' }, 0).expiresAt).toBe(3_600_000);
    expect(() => parseServiceAccountTokenResponse({ expires_in: 10 }, 0)).toThrow(/액세스 토큰/);
    expect(() => parseServiceAccountTokenResponse({ access_token: 'a', token_type: 'mac' }, 0)).toThrow(/Bearer/);
    expect(() => parseServiceAccountTokenResponse(null, 0)).toThrow();
  });
});

describe('GoogleServiceAccount 토큰', () => {
  const saved = { ...process.env };
  let fetchMock: jest.SpyInstance;
  let requests: URLSearchParams[];
  let respond: () => Promise<Response>;
  let issued: number;

  beforeEach(() => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = keyJson();
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
    delete process.env.GOOGLE_API_TEST_ORIGIN;
    requests = [];
    issued = 0;
    respond = async () => {
      issued += 1;
      return new Response(JSON.stringify({ access_token: `sa-token-${issued}`, expires_in: 3599, token_type: 'Bearer' }), { status: 200 });
    };
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      requests.push(new URLSearchParams(String(init?.body ?? '')));
      // 동시에 온 요청이 하나로 묶이는지 보도록 잠깐 늦춘다
      await new Promise((resolve) => setTimeout(resolve, 20));
      return respond();
    });
  });

  afterEach(() => {
    fetchMock.mockRestore();
    jest.useRealTimers();
    for (const name of ['GOOGLE_SERVICE_ACCOUNT_KEY', 'GOOGLE_SERVICE_ACCOUNT_KEY_FILE', 'GOOGLE_API_TEST_ORIGIN']) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it('동시에 여러 번 불러도 토큰은 한 번만 받고, 받은 토큰을 기억한다', async () => {
    const sa = new GoogleServiceAccount();
    const tokens = await Promise.all([sa.accessToken(), sa.accessToken(), sa.accessToken()]);
    expect(tokens).toEqual(['sa-token-1', 'sa-token-1', 'sa-token-1']);
    expect(await sa.accessToken()).toBe('sa-token-1');
    expect(requests).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(init.method).toBe('POST');
    expect(requests[0].get('grant_type')).toBe(JWT_BEARER_GRANT_TYPE);
    const [header, claims, signature] = (requests[0].get('assertion') ?? '').split('.');
    expect(decodePart(claims)).toMatchObject({ iss: EMAIL, aud: 'https://oauth2.googleapis.com/token', scope: SERVICE_ACCOUNT_SCOPE });
    expect(verify('sha256', Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
  });

  it('만료 1분 전부터 새로 받는다', async () => {
    jest.useFakeTimers({ doNotFake: ['setTimeout', 'setImmediate', 'nextTick'] });
    jest.setSystemTime(new Date('2026-10-19T00:00:00Z'));
    const sa = new GoogleServiceAccount();
    expect(await sa.accessToken()).toBe('sa-token-1');
    jest.setSystemTime(new Date('2026-10-19T00:57:00Z'));
    expect(await sa.accessToken()).toBe('sa-token-1');
    jest.setSystemTime(new Date('2026-10-19T00:59:00Z'));
    expect(await sa.accessToken()).toBe('sa-token-2');
    expect(requests).toHaveLength(2);
  });

  it('거절된 토큰이 지금 기억한 토큰일 때만 새로 받는다', async () => {
    const sa = new GoogleServiceAccount();
    expect(await sa.accessToken()).toBe('sa-token-1');
    expect(await sa.accessToken('old-token')).toBe('sa-token-1');
    expect(await sa.accessToken('sa-token-1')).toBe('sa-token-2');
    expect(requests).toHaveLength(2);
  });

  it('키가 바뀌면 기억한 토큰을 쓰지 않는다', async () => {
    const sa = new GoogleServiceAccount();
    expect(await sa.accessToken()).toBe('sa-token-1');
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = keyJson({ client_email: 'other@p.iam.gserviceaccount.com' });
    expect(sa.email()).toBe('other@p.iam.gserviceaccount.com');
    expect(await sa.accessToken()).toBe('sa-token-2');
  });

  it('실패하면 INT-004이고 다음 호출이 다시 요청한다 (실패를 기억하지 않는다)', async () => {
    const sa = new GoogleServiceAccount();
    respond = async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }), { status: 400 });
    await expect(sa.accessToken()).rejects.toMatchObject({ code: 'INT-004' });
    await expect(sa.accessToken()).rejects.toThrow(/서비스 계정 키를 거절했어요/);
    respond = async () => new Response('{}', { status: 503 });
    await expect(sa.accessToken()).rejects.toThrow(/잠시 뒤/);
    expect(requests).toHaveLength(3);
    respond = async () => new Response(JSON.stringify({ access_token: 'sa-ok', expires_in: 3599 }), { status: 200 });
    expect(await sa.accessToken()).toBe('sa-ok');
  });

  it('키를 읽을 수 없으면 Google에 묻지 않고 INT-015, 넣지 않았으면 INT-002', async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'garbage';
    const sa = new GoogleServiceAccount();
    expect(sa.isActive()).toBe(true);
    expect(sa.email()).toBeNull();
    expect(sa.configError()).toMatch(/^GOOGLE_SERVICE_ACCOUNT_KEY: /);
    const error = await sa.accessToken().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).code).toBe('INT-015');
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    expect(sa.isActive()).toBe(false);
    await expect(sa.accessToken()).rejects.toMatchObject({ code: 'INT-002' });
    expect(requests).toHaveLength(0);
  });

  it('테스트에서는 가짜 Google 주소로 보내고 aud도 그 주소다', async () => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    process.env.GOOGLE_API_TEST_ORIGIN = 'http://127.0.0.1:9';
    try {
      const sa = new GoogleServiceAccount();
      await sa.accessToken();
      expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:9/token');
      expect(decodePart((requests[0].get('assertion') ?? '').split('.')[1]).aud).toBe('http://127.0.0.1:9/token');
    } finally {
      process.env.NODE_ENV = saved;
    }
  });
});
