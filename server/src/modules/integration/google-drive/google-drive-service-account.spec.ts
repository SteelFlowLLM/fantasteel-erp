// Google Drive 서비스 계정 연결(이슈 #395)을 실제 앱·DB와 이 파일 안의 가짜 Google 서버로 확인한다.
// 가짜 토큰 주소는 jwt-bearer assertion의 서명(테스트 공개 키)과 클레임을 확인하고, Drive는 서비스 계정에 공유한 폴더만 보여 준다.
// .env 값(GOOGLE_SERVICE_ACCOUNT_KEY_FILE·GOOGLE_DRIVE_FOLDER 등)은 테스트마다 기준값으로 되돌려 다른 테스트로 새지 않게 한다.
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { generateKeyPairSync, randomBytes, verify, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NOTIFICATION_TYPE, PERMISSION, PERMISSION_LEVEL, type DriveFilePage, type IntegrationConnectionView, type IntegrationTestResult, type MeetingMinutesView } from '@fantasteel/shared';
import { AppModule } from '../../../app.module';
import { PrismaService } from '../../../prisma/prisma.service';
import { SttClient, type SttTranscript } from '../../stt/stt.client';
import { SttSettingsStore } from '../../stt/stt-settings.store';
import { MeetingTranscriptionRunner } from '../../meeting-minutes/meeting-transcription.runner';
import { IntegrationCrypto } from '../integration-crypto';
import { IntegrationHealthMonitor } from '../integration-health.monitor';
import { GoogleDriveService } from './google-drive.service';

const SA_EMAIL = 'erp-drive@fantasteel-erp.iam.gserviceaccount.com';
const SHARED = '1SharedFolderAbCdEfGhIjKlMn';
const OTHER_SHARED = '1OtherSharedFolderAbCdEfGhI';
const UNSHARED = '1UnsharedFolderAbCdEfGhIjKl';
const FORBIDDEN = '1ForbiddenFolderAbCdEfGhIjK';
const ENV_NAMES = ['GOOGLE_SERVICE_ACCOUNT_KEY_FILE', 'GOOGLE_SERVICE_ACCOUNT_KEY', 'GOOGLE_DRIVE_FOLDER'] as const;

const signing = generateKeyPairSync('rsa', { modulusLength: 2048 });
/** Google에 등록되지 않은 키 (가짜 서버가 서명을 거절한다) */
const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });

function keyJson(privateKey: KeyObject, email = SA_EMAIL): string {
  return JSON.stringify({
    type: 'service_account',
    project_id: 'fantasteel-erp',
    private_key_id: 'test-key-id',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    client_email: email,
    client_id: '1234567890',
    token_uri: 'https://oauth2.googleapis.com/token',
  });
}

interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  modifiedTime: string;
  content: Buffer;
}

const fake = {
  origin: '',
  accessTokens: new Set<string>(),
  issued: 0,
  jwtGrants: 0,
  /** 받은 assertion 클레임 (마지막 것) */
  lastClaims: null as Record<string, unknown> | null,
  rejected: [] as string[],
  bearers: [] as string[],
  /** 서비스 계정이 볼 수 있는 폴더 (관리자가 공유한 폴더) */
  sharedFolders: new Set<string>([SHARED, OTHER_SHARED]),
  files: new Map<string, FakeFile>(),
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function decodePart(part: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Google 토큰 주소처럼 assertion을 확인한다: RS256 서명(등록된 공개 키), iss·scope·aud, iat·exp(1시간) */
function checkAssertion(assertion: string): string | null {
  const [header, claims, signature] = assertion.split('.');
  if (!header || !claims || !signature) return 'malformed';
  if (decodePart(header)?.alg !== 'RS256') return 'alg';
  if (!verify('sha256', Buffer.from(`${header}.${claims}`), signing.publicKey, Buffer.from(signature, 'base64url'))) return 'Invalid JWT Signature.';
  const c = decodePart(claims);
  fake.lastClaims = c;
  if (!c || c.iss !== SA_EMAIL || c.scope !== 'https://www.googleapis.com/auth/drive.readonly' || c.aud !== `${fake.origin}/token`) return 'claims';
  const now = Math.floor(Date.now() / 1000);
  if (typeof c.iat !== 'number' || typeof c.exp !== 'number' || Math.abs(c.iat - now) > 60 || c.exp - c.iat !== 3600) return 'Invalid JWT: Token must be a short-lived token';
  return null;
}

function visible(file: FakeFile): boolean {
  return fake.sharedFolders.has(file.id) || file.parents.some((p) => fake.sharedFolders.has(p));
}

function metaOf(file: FakeFile): Record<string, unknown> {
  return { id: file.id, name: file.name, mimeType: file.mimeType, parents: file.parents, modifiedTime: file.modifiedTime, trashed: false, size: String(file.content.length) };
}

async function handleDrive(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
  if (!fake.accessTokens.has(token)) return json(res, 401, { error: { code: 401, message: 'Request had invalid authentication credentials.' } });
  fake.bearers.push(token);
  // 주기 확인(이슈 #518)이 토큰과 Drive API를 보려고 부른다
  if (url.pathname === '/drive/v3/about') return json(res, 200, { user: { permissionId: 'service-account-1' } });
  if (url.pathname === '/drive/v3/files') {
    const parent = /'([^']+)' in parents/.exec(url.searchParams.get('q') ?? '')?.[1] ?? '';
    // 공유하지 않은 폴더의 목록은 Drive도 빈 목록을 준다
    const files = [...fake.files.values()].filter((f) => f.parents.includes(parent) && visible(f) && f.mimeType !== 'application/vnd.google-apps.folder');
    return json(res, 200, { files: files.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime)).map(metaOf) });
  }
  const id = decodeURIComponent(url.pathname.slice('/drive/v3/files/'.length));
  const file = fake.files.get(id);
  if (id === FORBIDDEN) return json(res, 403, { error: { code: 403, message: 'The user does not have sufficient permissions for this file.', errors: [{ reason: 'insufficientFilePermissions' }] } });
  if (!file || !visible(file)) return json(res, 404, { error: { code: 404, message: `File not found: ${id}.`, errors: [{ reason: 'notFound' }] } });
  if (url.searchParams.get('alt') !== 'media') return json(res, 200, metaOf(file));
  const range = /^bytes=(\d+)-(\d+)$/.exec(typeof req.headers.range === 'string' ? req.headers.range : '');
  if (range) {
    const [start, end] = [Number(range[1]), Math.min(Number(range[2]), file.content.length - 1)];
    const part = file.content.subarray(start, end + 1);
    res.writeHead(206, { 'content-type': file.mimeType, 'content-length': String(part.length), 'content-range': `bytes ${start}-${end}/${file.content.length}` }).end(part);
    return;
  }
  res.writeHead(200, { 'content-type': file.mimeType, 'content-length': String(file.content.length) }).end(file.content);
}

async function handleFake(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', fake.origin);
  if (url.pathname.startsWith('/drive/v3/') && req.method === 'GET') return handleDrive(req, res, url);
  if (url.pathname === '/token' && req.method === 'POST') {
    const form = new URLSearchParams(await readBody(req));
    if (form.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer') return json(res, 400, { error: 'unsupported_grant_type' });
    const problem = checkAssertion(form.get('assertion') ?? '');
    if (problem) {
      fake.rejected.push(problem);
      return json(res, 400, { error: 'invalid_grant', error_description: problem });
    }
    fake.jwtGrants += 1;
    fake.issued += 1;
    const access = `sa-access-${fake.issued}`;
    fake.accessTokens.add(access);
    return json(res, 200, { access_token: access, expires_in: 3599, token_type: 'Bearer' });
  }
  res.writeHead(404).end();
}

let fakeServer: HttpServer;
let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
let crypto: IntegrationCrypto;
let runner: MeetingTranscriptionRunner;
let keyDir: string;
let keyFile: string;
let adminCookie: string;
let salesCookie: string;
let purchaseId: number;
const sttClient = { transcribe: jest.fn<Promise<SttTranscript>, unknown[]>() };
const sttSettings = { read: jest.fn(async () => ({ baseUrl: 'http://stt.test/v1', model: null, apiKey: null })) };
const savedEnv: Partial<Record<string, string>> = {};

async function login(employeeNo: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ employeeNo, password: process.env.SEED_PASSWORD ?? 'fantasteel' }) });
  if (!res.ok) throw new Error(`로그인 실패 (HTTP ${res.status})`);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

async function call<T>(method: 'GET' | 'POST' | 'PUT', path: string, cookie: string | null, payload?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as { success: boolean; data: T; error?: { code: string; message: string } } };
}

async function driveView(): Promise<IntegrationConnectionView> {
  const { body } = await call<IntegrationConnectionView[]>('GET', '/integrations', salesCookie);
  const view = body.data.find((v) => v.providerKey === 'google-drive');
  if (!view) throw new Error('google-drive 연결이 목록에 없어요');
  return view;
}

/** 연동 관리 권한자(ORG_MANAGE 사용)인 재직 사원 수: 장애·복구 알림은 이 사람마다 한 행이다 (이슈 #518) */
let managerCount = 0;

async function clearFaultState(): Promise<void> {
  await prisma.integrationFault.deleteMany();
  await prisma.notification.deleteMany({ where: { notificationType: { in: [NOTIFICATION_TYPE.INTEGRATION_FAULT, NOTIFICATION_TYPE.INTEGRATION_RECOVERED] } } });
}

function alertsOf(type: typeof NOTIFICATION_TYPE.INTEGRATION_FAULT | typeof NOTIFICATION_TYPE.INTEGRATION_RECOVERED) {
  return prisma.notification.findMany({ where: { notificationType: type }, orderBy: { id: 'asc' } });
}

function driveFaults() {
  return prisma.integrationFault.findMany({ where: { providerKey: 'google-drive' }, orderBy: { id: 'asc' } });
}

function addFile(file: Omit<FakeFile, 'modifiedTime'> & { modifiedTime?: string }): void {
  fake.files.set(file.id, { modifiedTime: '2026-10-01T00:00:00.000Z', ...file });
}

/** 이 파일의 기준 .env: 서비스 계정 키 파일만 넣고 폴더는 화면 설정을 쓴다 */
function baselineEnv(): void {
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE = keyFile;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  delete process.env.GOOGLE_DRIVE_FOLDER;
}

beforeAll(async () => {
  for (const name of [...ENV_NAMES, 'GOOGLE_API_TEST_ORIGIN', 'INTEGRATION_SECRET_KEY', 'CLIENT_BASE_URL', 'SERVER_PUBLIC_URL']) savedEnv[name] = process.env[name];
  fakeServer = createServer((req, res) => {
    handleFake(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  await new Promise<void>((resolve) => fakeServer.listen(0, '127.0.0.1', resolve));
  fake.origin = `http://127.0.0.1:${(fakeServer.address() as AddressInfo).port}`;

  keyDir = mkdtempSync(join(tmpdir(), 'fs-drive-sa-'));
  keyFile = join(keyDir, 'service-account.json');
  writeFileSync(keyFile, keyJson(signing.privateKey));
  process.env.INTEGRATION_SECRET_KEY = randomBytes(32).toString('base64');
  process.env.GOOGLE_API_TEST_ORIGIN = fake.origin;
  process.env.CLIENT_BASE_URL = 'http://client.test';
  baselineEnv();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SttClient).useValue(sttClient).overrideProvider(SttSettingsStore).useValue(sttSettings).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  process.env.SERVER_PUBLIC_URL = baseUrl;
  prisma = app.get(PrismaService);
  crypto = app.get(IntegrationCrypto);
  runner = app.get(MeetingTranscriptionRunner);
  // 같은 DB를 쓰는 OAuth 테스트가 남긴 연결이 있으면 지운다: 연결 행 없이도 되는지 본다
  await prisma.integrationConnection.deleteMany({ where: { providerKey: 'google-drive' } });
  adminCookie = await login('1503001');
  salesCookie = await login('2103003');
  purchaseId = (await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2207005' } })).id;
  managerCount = await prisma.employee.count({
    where: { isActive: true, role: { rolePermissions: { some: { permission: PERMISSION.ORG_MANAGE, permissionLevel: PERMISSION_LEVEL.USE } } } },
  });

  addFile({ id: SHARED, name: '공유한 폴더', mimeType: 'application/vnd.google-apps.folder', parents: ['root0000000'], content: Buffer.alloc(0) });
  addFile({ id: OTHER_SHARED, name: '.env 폴더', mimeType: 'application/vnd.google-apps.folder', parents: ['root0000000'], content: Buffer.alloc(0) });
  addFile({ id: UNSHARED, name: '공유 안 한 폴더', mimeType: 'application/vnd.google-apps.folder', parents: ['root0000000'], content: Buffer.alloc(0) });
  addFile({ id: 'saAudio0000001', name: '현장 회의.m4a', mimeType: 'audio/mp4', parents: [SHARED], modifiedTime: '2026-10-18T09:00:00.000Z', content: Buffer.from('service-account-audio') });
  addFile({ id: 'saPhoto0000002', name: '코일 사진.jpg', mimeType: 'image/jpeg', parents: [SHARED], modifiedTime: '2026-10-17T09:00:00.000Z', content: Buffer.from('jpeg') });
  addFile({ id: 'saEnvAudio0003', name: '.env 폴더 녹음.mp3', mimeType: 'audio/mpeg', parents: [OTHER_SHARED], content: Buffer.from('env-audio') });
  addFile({ id: 'saHidden000004', name: '공유 안 한 녹음.mp3', mimeType: 'audio/mpeg', parents: [UNSHARED], content: Buffer.from('hidden') });
}, 60_000);

afterEach(() => {
  baselineEnv();
});

afterAll(async () => {
  await runner?.drain();
  await prisma?.integrationConnection.deleteMany({ where: { providerKey: 'google-drive' } });
  // 같은 묶음 DB를 쓰는 다른 시험이 이 시험의 장애·알림을 보지 않게 치운다
  if (prisma) await clearFaultState();
  await app?.close();
  await new Promise<void>((resolve) => fakeServer?.close(() => resolve()));
  if (keyDir) rmSync(keyDir, { recursive: true, force: true });
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('서비스 계정 연결 상태', () => {
  it('키 파일만 넣으면 로그인 없이 연결됨이고, 폴더를 공유할 서비스 계정 메일을 알려 준다 (행을 만들지 않는다)', async () => {
    const view = await driveView();
    expect(view).toMatchObject({
      providerKey: 'google-drive',
      status: 'CONNECTED',
      authMode: 'SERVICE_ACCOUNT',
      serviceAccountEmail: SA_EMAIL,
      connectedAt: null,
      connectedBy: null,
      lastError: null,
      settings: { folderId: null },
      driveFolderFromEnv: false,
    });
    expect(JSON.stringify(view)).not.toContain('PRIVATE KEY');
    expect(await prisma.integrationConnection.findUnique({ where: { providerKey: 'google-drive' } })).toBeNull();
  });

  it('폴더를 정하기 전에는 INT-011', async () => {
    const { status, body } = await call('GET', '/integrations/google-drive/files?kind=all', salesCookie);
    expect([status, body.error?.code]).toEqual([409, 'INT-011']);
  });

  it('OAuth 연결·끊기는 INT-016으로 거절하고 확인값을 남기지 않는다', async () => {
    const connect = await call('POST', '/integrations/google-drive/connect', adminCookie);
    expect([connect.status, connect.body.error?.code]).toEqual([409, 'INT-016']);
    const disconnect = await call('POST', '/integrations/google-drive/disconnect', adminCookie);
    expect([disconnect.status, disconnect.body.error?.code]).toEqual([409, 'INT-016']);
    expect(await prisma.integrationConnection.findUnique({ where: { providerKey: 'google-drive' } })).toBeNull();
    // 권한 확인이 먼저다
    expect((await call('POST', '/integrations/google-drive/connect', salesCookie)).status).toBe(403);
  });
});

describe('서비스 계정으로 Drive 읽기 (OAuth 토큰 없음)', () => {
  it('화면에서 폴더를 저장하면 목록을 읽는다. 토큰은 jwt-bearer로 한 번만 받아 다시 쓴다', async () => {
    const saved = await call<IntegrationConnectionView>('PUT', '/integrations/google-drive/settings', adminCookie, { folder: `https://drive.google.com/drive/folders/${SHARED}` });
    expect(saved.body.data).toMatchObject({ status: 'CONNECTED', authMode: 'SERVICE_ACCOUNT', settings: { folderId: SHARED } });
    expect((await prisma.integrationConnection.findUniqueOrThrow({ where: { providerKey: 'google-drive' } })).oauthTokens).toBeNull();

    const grantsBefore = fake.jwtGrants;
    const audio = await call<DriveFilePage>('GET', '/integrations/google-drive/files?kind=audio', salesCookie);
    expect(audio.status).toBe(200);
    expect(audio.body.data.files.map((f) => f.id)).toEqual(['saAudio0000001']);
    const all = await call<DriveFilePage>('GET', '/integrations/google-drive/files?kind=all', salesCookie);
    expect(all.body.data.files.map((f) => f.id)).toEqual(['saAudio0000001', 'saPhoto0000002']);
    expect(fake.jwtGrants - grantsBefore).toBeLessThanOrEqual(1);
    expect(fake.bearers.at(-1)).toMatch(/^sa-access-/);
    expect(fake.lastClaims).toMatchObject({ iss: SA_EMAIL, aud: `${fake.origin}/token` });
    expect(fake.rejected).toEqual([]);
  });

  it('내용: Range를 Drive로 넘겨 206으로 답한다', async () => {
    const res = await fetch(`${baseUrl}/integrations/google-drive/files/saAudio0000001/content`, { headers: { cookie: salesCookie, range: 'bytes=0-6' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 0-6/21');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('service');
    const whole = await fetch(`${baseUrl}/integrations/google-drive/files/saAudio0000001/content`, { headers: { cookie: salesCookie } });
    expect(Buffer.from(await whole.arrayBuffer()).toString()).toBe('service-account-audio');
  });

  it('연결 확인: 폴더 이름과 녹음·사진 수', async () => {
    const { body } = await call<IntegrationTestResult>('POST', '/integrations/google-drive/test', adminCookie);
    expect(body.data).toMatchObject({ ok: true, error: null, driveFolder: { id: SHARED, name: '공유한 폴더', audioCount: 1, imageCount: 1, countLimited: false } });
  });

  it('회의 녹음도 서비스 계정으로 받는다', async () => {
    const { buffer, file } = await app.get(GoogleDriveService).downloadAudio('saAudio0000001');
    expect(buffer.toString()).toBe('service-account-audio');
    expect(file).toMatchObject({ kind: 'audio', name: '현장 회의.m4a' });

    sttClient.transcribe.mockReset();
    sttClient.transcribe.mockResolvedValue({ text: '전체', segments: [{ start: 0, end: 1, text: '코일 출하 확인' }], durationSec: 1 });
    const purchaseCookie = await login('2207005');
    const created = await call<MeetingMinutesView>('POST', '/meeting-minutes/audio/from-drive', purchaseCookie, {
      meetingMinutesTitle: '서비스 계정 녹음',
      meetingDate: '2026-10-18',
      attendeeIds: [purchaseId],
      driveFileId: 'saAudio0000001',
    });
    expect(created.status).toBe(201);
    await runner.drain();
    const [, input] = sttClient.transcribe.mock.calls[0] as [unknown, { audio: Buffer }];
    expect(input.audio.toString()).toBe('service-account-audio');
  });

  it('OAuth 토큰이 저장돼 있어도 서비스 계정이 먼저다', async () => {
    fake.accessTokens.add('oauth-access-old');
    await prisma.integrationConnection.update({
      where: { providerKey: 'google-drive' },
      data: {
        oauthTokens: crypto.encryptJson({ accessToken: 'oauth-access-old', refreshToken: 'oauth-refresh', expiresAt: Date.now() + 3_600_000, scope: 'https://www.googleapis.com/auth/drive.readonly' }),
        connectedAt: new Date(),
      },
    });
    try {
      expect(await driveView()).toMatchObject({ status: 'CONNECTED', authMode: 'SERVICE_ACCOUNT', connectedAt: null, connectedBy: null });
      const { status } = await call('GET', '/integrations/google-drive/files?kind=audio', salesCookie);
      expect(status).toBe(200);
      expect(fake.bearers.at(-1)).toMatch(/^sa-access-/);
      expect(fake.bearers).not.toContain('oauth-access-old');
    } finally {
      await prisma.integrationConnection.update({ where: { providerKey: 'google-drive' }, data: { oauthTokens: null, connectedAt: null } });
    }
  });

  it('Drive가 토큰을 거절하면(401) 한 번 새로 받아 다시 보낸다', async () => {
    for (const token of [...fake.accessTokens]) if (token.startsWith('sa-access-')) fake.accessTokens.delete(token);
    const grantsBefore = fake.jwtGrants;
    const { status } = await call('GET', '/integrations/google-drive/files?kind=audio', salesCookie);
    expect(status).toBe(200);
    expect(fake.jwtGrants).toBe(grantsBefore + 1);
  });
});

describe('GOOGLE_DRIVE_FOLDER', () => {
  it('넣으면 화면에서 저장한 폴더보다 먼저다', async () => {
    process.env.GOOGLE_DRIVE_FOLDER = `https://drive.google.com/drive/u/0/folders/${OTHER_SHARED}?usp=sharing`;
    expect(await driveView()).toMatchObject({ settings: { folderId: OTHER_SHARED }, driveFolderFromEnv: true, lastError: null });
    const { body } = await call<DriveFilePage>('GET', '/integrations/google-drive/files?kind=audio', salesCookie);
    expect(body.data.files.map((f) => f.id)).toEqual(['saEnvAudio0003']);
    // 화면에서 저장한 폴더는 그대로 남는다 (.env를 지우면 다시 쓴다)
    expect((await prisma.integrationConnection.findUniqueOrThrow({ where: { providerKey: 'google-drive' } })).settings).toEqual({ folderId: SHARED });
  });

  it('읽을 수 없는 값이면 화면 폴더로 넘어가지 않고 INT-015로 알린다', async () => {
    process.env.GOOGLE_DRIVE_FOLDER = 'https://example.com/not-a-folder';
    const view = await driveView();
    expect(view).toMatchObject({ settings: { folderId: null }, driveFolderFromEnv: true });
    expect(view.lastError).toContain('GOOGLE_DRIVE_FOLDER');
    const { status, body } = await call('GET', '/integrations/google-drive/files?kind=audio', salesCookie);
    expect([status, body.error?.code]).toEqual([500, 'INT-015']);
  });

  it('테스트 사이에 .env가 기준값으로 돌아온다', async () => {
    expect(process.env.GOOGLE_DRIVE_FOLDER).toBeUndefined();
    expect(await driveView()).toMatchObject({ settings: { folderId: SHARED }, driveFolderFromEnv: false });
  });
});

describe('폴더를 서비스 계정에 공유하지 않았을 때', () => {
  it('Drive가 404면 연결 확인·목록이 서비스 계정 메일에 공유하라고 알린다', async () => {
    process.env.GOOGLE_DRIVE_FOLDER = UNSHARED;
    const test = await call<IntegrationTestResult>('POST', '/integrations/google-drive/test', adminCookie);
    expect(test.body.data).toMatchObject({ ok: false, driveFolder: null });
    expect(test.body.data.error).toContain(SA_EMAIL);
    expect(test.body.data.error).toContain('뷰어');
    const files = await call('GET', '/integrations/google-drive/files/saHidden000004/content', salesCookie);
    expect([files.status, files.body.error?.code]).toEqual([404, 'INT-012']);
  });

  it('Drive가 403(권한 부족)이어도 같은 안내다 (다시 연결하라고 하지 않는다)', async () => {
    process.env.GOOGLE_DRIVE_FOLDER = FORBIDDEN;
    const test = await call<IntegrationTestResult>('POST', '/integrations/google-drive/test', adminCookie);
    expect(test.body.data.ok).toBe(false);
    expect(test.body.data.error).toContain(SA_EMAIL);
    expect(test.body.data.error).not.toContain('다시 연결');
  });
});

describe('키 문제', () => {
  it('키 파일이 없으면 연결 안 됨 + 어떤 설정인지 알리고, Drive를 부르면 INT-015', async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE = join(keyDir, 'missing.json');
    const view = await driveView();
    expect(view).toMatchObject({ status: 'NOT_CONNECTED', authMode: 'SERVICE_ACCOUNT', serviceAccountEmail: null });
    expect(view.lastError).toContain('GOOGLE_SERVICE_ACCOUNT_KEY_FILE');
    // 부르지 않아도 이미 쓸 수 없는 상태라 관리 화면은 끊김으로 보인다
    expect(view.health.level).toBe('DOWN');
    const { status, body } = await call('GET', '/integrations/google-drive/files?kind=audio', salesCookie);
    expect([status, body.error?.code]).toEqual([500, 'INT-015']);
  });

  it('서비스 계정 키 오류(키 파일 없음)는 서버 관리자가 고칠 키·설정 오류로 한 번 알리고, 고치면 복구를 알린다 (주기 확인이 아무도 쓰지 않아도 찾는다)', async () => {
    await clearFaultState();
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE = join(keyDir, 'missing.json');
    await app.get(IntegrationHealthMonitor).runNow();
    expect(await driveFaults()).toMatchObject([{ faultKind: 'CREDENTIAL_ERROR', failureCount: 1 }]);
    const alerts = await alertsOf(NOTIFICATION_TYPE.INTEGRATION_FAULT);
    expect(alerts).toHaveLength(managerCount);
    expect(alerts[0].notificationContent).toContain('Google Drive 키·설정에 문제가 있어요');
    expect(alerts[0].notificationContent).toContain('GOOGLE_SERVICE_ACCOUNT_KEY_FILE');
    expect((await driveView()).health).toMatchObject({ level: 'DOWN', faults: [{ faultKind: 'CREDENTIAL_ERROR', notifiedAt: expect.any(String) }] });

    // 같은 오류가 되풀이돼도(다음 확인, 사용자의 요청) 알림은 늘지 않는다
    await app.get(IntegrationHealthMonitor).runNow();
    expect((await call('GET', '/integrations/google-drive/files?kind=audio', salesCookie)).body.error?.code).toBe('INT-015');
    expect((await driveFaults())[0].failureCount).toBe(2);
    expect(await alertsOf(NOTIFICATION_TYPE.INTEGRATION_FAULT)).toHaveLength(managerCount);

    baselineEnv();
    await app.get(IntegrationHealthMonitor).runNow();
    expect(await driveFaults()).toEqual([]);
    const recovered = await alertsOf(NOTIFICATION_TYPE.INTEGRATION_RECOVERED);
    expect(recovered).toHaveLength(managerCount);
    expect(recovered[0].notificationContent).toBe('Google Drive 키·설정 오류가 해결됐어요');
  });

  it('키 값(base64)도 받는다. 파일과 둘 다 있으면 파일이 먼저다', async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = Buffer.from(keyJson(stranger.privateKey, 'other@fantasteel-erp.iam.gserviceaccount.com')).toString('base64');
    expect((await driveView()).serviceAccountEmail).toBe(SA_EMAIL);
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = Buffer.from(keyJson(signing.privateKey)).toString('base64');
    expect((await driveView()).serviceAccountEmail).toBe(SA_EMAIL);
    expect((await call('GET', '/integrations/google-drive/files?kind=audio', salesCookie)).status).toBe(200);
  });

  it('Google이 키를 거절하면 INT-004이고 관리 화면에 이유가 남는다. 회복하면 지운다', async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = keyJson(stranger.privateKey);
    const { status, body } = await call('GET', '/integrations/google-drive/files?kind=audio', salesCookie);
    expect([status, body.error?.code]).toEqual([502, 'INT-004']);
    expect(body.error?.message).toContain('서비스 계정 키를 거절했어요');
    expect(fake.rejected.at(-1)).toBe('Invalid JWT Signature.');
    expect((await driveView()).lastError).toContain('서비스 계정 키를 거절했어요');

    baselineEnv();
    expect((await call('GET', '/integrations/google-drive/files?kind=audio', salesCookie)).status).toBe(200);
    expect((await driveView()).lastError).toBeNull();
  });

  it('Google이 서비스 계정 키를 거절하면 키 오류로 한 번 알리고, 새 키로 바꿔 Drive가 되면 복구를 알린다', async () => {
    await clearFaultState();
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = keyJson(stranger.privateKey);
    for (let i = 0; i < 3; i += 1) expect((await call('GET', '/integrations/google-drive/files?kind=audio', salesCookie)).body.error?.code).toBe('INT-004');
    expect(await driveFaults()).toMatchObject([{ faultKind: 'CREDENTIAL_ERROR', failureCount: 3 }]);
    const alerts = await alertsOf(NOTIFICATION_TYPE.INTEGRATION_FAULT);
    expect(alerts).toHaveLength(managerCount);
    expect(alerts[0].notificationContent).toContain('서비스 계정 키를 거절했어요');

    baselineEnv();
    expect((await call('GET', '/integrations/google-drive/files?kind=audio', salesCookie)).status).toBe(200);
    expect(await driveFaults()).toEqual([]);
    expect(await alertsOf(NOTIFICATION_TYPE.INTEGRATION_RECOVERED)).toHaveLength(managerCount);
    await clearFaultState();
  });

  it('키를 빼면 OAuth 연결로 돌아간다', async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
    expect(await driveView()).toMatchObject({ authMode: 'OAUTH', serviceAccountEmail: null, status: 'NOT_CONNECTED' });
    const { body } = await call('GET', '/integrations/google-drive/files?kind=audio', salesCookie);
    expect(body.error?.code).toBe('INT-002');
  });
});
