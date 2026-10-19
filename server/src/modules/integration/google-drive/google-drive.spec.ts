// Google Drive 연결(이슈 #361)을 실제 앱·DB(fs_collab)와 이 파일 안의 가짜 Google 서버로 확인한다.
// 가짜 서버는 OAuth 토큰(인가 코드 + PKCE·갱신·취소)과 Drive v3(files.get·files.list·alt=media)를 흉내 낸다.
// GOOGLE_API_TEST_ORIGIN으로 Google 주소를 가짜 서버로 바꾸고, 전사는 회의록 테스트처럼 STT를 가짜로 바꾼다.
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { DriveFilePage, IntegrationConnectResult, IntegrationConnectionView, IntegrationTestResult, MeetingMinutesView } from '@fantasteel/shared';
import { AppModule } from '../../../app.module';
import { PrismaService } from '../../../prisma/prisma.service';
import { SttClient, type SttTranscript } from '../../stt/stt.client';
import { SttSettingsStore } from '../../stt/stt-settings.store';
import { MeetingTranscriptionRunner } from '../../meeting-minutes/meeting-transcription.runner';
import { IntegrationCrypto } from '../integration-crypto';
import type { GoogleTokens } from './google-oauth';

const CLIENT_ID = '1234567890-fantasteel.apps.googleusercontent.com';
const CLIENT_SECRET = 'GOCSPX-test-secret-value';
const FOLDER = '1FolderAbCdEfGhIjKlMnOpQrStUv';
const OTHER_FOLDER = '1OtherFolderAbCdEfGhIjKlMnOp';
const READ_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  modifiedTime: string;
  content: Buffer;
  trashed?: boolean;
  /** 메타데이터에 크기를 넣지 않는다 (Google 문서처럼) */
  hideSize?: boolean;
  /** 메타데이터 크기를 이 값으로 보인다 */
  fakeSize?: number;
  /** 내용 응답에 Content-Length 없이 조각으로 보낸다 */
  chunked?: boolean;
  /** 내용 응답의 Content-Length를 이 값으로 보인다 (내용은 보내지 않는다) */
  fakeContentLength?: number;
  /** 내보내기(files.export)가 10MB 상한 오류로 실패한다 */
  exportTooLarge?: boolean;
}

const fake = {
  origin: '',
  accessTokens: new Set<string>(),
  refreshTokens: new Set<string>(),
  issued: 0,
  pendingChallenge: null as string | null,
  /** 허용 화면에서 관리자가 고른 권한 */
  grantScope: `${READ_SCOPE} ${FILE_SCOPE}`,
  codeGrants: [] as Record<string, string>[],
  refreshGrants: 0,
  refreshFails: false,
  mediaFails: false,
  /** 내용 응답 머리를 이만큼 늦춘다 (브라우저가 떠나는 시험) */
  mediaDelayMs: 0,
  /** 허용한 Google 계정 (about.user.permissionId) */
  accountId: 'acct-1',
  /** 토큰마다 발급할 때의 계정 */
  tokenAccounts: new Map<string, string>(),
  revoked: [] as string[],
  /** 내용 요청에 붙어 온 Range 머리 */
  ranges: [] as string[],
  /** files.export로 온 요청의 mimeType */
  exports: [] as string[],
  /** Drive 요청에 쓴 액세스 토큰 */
  bearers: [] as string[],
  files: new Map<string, FakeFile>(),
};

function addFile(file: Omit<FakeFile, 'modifiedTime'> & { modifiedTime?: string }): FakeFile {
  const full = { modifiedTime: '2026-10-01T00:00:00.000Z', ...file };
  fake.files.set(full.id, full);
  return full;
}

function issueAccess(): string {
  fake.issued += 1;
  const access = `g-access-${fake.issued}`;
  fake.accessTokens.add(access);
  fake.tokenAccounts.set(access, fake.accountId);
  return access;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function metaOf(file: FakeFile): Record<string, unknown> {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    parents: file.parents,
    modifiedTime: file.modifiedTime,
    trashed: file.trashed ?? false,
    ...(file.hideSize ? {} : { size: String(file.fakeSize ?? file.content.length) }),
    ...(file.mimeType.startsWith('image/') ? { thumbnailLink: `https://lh3.googleusercontent.com/thumb-${file.id}` } : {}),
  };
}

/** files.list의 q 가운데 테스트가 쓰는 모양만 읽는다: '<폴더>' in parents, trashed = false, 녹음·사진·문서 MIME (or로 묶인 것은 하나라도 맞으면) */
function matchesQuery(file: FakeFile, q: string): boolean {
  const parent = /'([^']+)' in parents/.exec(q)?.[1];
  if (parent && !file.parents.includes(parent)) return false;
  if (q.includes('trashed = false') && file.trashed) return false;
  const audio = q.includes("mimeType contains 'audio/'") && file.mimeType.startsWith('audio/');
  const equals = [...q.matchAll(/mimeType = '([^']+)'/g)].map((m) => m[1]);
  if (!q.includes('mimeType')) return true;
  return audio || equals.includes(file.mimeType);
}

async function handleDrive(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
  if (!fake.accessTokens.has(token)) return json(res, 401, { error: { code: 401, message: 'Request had invalid authentication credentials.' } });
  fake.bearers.push(token);
  if (url.pathname === '/drive/v3/about') return json(res, 200, { user: { permissionId: fake.tokenAccounts.get(token) ?? fake.accountId } });
  if (url.pathname === '/drive/v3/files') {
    const q = url.searchParams.get('q') ?? '';
    const size = Number(url.searchParams.get('pageSize') ?? 100);
    const offset = Number(url.searchParams.get('pageToken') ?? 0);
    const all = [...fake.files.values()].filter((f) => matchesQuery(f, q)).sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
    const page = all.slice(offset, offset + size);
    return json(res, 200, { files: page.map(metaOf), ...(offset + size < all.length ? { nextPageToken: String(offset + size) } : {}) });
  }
  const rest = decodeURIComponent(url.pathname.slice('/drive/v3/files/'.length));
  const exporting = rest.endsWith('/export');
  const id = exporting ? rest.slice(0, -'/export'.length) : rest;
  const file = fake.files.get(id);
  if (!file) return json(res, 404, { error: { code: 404, message: `File not found: ${id}.`, errors: [{ reason: 'notFound' }] } });
  if (exporting) {
    fake.exports.push(url.searchParams.get('mimeType') ?? '');
    if (!file.mimeType.startsWith('application/vnd.google-apps.')) return json(res, 403, { error: { code: 403, message: 'Export only supports Docs Editors files.', errors: [{ reason: 'fileNotExportable' }] } });
    if (file.exportTooLarge) return json(res, 403, { error: { code: 403, message: 'This file is too large to be exported.', errors: [{ reason: 'exportSizeLimitExceeded' }] } });
    // 실제 Drive처럼 내보낸 PDF는 길이 없이 조각으로 온다
    res.writeHead(200, { 'content-type': url.searchParams.get('mimeType') ?? 'application/pdf' }).end(file.content);
    return;
  }
  if (url.searchParams.get('alt') !== 'media') return json(res, 200, metaOf(file));
  if (fake.mediaFails) return json(res, 500, { error: { code: 500, message: 'Backend Error' } });
  if (fake.mediaDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, fake.mediaDelayMs));
  const range = typeof req.headers.range === 'string' ? req.headers.range : '';
  if (range) {
    fake.ranges.push(range);
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    const total = file.content.length;
    if (m) {
      const start = m[1] === '' ? Math.max(0, total - Number(m[2])) : Number(m[1]);
      const end = m[1] === '' || m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1);
      if (start >= total) return json(res, 416, { error: { code: 416, message: 'Request range not satisfiable' } });
      const part = file.content.subarray(start, end + 1);
      res.writeHead(206, { 'content-type': file.mimeType, 'content-length': String(part.length), 'content-range': `bytes ${start}-${end}/${total}` }).end(part);
      return;
    }
  }
  if (file.fakeContentLength !== undefined) {
    // 머리만 보내고 끊는다: 서버는 Content-Length만 보고 받기 전에 거절해야 한다
    res.writeHead(200, { 'content-type': file.mimeType, 'content-length': String(file.fakeContentLength) });
    res.flushHeaders();
    setTimeout(() => res.destroy(), 200);
    return;
  }
  if (file.chunked) {
    res.writeHead(200, { 'content-type': file.mimeType });
    const step = 1024 * 1024;
    for (let i = 0; i < file.content.length && !res.destroyed; i += step) {
      if (!res.write(file.content.subarray(i, i + step))) {
        await new Promise<void>((resolve) => {
          const done = () => {
            res.off('drain', done);
            res.off('close', done);
            resolve();
          };
          res.on('drain', done);
          res.on('close', done);
        });
      }
    }
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': file.mimeType, 'content-length': String(file.content.length) }).end(file.content);
}

async function handleFake(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', fake.origin);
  if (url.pathname.startsWith('/drive/v3/') && req.method === 'GET') return handleDrive(req, res, url);
  const form = new URLSearchParams(await readBody(req));
  if (url.pathname === '/token' && req.method === 'POST') {
    if (form.get('client_id') !== CLIENT_ID || form.get('client_secret') !== CLIENT_SECRET) return json(res, 401, { error: 'invalid_client' });
    if (form.get('grant_type') === 'authorization_code') {
      fake.codeGrants.push(Object.fromEntries(form));
      const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
      if (form.get('code') !== 'good-code' || challenge !== fake.pendingChallenge) return json(res, 400, { error: 'invalid_grant', error_description: 'Bad Request' });
      fake.pendingChallenge = null;
      const refresh = `g-refresh-${fake.issued + 1}`;
      fake.refreshTokens.add(refresh);
      return json(res, 200, { access_token: issueAccess(), expires_in: 3599, refresh_token: refresh, scope: fake.grantScope, token_type: 'Bearer' });
    }
    if (form.get('grant_type') === 'refresh_token') {
      fake.refreshGrants += 1;
      if (fake.refreshFails) return json(res, 503, { error: 'temporarily_unavailable' });
      if (!fake.refreshTokens.has(form.get('refresh_token') ?? '')) return json(res, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      // Google처럼 갱신 응답에는 리프레시 토큰이 없다
      return json(res, 200, { access_token: issueAccess(), expires_in: 3599, scope: fake.grantScope, token_type: 'Bearer' });
    }
    return json(res, 400, { error: 'unsupported_grant_type' });
  }
  if (url.pathname === '/revoke' && req.method === 'POST') {
    const token = form.get('token') ?? '';
    fake.revoked.push(token);
    fake.refreshTokens.delete(token);
    return json(res, 200, {});
  }
  res.writeHead(404).end();
}

let fakeServer: HttpServer;
let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
let runner: MeetingTranscriptionRunner;
let crypto: IntegrationCrypto;
const sttClient = { transcribe: jest.fn<Promise<SttTranscript>, unknown[]>() };
const sttSettings = { read: jest.fn(async () => ({ baseUrl: 'http://stt.test/v1', model: null, apiKey: null })) };
/** 이현정 (ADMIN, ORG_MANAGE 사용) */
let adminCookie: string;
let adminId: number;
/** 정다은 (구매) */
let purchaseCookie: string;
let purchaseId: number;
/** 김영업 (영업) */
let salesCookie: string;

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

async function driveRow() {
  return prisma.integrationConnection.findUniqueOrThrow({ where: { providerKey: 'google-drive' } });
}

async function storedTokens(): Promise<GoogleTokens> {
  const row = await driveRow();
  if (!row.oauthTokens) throw new Error('토큰이 없어요');
  return crypto.decryptJson<GoogleTokens>(row.oauthTokens);
}

/** 저장된 액세스 토큰을 만료로 바꾼다 (다음 호출이 미리 갱신하게) */
async function expireStoredToken(): Promise<void> {
  const tokens = await storedTokens();
  await prisma.integrationConnection.update({ where: { providerKey: 'google-drive' }, data: { oauthTokens: crypto.encryptJson({ ...tokens, expiresAt: Date.now() - 1000 }) } });
}

/** 연결 시작 → 가짜 허용 → 콜백. 콜백이 돌려보낸 주소를 돌려준다 */
async function connectFlow(code = 'good-code'): Promise<string> {
  const { body } = await call<IntegrationConnectResult>('POST', '/integrations/google-drive/connect', adminCookie);
  const url = new URL(body.data.authorizationUrl);
  fake.pendingChallenge = url.searchParams.get('code_challenge');
  const res = await fetch(`${baseUrl}/integrations/oauth/callback?code=${code}&state=${encodeURIComponent(url.searchParams.get('state') ?? '')}&scope=${encodeURIComponent(fake.grantScope)}`, { redirect: 'manual' });
  return res.headers.get('location') ?? '';
}

beforeAll(async () => {
  fakeServer = createServer((req, res) => {
    handleFake(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  await new Promise<void>((resolve) => fakeServer.listen(0, '127.0.0.1', resolve));
  fake.origin = `http://127.0.0.1:${(fakeServer.address() as AddressInfo).port}`;

  process.env.INTEGRATION_SECRET_KEY = randomBytes(32).toString('base64');
  process.env.GOOGLE_API_TEST_ORIGIN = fake.origin;
  process.env.CLIENT_BASE_URL = 'http://client.test';
  // 이 파일은 OAuth 연결을 본다: 서비스 계정·.env 폴더(google-drive-service-account.spec.ts)가 끼지 않게
  for (const name of ['GOOGLE_SERVICE_ACCOUNT_KEY_FILE', 'GOOGLE_SERVICE_ACCOUNT_KEY', 'GOOGLE_DRIVE_FOLDER']) delete process.env[name];

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SttClient).useValue(sttClient).overrideProvider(SttSettingsStore).useValue(sttSettings).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  process.env.SERVER_PUBLIC_URL = baseUrl;
  prisma = app.get(PrismaService);
  runner = app.get(MeetingTranscriptionRunner);
  crypto = app.get(IntegrationCrypto);
  adminCookie = await login('1503001');
  purchaseCookie = await login('2207005');
  salesCookie = await login('2103003');
  adminId = (await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '1503001' } })).id;
  purchaseId = (await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2207005' } })).id;

  addFile({ id: 'audioNewest001', name: '주간 회의.m4a', mimeType: 'audio/mp4', parents: [FOLDER], modifiedTime: '2026-10-15T09:00:00.000Z', content: Buffer.from('fake-m4a-bytes') });
  addFile({ id: 'audioWebm00002', name: '브라우저 녹음.webm', mimeType: 'video/webm', parents: [FOLDER], modifiedTime: '2026-10-14T09:00:00.000Z', content: Buffer.from('fake-webm') });
  addFile({ id: 'audioTrashed03', name: '지운 녹음.mp3', mimeType: 'audio/mpeg', parents: [FOLDER], trashed: true, content: Buffer.from('x') });
  addFile({ id: 'audioOutside04', name: '다른 폴더 녹음.mp3', mimeType: 'audio/mpeg', parents: [OTHER_FOLDER], content: Buffer.from('secret-audio') });
  addFile({ id: 'imagePhoto0005', name: '현장 사진.jpg', mimeType: 'image/jpeg', parents: [FOLDER], modifiedTime: '2026-10-13T09:00:00.000Z', content: Buffer.from('fake-jpeg') });
  addFile({ id: 'imageSvgLogo06', name: 'logo.svg', mimeType: 'image/svg+xml', parents: [FOLDER], content: Buffer.from('<svg onload="alert(1)"/>') });
  addFile({ id: 'docReportPdf07', name: '보고서.pdf', mimeType: 'application/pdf', parents: [FOLDER], modifiedTime: '2026-10-12T09:00:00.000Z', content: Buffer.from('%PDF-1.7 fake') });
  addFile({ id: 'docGoogleDoc014', name: '회의 안건', mimeType: 'application/vnd.google-apps.document', parents: [FOLDER], modifiedTime: '2026-10-16T09:00:00.000Z', hideSize: true, content: Buffer.from('%PDF-exported') });
  addFile({ id: 'docGoogleSheet15', name: '재고 현황.pdf', mimeType: 'application/vnd.google-apps.spreadsheet', parents: [FOLDER], modifiedTime: '2026-10-11T09:00:00.000Z', hideSize: true, content: Buffer.from('%PDF-sheet') });
  addFile({ id: 'docGoogleBig016', name: '큰 문서', mimeType: 'application/vnd.google-apps.document', parents: [FOLDER], modifiedTime: '2026-10-10T09:00:00.000Z', hideSize: true, exportTooLarge: true, content: Buffer.alloc(0) });
  addFile({ id: 'docGoogleForm17', name: '설문', mimeType: 'application/vnd.google-apps.form', parents: [FOLDER], hideSize: true, content: Buffer.alloc(0) });
  addFile({ id: 'docWordFile018', name: '견적서.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', parents: [FOLDER], modifiedTime: '2026-10-09T09:00:00.000Z', content: Buffer.from('fake-docx') });
  addFile({ id: 'docPdfHuge0019', name: '큰 PDF.pdf', mimeType: 'application/pdf', parents: [FOLDER], modifiedTime: '2026-10-08T09:00:00.000Z', fakeSize: 51 * 1024 * 1024, content: Buffer.from('x') });
  addFile({ id: 'docPdfOutside20', name: '다른 폴더 문서.pdf', mimeType: 'application/pdf', parents: [OTHER_FOLDER], content: Buffer.from('secret-pdf') });
  addFile({ id: 'otherZipFile021', name: '자료.zip', mimeType: 'application/zip', parents: [FOLDER], content: Buffer.from('PK') });
  addFile({ id: 'imageHuge00008', name: '큰 사진.png', mimeType: 'image/png', parents: [FOLDER], fakeSize: 21 * 1024 * 1024, content: Buffer.from('x') });
  addFile({ id: 'imageNoSize009', name: '크기 숨김.png', mimeType: 'image/png', parents: [FOLDER], hideSize: true, fakeContentLength: 25 * 1024 * 1024, content: Buffer.alloc(0) });
  addFile({ id: 'imageChunked10', name: '조각 사진.png', mimeType: 'image/png', parents: [FOLDER], hideSize: true, chunked: true, content: Buffer.alloc(21 * 1024 * 1024, 1) });
  addFile({ id: 'imageReplaced12', name: '바뀐 사진.webp', mimeType: 'image/webp', parents: [FOLDER], fakeSize: 999, content: Buffer.from('new-webp!') });
  addFile({ id: 'imageSvgUpper13', name: 'LOGO.SVG', mimeType: 'IMAGE/SVG+XML', parents: [FOLDER], content: Buffer.from('<svg/>') });
  addFile({ id: 'subFolder00011', name: '하위 폴더', mimeType: 'application/vnd.google-apps.folder', parents: [FOLDER], content: Buffer.alloc(0) });
  addFile({ id: FOLDER, name: '회의 녹음·현장 사진', mimeType: 'application/vnd.google-apps.folder', parents: ['root0000000'], content: Buffer.alloc(0) });
}, 60_000);

afterAll(async () => {
  await runner?.drain();
  await app?.close();
  await new Promise<void>((resolve) => fakeServer?.close(() => resolve()));
  delete process.env.GOOGLE_API_TEST_ORIGIN;
});

describe('연결 전', () => {
  it('목록에 Google Drive가 연결 안 됨으로 보이고, 등록할 redirect URI를 알려 준다', async () => {
    expect(await driveView()).toEqual({
      providerKey: 'google-drive',
      displayName: 'Google Drive',
      protocol: 'OAUTH2',
      serverUrl: null,
      status: 'NOT_CONNECTED',
      connectedAt: null,
      connectedBy: null,
      lastError: null,
      settings: { folderId: null },
      redirectUri: `${baseUrl}/integrations/oauth/callback`,
      oauthClient: { clientId: null, clientSecretSet: false },
      authMode: 'OAUTH',
      serviceAccountEmail: null,
      driveFolderFromEnv: false,
    });
  });

  it('파일 목록: 로그인이 필요하고, 연결하지 않았으면 INT-002', async () => {
    expect((await call('GET', '/integrations/google-drive/files?kind=audio', null)).status).toBe(401);
    const { status, body } = await call('GET', '/integrations/google-drive/files?kind=audio', salesCookie);
    expect(status).toBe(409);
    expect(body.error?.code).toBe('INT-002');
  });

  it('잘못된 client id는 행을 만들기 전에 거절한다', async () => {
    const { status, body } = await call('PUT', '/integrations/google-drive/settings', adminCookie, { clientId: 'not-a-google-client', folder: FOLDER });
    expect([status, body.error?.code]).toEqual([400, 'COM-004']);
    expect(await prisma.integrationConnection.findUnique({ where: { providerKey: 'google-drive' } })).toBeNull();
  });

  it('client id·secret 없이 연결을 시작하면 INT-010이고 확인값을 남기지 않는다', async () => {
    const { status, body } = await call('POST', '/integrations/google-drive/connect', adminCookie);
    expect(status).toBe(409);
    expect(body.error?.code).toBe('INT-010');
    expect((await driveRow()).oauthState).toBeNull();
  });
});

describe('PUT integrations/google-drive/settings', () => {
  it('관리자가 아니면 COM-002', async () => {
    expect((await call('PUT', '/integrations/google-drive/settings', salesCookie, { folder: FOLDER })).status).toBe(403);
  });

  it('다른 연결 대상의 칸이나 잘못된 값은 COM-004', async () => {
    expect((await call('PUT', '/integrations/google-drive/settings', adminCookie, { parentPage: 'x' })).body.error?.code).toBe('COM-004');
    expect((await call('PUT', '/integrations/notion/settings', adminCookie, { clientId: CLIENT_ID })).body.error?.code).toBe('COM-004');
    expect((await call('PUT', '/integrations/google-drive/settings', adminCookie, { clientId: 'not-a-google-client' })).body.error?.code).toBe('COM-004');
    expect((await call('PUT', '/integrations/google-drive/settings', adminCookie, { folder: `https://drive.google.com/file/d/${FOLDER}/view` })).body.error?.code).toBe('COM-004');
    expect((await call('PUT', '/integrations/google-drive/settings', adminCookie, { clientSecret: 'has space' })).body.error?.code).toBe('COM-004');
  });

  it('client id·secret·폴더 주소를 저장한다. secret은 돌려주지 않고 암호문으로만 남는다', async () => {
    const { status, body, text } = await call<IntegrationConnectionView>('PUT', '/integrations/google-drive/settings', adminCookie, {
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      folder: `https://drive.google.com/drive/u/0/folders/${FOLDER}?usp=sharing`,
    });
    expect(status).toBe(200);
    expect(body.data.settings).toEqual({ folderId: FOLDER });
    expect(body.data.oauthClient).toEqual({ clientId: CLIENT_ID, clientSecretSet: true });
    expect(text).not.toContain(CLIENT_SECRET);
    const row = await driveRow();
    expect(row.oauthClientInformation?.startsWith('v1:')).toBe(true);
    expect(row.oauthClientInformation).not.toContain(CLIENT_SECRET);
    expect(row.oauthClientInformation).not.toContain(CLIENT_ID);
    // 목록(로그인만)도 secret을 담지 않는다
    expect(JSON.stringify(await driveView())).not.toContain(CLIENT_SECRET);
  });

  it('보내지 않은 칸은 그대로 둔다', async () => {
    const { body } = await call<IntegrationConnectionView>('PUT', '/integrations/google-drive/settings', adminCookie, { folder: FOLDER });
    expect(body.data.oauthClient).toEqual({ clientId: CLIENT_ID, clientSecretSet: true });
  });
});

describe('OAuth 연결', () => {
  let state = '';

  it('관리자가 아니면 연결을 시작할 수 없다', async () => {
    expect((await call('POST', '/integrations/google-drive/connect', purchaseCookie)).status).toBe(403);
  });

  it('연결 시작: Google 허용 화면 주소에 오프라인·동의·PKCE·state·우리 redirect URI를 붙인다', async () => {
    const { status, body } = await call<IntegrationConnectResult>('POST', '/integrations/google-drive/connect', adminCookie);
    expect(status).toBe(200);
    const url = new URL(body.data.authorizationUrl);
    expect(`${url.origin}${url.pathname}`).toBe(`${fake.origin}/o/oauth2/v2/auth`);
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(`${baseUrl}/integrations/oauth/callback`);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('scope')).toBe(`${READ_SCOPE} ${FILE_SCOPE}`);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    state = url.searchParams.get('state') ?? '';
    fake.pendingChallenge = url.searchParams.get('code_challenge');
    const row = await driveRow();
    expect(row.oauthState).toBe(state);
    expect(row.oauthCodeVerifier?.startsWith('v1:')).toBe(true);
  });

  it('콜백: PKCE verifier·client secret으로 토큰을 받고, 토큰은 암호문으로만 남는다', async () => {
    const res = await fetch(`${baseUrl}/integrations/oauth/callback?code=good-code&state=${encodeURIComponent(state)}&scope=x`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://client.test/admin/integrations?integration=google-drive&result=connected');
    const grant = fake.codeGrants.at(-1);
    expect(grant).toMatchObject({ grant_type: 'authorization_code', code: 'good-code', client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: `${baseUrl}/integrations/oauth/callback` });
    expect(grant?.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const row = await driveRow();
    expect(row.oauthTokens?.startsWith('v1:')).toBe(true);
    expect(row.oauthTokens).not.toContain('g-access');
    expect(row.oauthTokens).not.toContain('g-refresh');
    expect(row.oauthState).toBeNull();
    expect(row.oauthCodeVerifier).toBeNull();
    expect(await storedTokens()).toMatchObject({ accessToken: 'g-access-1', refreshToken: 'g-refresh-1', scope: `${READ_SCOPE} ${FILE_SCOPE}` });
    expect(await driveView()).toMatchObject({ status: 'CONNECTED', connectedBy: { id: adminId }, lastError: null });
  });

  it('같은 state를 다시 쓰면 오류로 돌려보낸다', async () => {
    const again = await fetch(`${baseUrl}/integrations/oauth/callback?code=good-code&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
    expect(new URL(again.headers.get('location') ?? '').searchParams.get('result')).toBe('error');
    expect((await driveView()).status).toBe('CONNECTED');
  });

  it('연결 확인: 폴더 이름과 녹음·사진 수', async () => {
    const { status, body } = await call<IntegrationTestResult>('POST', '/integrations/google-drive/test', adminCookie);
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ ok: true, error: null, tools: [], missingTools: [] });
    // 녹음 2 (지운 것·다른 폴더 제외), 사진 5 (대문자 SVG까지 제외)
    expect(body.data.driveFolder).toEqual({ id: FOLDER, name: '회의 녹음·현장 사진', audioCount: 2, imageCount: 5, countLimited: false });
    expect(body.data.latencyMs).toEqual(expect.any(Number));
  });
});

describe('GET integrations/google-drive/files', () => {
  it('녹음: 설정한 폴더 안, 휴지통 아닌 것만 최신순', async () => {
    const { status, body } = await call<DriveFilePage>('GET', '/integrations/google-drive/files?kind=audio', salesCookie);
    expect(status).toBe(200);
    expect(body.data.files.map((f) => f.id)).toEqual(['audioNewest001', 'audioWebm00002']);
    expect(body.data.files[0]).toEqual({ id: 'audioNewest001', name: '주간 회의.m4a', mimeType: 'audio/mp4', kind: 'audio', size: 14, modifiedTime: '2026-10-15T09:00:00.000Z', thumbnailLink: null });
    expect(body.data.nextPageToken).toBeNull();
  });

  it('사진: 허용 목록(jpeg·png·webp…)만, SVG·PDF·폴더는 빼고 미리보기 주소를 준다', async () => {
    const { body } = await call<DriveFilePage>('GET', '/integrations/google-drive/files?kind=image', salesCookie);
    expect(body.data.files.map((f) => f.id).sort()).toEqual(['imageChunked10', 'imageHuge00008', 'imageNoSize009', 'imagePhoto0005', 'imageReplaced12']);
    expect(body.data.files.find((f) => f.id === 'imagePhoto0005')?.thumbnailLink).toBe('https://lh3.googleusercontent.com/thumb-imagePhoto0005');
  });

  it('문서: PDF·Google 문서·스프레드시트·Office만 (폴더·양식·zip·폴더 밖은 뺀다), kind를 달아 준다', async () => {
    const { body } = await call<DriveFilePage>('GET', '/integrations/google-drive/files?kind=document', salesCookie);
    expect(body.data.files.map((f) => f.id)).toEqual(['docGoogleDoc014', 'docReportPdf07', 'docGoogleSheet15', 'docGoogleBig016', 'docWordFile018', 'docPdfHuge0019']);
    expect(body.data.files.every((f) => f.kind === 'document')).toBe(true);
    // Google 문서는 크기를 주지 않는다
    expect(body.data.files[0]).toMatchObject({ name: '회의 안건', mimeType: 'application/vnd.google-apps.document', size: null });
  });

  it('all: 녹음·사진·문서를 최신 수정순으로 섞어 주고, 지원하지 않는 것은 뺀다', async () => {
    const { body } = await call<DriveFilePage>('GET', '/integrations/google-drive/files?kind=all', salesCookie);
    const ids = body.data.files.map((f) => f.id);
    expect(ids.slice(0, 4)).toEqual(['docGoogleDoc014', 'audioNewest001', 'audioWebm00002', 'imagePhoto0005']);
    for (const excluded of ['imageSvgLogo06', 'imageSvgUpper13', 'subFolder00011', 'docGoogleForm17', 'otherZipFile021', 'audioTrashed03', 'audioOutside04', 'docPdfOutside20']) {
      expect(ids).not.toContain(excluded);
    }
    expect(new Set(body.data.files.map((f) => f.kind))).toEqual(new Set(['audio', 'image', 'document']));
  });

  it('50개씩 나눠 주고 nextPageToken으로 다음 쪽을 읽는다', async () => {
    for (let i = 0; i < 50; i += 1) addFile({ id: `bulkAudio${String(i).padStart(4, '0')}`, name: `녹음 ${i}.mp3`, mimeType: 'audio/mpeg', parents: [FOLDER], modifiedTime: '2026-09-01T00:00:00.000Z', content: Buffer.from('b') });
    try {
      const first = await call<DriveFilePage>('GET', '/integrations/google-drive/files?kind=audio', salesCookie);
      expect(first.body.data.files).toHaveLength(50);
      expect(first.body.data.nextPageToken).toBe('50');
      const second = await call<DriveFilePage>('GET', `/integrations/google-drive/files?kind=audio&pageToken=${first.body.data.nextPageToken}`, salesCookie);
      expect(second.body.data.files).toHaveLength(2);
      expect(second.body.data.nextPageToken).toBeNull();
    } finally {
      for (let i = 0; i < 50; i += 1) fake.files.delete(`bulkAudio${String(i).padStart(4, '0')}`);
    }
  });

  it('kind가 없거나 모르는 값이면 COM-004', async () => {
    expect((await call('GET', '/integrations/google-drive/files', salesCookie)).body.error?.code).toBe('COM-004');
    expect((await call('GET', '/integrations/google-drive/files?kind=pdf', salesCookie)).body.error?.code).toBe('COM-004');
  });
});

describe('GET integrations/google-drive/files/:fileId/content', () => {
  it('녹음 내용을 그대로 흘려보낸다 (MIME·이름·nosniff·sandbox)', async () => {
    const res = await fetch(`${baseUrl}/integrations/google-drive/files/audioNewest001/content`, { headers: { cookie: salesCookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mp4');
    expect(res.headers.get('content-disposition')).toContain(`filename*=UTF-8''${encodeURIComponent('주간 회의.m4a')}`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe('sandbox');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('fake-m4a-bytes');
  });

  it('사진도 열 수 있다', async () => {
    const res = await fetch(`${baseUrl}/integrations/google-drive/files/imagePhoto0005/content`, { headers: { cookie: salesCookie } });
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('fake-jpeg');
  });

  it('로그인이 필요하다', async () => {
    expect((await fetch(`${baseUrl}/integrations/google-drive/files/audioNewest001/content`)).status).toBe(401);
  });

  it('폴더 밖·휴지통·없는 파일·이상한 id는 같은 INT-012 (404)', async () => {
    for (const id of ['audioOutside04', 'audioTrashed03', 'missingFile0001', 'bad%2F..%2Fid']) {
      const { status, body } = await call('GET', `/integrations/google-drive/files/${id}/content`, salesCookie);
      expect([id, status, body.error?.code]).toEqual([id, 404, 'INT-012']);
    }
  });

  it('녹음·사진·문서가 아니면 INT-013 (SVG는 대소문자 상관없이·zip·Google 양식·폴더)', async () => {
    for (const id of ['imageSvgLogo06', 'imageSvgUpper13', 'otherZipFile021', 'docGoogleForm17', 'subFolder00011']) {
      const { status, body } = await call('GET', `/integrations/google-drive/files/${id}/content`, salesCookie);
      expect([id, status, body.error?.code]).toEqual([id, 400, 'INT-013']);
    }
  });

  it('사진이 20MB를 넘으면 INT-014 (메타데이터 크기, 응답 Content-Length)', async () => {
    const meta = await call('GET', '/integrations/google-drive/files/imageHuge00008/content', salesCookie);
    expect([meta.status, meta.body.error?.code]).toEqual([413, 'INT-014']);
    const header = await call('GET', '/integrations/google-drive/files/imageNoSize009/content', salesCookie);
    expect([header.status, header.body.error?.code]).toEqual([413, 'INT-014']);
  });

  it('PDF는 inline으로, nosniff·sandbox를 그대로 붙여 연다 (CSP를 낮추지 않는다)', async () => {
    const res = await fetch(`${baseUrl}/integrations/google-drive/files/docReportPdf07/content`, { headers: { cookie: salesCookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toMatch(/^inline; /);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe('sandbox');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('%PDF-1.7 fake');
  });

  it('download=1이면 attachment로 보낸다 (이름·MIME·보안 머리는 그대로). 0이나 다른 값은 기본·COM-004', async () => {
    for (const id of ['docReportPdf07', 'audioNewest001', 'imagePhoto0005']) {
      const res = await fetch(`${baseUrl}/integrations/google-drive/files/${id}/content?download=1`, { headers: { cookie: salesCookie } });
      expect([id, res.status, res.headers.get('content-disposition')?.split(';')[0]]).toEqual([id, 200, 'attachment']);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('content-security-policy')).toBe('sandbox');
      await res.arrayBuffer();
    }
    const pdf = await fetch(`${baseUrl}/integrations/google-drive/files/docReportPdf07/content?download=1`, { headers: { cookie: salesCookie } });
    expect(pdf.headers.get('content-disposition')).toContain(`filename*=UTF-8''${encodeURIComponent('보고서.pdf')}`);
    await pdf.arrayBuffer();
    const off = await fetch(`${baseUrl}/integrations/google-drive/files/docReportPdf07/content?download=0`, { headers: { cookie: salesCookie } });
    expect(off.headers.get('content-disposition')).toMatch(/^inline; /);
    await off.arrayBuffer();
    const bad = await call('GET', '/integrations/google-drive/files/docReportPdf07/content?download=yes', salesCookie);
    expect([bad.status, bad.body.error?.code]).toEqual([400, 'COM-004']);
  });

  it('Google 문서는 PDF로 내보내 보낸다: MIME은 application/pdf, 이름 끝에 .pdf, Range는 받지 않는다', async () => {
    const before = fake.ranges.length;
    const res = await fetch(`${baseUrl}/integrations/google-drive/files/docGoogleDoc014/content`, { headers: { cookie: salesCookie, range: 'bytes=0-3' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe(`inline; filename="__ __.pdf"; filename*=UTF-8''${encodeURIComponent('회의 안건.pdf')}`);
    expect(res.headers.get('accept-ranges')).toBe('none');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe('sandbox');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('%PDF-exported');
    expect(fake.exports.at(-1)).toBe('application/pdf');
    expect(fake.ranges.length).toBe(before);
    // 이름이 이미 .pdf로 끝나면 .pdf.pdf로 만들지 않고, download=1도 같다
    const sheet = await fetch(`${baseUrl}/integrations/google-drive/files/docGoogleSheet15/content?download=1`, { headers: { cookie: salesCookie } });
    expect(sheet.headers.get('content-disposition')).toContain(`filename*=UTF-8''${encodeURIComponent('재고 현황.pdf')}`);
    expect(sheet.headers.get('content-disposition')).toMatch(/^attachment; /);
    await sheet.arrayBuffer();
  });

  it('Google 문서가 Drive의 내보내기 상한(10MB)을 넘으면 INT-014로 이유를 알려 준다', async () => {
    const { status, body } = await call('GET', '/integrations/google-drive/files/docGoogleBig016/content', salesCookie);
    expect([status, body.error?.code]).toEqual([413, 'INT-014']);
    expect(body.error?.message).toContain('10MB');
    expect((await driveView()).lastError).toBeNull();
  });

  it('Office 파일은 열어 볼 수 없으니 download가 없어도 attachment', async () => {
    const res = await fetch(`${baseUrl}/integrations/google-drive/files/docWordFile018/content`, { headers: { cookie: salesCookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; /);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('fake-docx');
  });

  it('PDF가 50MB를 넘으면 INT-014, 폴더 밖 PDF는 INT-012', async () => {
    const big = await call('GET', '/integrations/google-drive/files/docPdfHuge0019/content', salesCookie);
    expect([big.status, big.body.error?.code]).toEqual([413, 'INT-014']);
    const outside = await call('GET', '/integrations/google-drive/files/docPdfOutside20/content', salesCookie);
    expect([outside.status, outside.body.error?.code]).toEqual([404, 'INT-012']);
  });

  it('Range 한 구간은 Drive로 넘겨 206 + Content-Range로 답한다', async () => {
    const res = await fetch(`${baseUrl}/integrations/google-drive/files/audioNewest001/content`, { headers: { cookie: salesCookie, range: 'bytes=0-3' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 0-3/14');
    expect(res.headers.get('content-length')).toBe('4');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('fake');
    expect(fake.ranges.at(-1)).toBe('bytes=0-3');
    const tail = await fetch(`${baseUrl}/integrations/google-drive/files/audioNewest001/content`, { headers: { cookie: salesCookie, range: 'bytes=10-' } });
    expect([tail.status, tail.headers.get('content-range')]).toEqual([206, 'bytes 10-13/14']);
    expect(Buffer.from(await tail.arrayBuffer()).toString()).toBe('ytes');
  });

  it('Range가 파일 크기를 넘으면 416, 여러 구간·이상한 값은 무시하고 전체를 준다', async () => {
    const beyond = await fetch(`${baseUrl}/integrations/google-drive/files/audioNewest001/content`, { headers: { cookie: salesCookie, range: 'bytes=100-' } });
    expect([beyond.status, beyond.headers.get('content-range')]).toEqual([416, 'bytes */14']);
    const before = fake.ranges.length;
    for (const range of ['bytes=0-1,4-5', 'items=0-3', 'bytes=5-2']) {
      const res = await fetch(`${baseUrl}/integrations/google-drive/files/audioNewest001/content`, { headers: { cookie: salesCookie, range } });
      expect([range, res.status]).toEqual([range, 200]);
      expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('fake-m4a-bytes');
    }
    expect(fake.ranges.length).toBe(before);
  });

  it('Content-Length는 메타데이터가 아니라 Drive 내용 응답의 것을 쓴다 (그 사이 파일이 바뀌어도 어긋나지 않음)', async () => {
    const res = await fetch(`${baseUrl}/integrations/google-drive/files/imageReplaced12/content`, { headers: { cookie: salesCookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe('9');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('new-webp!');
  });

  it('브라우저가 받기 전에 떠나면 연결 오류(last_error)로 남기지 않는다', async () => {
    expect((await driveView()).lastError).toBeNull();
    fake.mediaDelayMs = 400;
    try {
      const leave = new AbortController();
      const pending = fetch(`${baseUrl}/integrations/google-drive/files/audioNewest001/content`, { headers: { cookie: salesCookie }, signal: leave.signal }).catch(() => null);
      await new Promise((resolve) => setTimeout(resolve, 150));
      leave.abort();
      await pending;
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      fake.mediaDelayMs = 0;
    }
    const view = await driveView();
    expect(view.lastError).toBeNull();
    expect(view.status).toBe('CONNECTED');
  });

  it('크기를 모르고 받는 중에 상한을 넘으면 잘린 내용을 성공처럼 끝내지 않고 끊는다', async () => {
    const res = await fetch(`${baseUrl}/integrations/google-drive/files/imageChunked10/content`, { headers: { cookie: salesCookie } });
    expect(res.status).toBe(200);
    await expect(res.arrayBuffer()).rejects.toThrow();
  });
});

describe('POST meeting-minutes/audio/from-drive', () => {
  const body = (overrides: Record<string, unknown> = {}) => ({ meetingMinutesTitle: '  Drive 녹음 회의  ', meetingDate: '2026-10-15', attendeeIds: [purchaseId, adminId], driveFileId: 'audioNewest001', ...overrides });

  beforeEach(() => {
    sttClient.transcribe.mockReset();
  });

  it('Drive 녹음을 받아 음성 올리기와 같은 전사 작업에 넘긴다', async () => {
    sttClient.transcribe.mockResolvedValue({ text: '전체', segments: [{ start: 0, end: 1, text: ' 다음 주 출하 일정 확인 ' }], durationSec: 1 });
    const { status, body: res } = await call<MeetingMinutesView>('POST', '/meeting-minutes/audio/from-drive', purchaseCookie, body());
    expect(status).toBe(201);
    expect(res.data).toMatchObject({ meetingMinutesTitle: 'Drive 녹음 회의', meetingMinutesStatus: 'TRANSCRIBING', transcript: null, creator: { id: purchaseId } });
    await runner.drain();
    const [, input] = sttClient.transcribe.mock.calls[0] as [unknown, { audio: Buffer; fileName: string; mimeType: string; speakerCount: number }];
    expect(input.audio.toString()).toBe('fake-m4a-bytes');
    expect(input).toMatchObject({ fileName: '주간 회의.m4a', mimeType: 'audio/mp4', speakerCount: 2 });
    const detail = await call<MeetingMinutesView>('GET', `/meeting-minutes/${res.data.id}`, purchaseCookie);
    expect(detail.body.data).toMatchObject({ meetingMinutesStatus: 'TRANSCRIBED', transcript: '다음 주 출하 일정 확인' });
  });

  it('녹음이 아니거나 폴더 밖이면 회의록을 만들지 않고 거절한다', async () => {
    const before = await prisma.meetingMinutes.count();
    const image = await call('POST', '/meeting-minutes/audio/from-drive', purchaseCookie, body({ driveFileId: 'imagePhoto0005' }));
    expect([image.status, image.body.error?.code]).toEqual([400, 'INT-013']);
    const outside = await call('POST', '/meeting-minutes/audio/from-drive', purchaseCookie, body({ driveFileId: 'audioOutside04' }));
    expect([outside.status, outside.body.error?.code]).toEqual([404, 'INT-012']);
    const badId = await call('POST', '/meeting-minutes/audio/from-drive', purchaseCookie, body({ driveFileId: '../x' }));
    expect([badId.status, badId.body.error?.code]).toEqual([400, 'COM-004']);
    const noAttendee = await call('POST', '/meeting-minutes/audio/from-drive', purchaseCookie, body({ attendeeIds: [] }));
    expect(noAttendee.status).toBe(400);
    expect(await prisma.meetingMinutes.count()).toBe(before);
    expect(sttClient.transcribe).not.toHaveBeenCalled();
  });

  it('로그인이 필요하다', async () => {
    expect((await call('POST', '/meeting-minutes/audio/from-drive', null, body())).status).toBe(401);
  });

  it('백그라운드에서 Drive 받기가 실패하면 FAILED + 이유', async () => {
    fake.mediaFails = true;
    try {
      const { status, body: res } = await call<MeetingMinutesView>('POST', '/meeting-minutes/audio/from-drive', purchaseCookie, body());
      expect(status).toBe(201);
      await runner.drain();
      const detail = await call<MeetingMinutesView>('GET', `/meeting-minutes/${res.data.id}`, purchaseCookie);
      expect(detail.body.data.meetingMinutesStatus).toBe('FAILED');
      expect(detail.body.data.failureReason).toMatch(/^Drive에서 녹음을 받지 못했어요: /);
      expect(sttClient.transcribe).not.toHaveBeenCalled();
    } finally {
      fake.mediaFails = false;
    }
  });
});

describe('토큰 갱신', () => {
  it('저장된 액세스 토큰이 만료됐으면 미리 갱신하고 새 토큰으로 부른다 (리프레시 토큰은 잇는다)', async () => {
    await expireStoredToken();
    const before = fake.refreshGrants;
    const { status } = await call('GET', '/integrations/google-drive/files?kind=audio', salesCookie);
    expect(status).toBe(200);
    expect(fake.refreshGrants).toBe(before + 1);
    const tokens = await storedTokens();
    expect(fake.bearers.at(-1)).toBe(tokens.accessToken);
    expect(tokens.refreshToken).toBe('g-refresh-1');
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
  });

  it('Drive가 액세스 토큰을 거절하면(401) 한 번 갱신해 다시 보낸다', async () => {
    fake.accessTokens.delete((await storedTokens()).accessToken);
    const before = fake.refreshGrants;
    const { status } = await call('GET', '/integrations/google-drive/files?kind=image', salesCookie);
    expect(status).toBe(200);
    expect(fake.refreshGrants).toBe(before + 1);
  });

  it('갱신이 일시적으로 실패하면(5xx) 토큰을 지키고 INT-004, 회복하면 이어 간다', async () => {
    await expireStoredToken();
    fake.refreshFails = true;
    try {
      const { status, body } = await call('GET', '/integrations/google-drive/files?kind=audio', salesCookie);
      expect([status, body.error?.code]).toEqual([502, 'INT-004']);
      expect((await driveRow()).oauthTokens).not.toBeNull();
      const view = await driveView();
      expect(view.status).toBe('CONNECTED');
      expect(view.lastError).toContain('갱신하지 못했어요');
    } finally {
      fake.refreshFails = false;
    }
    expect((await call('GET', '/integrations/google-drive/files?kind=audio', salesCookie)).status).toBe(200);
    expect((await driveView()).lastError).toBeNull();
  });

  it('리프레시 토큰이 거절되면(invalid_grant) 토큰을 지우고 RECONNECT_REQUIRED·INT-003', async () => {
    await expireStoredToken();
    fake.refreshTokens.clear();
    const { status, body } = await call('GET', '/integrations/google-drive/files?kind=audio', salesCookie);
    expect([status, body.error?.code]).toEqual([409, 'INT-003']);
    expect((await driveRow()).oauthTokens).toBeNull();
    const view = await driveView();
    expect(view.status).toBe('RECONNECT_REQUIRED');
    expect(view.lastError).toContain('다시 연결');
    // 다음 호출도 같은 이유로 막힌다
    expect((await call('POST', '/meeting-minutes/audio/from-drive', purchaseCookie, { meetingMinutesTitle: 'x', meetingDate: '2026-10-15', attendeeIds: [purchaseId], driveFileId: 'audioNewest001' })).body.error?.code).toBe('INT-003');
    const test = await call<IntegrationTestResult>('POST', '/integrations/google-drive/test', adminCookie);
    expect(test.body.data).toMatchObject({ ok: false, driveFolder: null });
  });
});

describe('다시 연결·끊기', () => {
  it('Drive 읽기 권한을 빼고 허용하면 연결하지 않고, 지금 연결이 없으므로 방금 받은 허용을 거둔다', async () => {
    fake.grantScope = FILE_SCOPE;
    try {
      const revokedBefore = fake.revoked.length;
      const location = new URL(await connectFlow());
      expect(location.searchParams.get('result')).toBe('error');
      expect(location.searchParams.get('message')).toContain('Drive 읽기 권한');
      expect((await driveView()).status).toBe('RECONNECT_REQUIRED');
      expect(fake.revoked.slice(revokedBefore)).toEqual([`g-refresh-${fake.issued}`]);
    } finally {
      fake.grantScope = `${READ_SCOPE} ${FILE_SCOPE}`;
    }
  });

  it('PKCE verifier가 맞지 않거나 코드가 틀리면 연결하지 않는다', async () => {
    const location = new URL(await connectFlow('bad-code'));
    expect(location.searchParams.get('result')).toBe('error');
    expect((await driveView()).status).toBe('RECONNECT_REQUIRED');
  });

  it('다시 연결하면 CONNECTED로 돌아온다', async () => {
    expect(await connectFlow()).toBe('http://client.test/admin/integrations?integration=google-drive&result=connected');
    expect(await driveView()).toMatchObject({ status: 'CONNECTED', lastError: null });
    expect((await call('GET', '/integrations/google-drive/files?kind=audio', salesCookie)).status).toBe(200);
    expect((await storedTokens()).accountId).toBe('acct-1');
  });

  it('같은 계정으로 다시 연결하면 옛 리프레시 토큰을 취소하지 않는다 (취소가 새 허용까지 끊으므로)', async () => {
    const old = (await storedTokens()).refreshToken;
    const revokedBefore = fake.revoked.length;
    expect(new URL(await connectFlow()).searchParams.get('result')).toBe('connected');
    expect((await storedTokens()).refreshToken).not.toBe(old);
    expect(fake.revoked.length).toBe(revokedBefore);
  });

  it('같은 계정으로 Drive 권한을 빼고 다시 허용하면 지금 연결을 지키려고 취소하지 않는다', async () => {
    const current = (await storedTokens()).refreshToken;
    const revokedBefore = fake.revoked.length;
    fake.grantScope = FILE_SCOPE;
    try {
      expect(new URL(await connectFlow()).searchParams.get('result')).toBe('error');
    } finally {
      fake.grantScope = `${READ_SCOPE} ${FILE_SCOPE}`;
    }
    expect(fake.revoked.length).toBe(revokedBefore);
    expect((await storedTokens()).refreshToken).toBe(current);
    expect((await driveView()).status).toBe('CONNECTED');
  });

  it('다른 계정으로 다시 연결하면 새 토큰을 저장한 뒤 옛 계정의 허용을 거둔다', async () => {
    const old = (await storedTokens()).refreshToken;
    fake.accountId = 'acct-2';
    try {
      expect(new URL(await connectFlow()).searchParams.get('result')).toBe('connected');
      expect(fake.revoked).toContain(old);
      expect(await storedTokens()).toMatchObject({ accountId: 'acct-2' });
      expect((await call('GET', '/integrations/google-drive/files?kind=audio', salesCookie)).status).toBe(200);
    } finally {
      fake.accountId = 'acct-1';
    }
  });

  it('끊기: Google에 허용 취소를 보내고 토큰을 지운다. client id·secret과 폴더는 남긴다', async () => {
    const refreshToken = (await storedTokens()).refreshToken;
    expect((await call('POST', '/integrations/google-drive/disconnect', purchaseCookie)).status).toBe(403);
    const { status, body } = await call<IntegrationConnectionView>('POST', '/integrations/google-drive/disconnect', adminCookie);
    expect(status).toBe(200);
    expect(fake.revoked).toContain(refreshToken);
    expect(body.data).toMatchObject({ status: 'NOT_CONNECTED', connectedAt: null, oauthClient: { clientId: CLIENT_ID, clientSecretSet: true }, settings: { folderId: FOLDER } });
    expect((await driveRow()).oauthTokens).toBeNull();
    expect((await call('GET', '/integrations/google-drive/files?kind=audio', salesCookie)).body.error?.code).toBe('INT-002');
  });

  it('client id를 바꾸면 옛 클라이언트의 토큰을 지운다 (다시 연결 필요)', async () => {
    await connectFlow();
    expect((await driveView()).status).toBe('CONNECTED');
    const { body } = await call<IntegrationConnectionView>('PUT', '/integrations/google-drive/settings', adminCookie, { clientId: 'other-client.apps.googleusercontent.com' });
    expect(body.data).toMatchObject({ status: 'RECONNECT_REQUIRED', oauthClient: { clientId: 'other-client.apps.googleusercontent.com', clientSecretSet: true } });
    // secret만 바꾸면(같은 클라이언트의 secret 교체) 토큰은 그대로다
    await call('PUT', '/integrations/google-drive/settings', adminCookie, { clientId: CLIENT_ID });
    await connectFlow();
    const rotated = await call<IntegrationConnectionView>('PUT', '/integrations/google-drive/settings', adminCookie, { clientSecret: CLIENT_SECRET });
    expect(rotated.body.data.status).toBe('CONNECTED');
  });

  it('폴더를 비우면 파일 목록은 INT-011', async () => {
    await call('PUT', '/integrations/google-drive/settings', adminCookie, { folder: null });
    const { status, body } = await call('GET', '/integrations/google-drive/files?kind=audio', salesCookie);
    expect([status, body.error?.code]).toEqual([409, 'INT-011']);
    const test = await call<IntegrationTestResult>('POST', '/integrations/google-drive/test', adminCookie);
    expect(test.body.data).toMatchObject({ ok: false });
    expect(test.body.data.error).toContain('폴더');
  });
});
