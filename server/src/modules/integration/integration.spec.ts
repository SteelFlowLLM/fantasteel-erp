// 외부 연결(Notion MCP)과 회의록 Notion 내보내기를 실제 앱·DB(fs_collab)와 이 파일 안의 가짜 OAuth·MCP 서버로 확인한다.
// 가짜 서버는 MCP SDK의 Server + Streamable HTTP로 notion-create-pages 도구를 흉내 내고, OAuth 발견·동적 등록·PKCE 토큰 교환·갱신을 한다.
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { MEETING_MINUTES_STATUS, type IntegrationConnectResult, type IntegrationConnectionView, type IntegrationTestResult, type MeetingNotionExportResult } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

const PARENT_ID = '1a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6';
const CREATED_ID = 'aaaabbbbccccddddeeeeffff00001111';

/** 가짜 OAuth·MCP 서버가 기억하는 것. 시험이 토큰을 무효로 만들거나 받은 호출을 본다 */
const fake = {
  origin: '',
  accessTokens: new Set<string>(),
  refreshTokens: new Set<string>(),
  /** 시험이 허용 화면 주소에서 읽어 둔 PKCE challenge */
  pendingChallenge: null as string | null,
  issued: 0,
  registrations: 0,
  refreshGrants: 0,
  calls: [] as { name: string; args: Record<string, unknown> }[],
  /** 리프레시 요청에 500으로 답한다 (일시적 장애) */
  refreshFails: false,
  /** notion-create-pages 답: 정상 · 주소 없는 성공 · 오류 */
  createResponse: 'ok' as 'ok' | 'no-url' | 'error',
  /** 도구 목록·도구 호출을 받을 때 시험이 끼워 넣는 일 */
  onListTools: null as (() => Promise<void>) | null,
  onCallTool: null as (() => Promise<void>) | null,
  tools: [
    { name: 'notion-search', description: '검색', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
    {
      name: 'notion-create-pages',
      description: '페이지 만들기',
      inputSchema: { type: 'object', properties: { parent: { type: 'object' }, pages: { type: 'array' }, allow_async: { type: 'boolean' } }, required: ['pages'] },
    },
  ] as Tool[],
};

function issueTokens(): Record<string, unknown> {
  fake.issued += 1;
  const access = `access-${fake.issued}`;
  const refresh = `refresh-${fake.issued}`;
  fake.accessTokens.add(access);
  fake.refreshTokens.add(refresh);
  return { access_token: access, token_type: 'Bearer', expires_in: 3600, refresh_token: refresh };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function handleMcp(req: IncomingMessage, res: ServerResponse, body: string): Promise<void> {
  const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
  if (!token || !fake.accessTokens.has(token)) {
    res.writeHead(401, { 'www-authenticate': `Bearer resource_metadata="${fake.origin}/.well-known/oauth-protected-resource/mcp"` }).end();
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405).end();
    return;
  }
  const server = new McpServer({ name: 'fake-notion', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    await fake.onListTools?.();
    return { tools: fake.tools };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    fake.calls.push({ name: request.params.name, args: request.params.arguments ?? {} });
    await fake.onCallTool?.();
    if (fake.createResponse === 'error') return { content: [{ type: 'text', text: 'Could not find parent page' }], isError: true };
    if (fake.createResponse === 'no-url') return { content: [{ type: 'text', text: 'Accepted' }] };
    return { content: [{ type: 'text', text: JSON.stringify({ pages: [{ id: CREATED_ID, url: `https://www.notion.so/Meeting-${CREATED_ID}`, properties: {} }] }) }] };
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, JSON.parse(body) as unknown);
}

async function handleFake(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', fake.origin);
  const body = await readBody(req);
  if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
    return json(res, 200, { resource: `${fake.origin}/mcp`, authorization_servers: [fake.origin] });
  }
  if (url.pathname === '/.well-known/oauth-authorization-server') {
    return json(res, 200, {
      issuer: fake.origin,
      authorization_endpoint: `${fake.origin}/authorize`,
      token_endpoint: `${fake.origin}/token`,
      registration_endpoint: `${fake.origin}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  }
  if (url.pathname === '/register' && req.method === 'POST') {
    fake.registrations += 1;
    return json(res, 201, { ...(JSON.parse(body) as Record<string, unknown>), client_id: `fake-client-${fake.registrations}`, client_id_issued_at: Math.floor(Date.now() / 1000) });
  }
  if (url.pathname === '/token' && req.method === 'POST') {
    const form = new URLSearchParams(body);
    if (form.get('grant_type') === 'authorization_code') {
      const verifier = form.get('code_verifier') ?? '';
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      if (form.get('code') !== 'good-code' || challenge !== fake.pendingChallenge) return json(res, 400, { error: 'invalid_grant' });
      fake.pendingChallenge = null;
      return json(res, 200, issueTokens());
    }
    if (form.get('grant_type') === 'refresh_token') {
      fake.refreshGrants += 1;
      if (fake.refreshFails) return json(res, 500, { message: 'temporarily unavailable' });
      const refresh = form.get('refresh_token') ?? '';
      if (!fake.refreshTokens.delete(refresh)) return json(res, 400, { error: 'invalid_grant' });
      return json(res, 200, issueTokens());
    }
    return json(res, 400, { error: 'unsupported_grant_type' });
  }
  if (url.pathname === '/mcp') return handleMcp(req, res, body);
  res.writeHead(404).end();
}

let fakeServer: HttpServer;
let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
/** 이현정 (ADMIN, ORG_MANAGE 사용) */
let adminCookie: string;
let adminId: number;
/** 정다은 (구매) — 회의록 작성자 */
let purchaseCookie: string;
let purchaseId: number;
/** 김영업 (영업) — 작성자도 관리자도 아님 */
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
  return { status: res.status, body: (await res.json()) as { success: boolean; data: T; error?: { code: string; message: string } } };
}

async function notionView(): Promise<IntegrationConnectionView> {
  const { body } = await call<IntegrationConnectionView[]>('GET', '/integrations', salesCookie);
  const view = body.data.find((v) => v.providerKey === 'notion');
  if (!view) throw new Error('notion 연결이 목록에 없어요');
  return view;
}

/** 확정된 회의록을 바로 만든다 (AI 정리·등록 흐름은 meeting-register.spec.ts가 본다) */
async function confirmedMeeting(creatorId: number, status: string = MEETING_MINUTES_STATUS.CONFIRMED): Promise<number> {
  const confirmed = status === MEETING_MINUTES_STATUS.CONFIRMED;
  const row = await prisma.meetingMinutes.create({
    data: {
      meetingMinutesTitle: '원료 수급 점검 회의',
      meetingDate: new Date('2026-10-14T00:00:00.000Z'),
      meetingMinutesStatus: status,
      transcript: '정다은: 철광석 120톤 더 필요해요',
      summary: '철광석 보충을 정했어요',
      creatorId,
      confirmedAt: confirmed ? new Date('2026-10-15T05:00:00.000Z') : null,
      attendees: { create: [{ employeeId: creatorId }] },
    },
    select: { id: true },
  });
  return row.id;
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
  process.env.NOTION_MCP_URL = `${fake.origin}/mcp`;
  process.env.CLIENT_BASE_URL = 'http://client.test';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  process.env.SERVER_PUBLIC_URL = baseUrl;
  prisma = app.get(PrismaService);
  adminCookie = await login('1503001');
  purchaseCookie = await login('2207005');
  salesCookie = await login('2103003');
  adminId = (await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '1503001' } })).id;
  purchaseId = (await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2207005' } })).id;
}, 60_000);

afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => fakeServer?.close(() => resolve()));
});

describe('연결 전', () => {
  it('목록은 로그인만 보고, 연결하지 않은 상태로 보인다', async () => {
    expect((await call('GET', '/integrations', null)).status).toBe(401);
    const view = await notionView();
    expect(view).toEqual({
      providerKey: 'notion',
      displayName: 'Notion',
      protocol: 'MCP',
      serverUrl: `${fake.origin}/mcp`,
      status: 'NOT_CONNECTED',
      connectedAt: null,
      connectedBy: null,
      lastError: null,
      settings: { parentPageId: null },
      redirectUri: null,
      oauthClient: null,
    });
  });

  it('연결하지 않았으면 내보내기는 INT-002', async () => {
    const id = await confirmedMeeting(purchaseId);
    const { status, body } = await call('POST', `/meeting-minutes/${id}/notion-export`, purchaseCookie);
    expect(status).toBe(409);
    expect(body.error?.code).toBe('INT-002');
  });

  it('없는 연결 대상은 INT-001', async () => {
    const { status, body } = await call('PUT', '/integrations/dropbox/settings', adminCookie, { parentPage: PARENT_ID });
    expect(status).toBe(404);
    expect(body.error?.code).toBe('INT-001');
  });
});

describe('PUT integrations/:providerKey/settings', () => {
  it('관리자가 아니면 COM-002', async () => {
    const { status, body } = await call('PUT', '/integrations/notion/settings', salesCookie, { parentPage: PARENT_ID });
    expect(status).toBe(403);
    expect(body.error?.code).toBe('COM-002');
  });

  it('Notion 페이지 주소에서 id를 읽어 저장한다', async () => {
    const { status, body } = await call<IntegrationConnectionView>('PUT', '/integrations/notion/settings', adminCookie, { parentPage: `https://www.notion.so/fantasteel/Meetings-${PARENT_ID}?pvs=4` });
    expect(status).toBe(200);
    expect(body.data.settings).toEqual({ parentPageId: PARENT_ID });
  });

  it('읽을 수 없는 값은 COM-004로 거절하고 그대로 둔다', async () => {
    const { status, body } = await call('PUT', '/integrations/notion/settings', adminCookie, { parentPage: 'https://example.com/page' });
    expect(status).toBe(400);
    expect(body.error?.code).toBe('COM-004');
    expect((await notionView()).settings.parentPageId).toBe(PARENT_ID);
  });
});

describe('OAuth 연결', () => {
  let state: string;

  it('관리자가 아니면 연결을 시작할 수 없다', async () => {
    expect((await call('POST', '/integrations/notion/connect', purchaseCookie)).status).toBe(403);
  });

  it('연결 시작: 동적 등록 뒤 PKCE·state가 붙은 허용 화면 주소를 준다', async () => {
    const { status, body } = await call<IntegrationConnectResult>('POST', '/integrations/notion/connect', adminCookie);
    expect(status).toBe(200);
    const url = new URL(body.data.authorizationUrl);
    expect(`${url.origin}${url.pathname}`).toBe(`${fake.origin}/authorize`);
    expect(url.searchParams.get('client_id')).toBe('fake-client-1');
    expect(url.searchParams.get('redirect_uri')).toBe(`${baseUrl}/integrations/oauth/callback`);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    state = url.searchParams.get('state') ?? '';
    expect(state.length).toBeGreaterThan(20);
    fake.pendingChallenge = url.searchParams.get('code_challenge');

    // 비밀값은 암호문으로만 남는다
    const row = await prisma.integrationConnection.findUniqueOrThrow({ where: { providerKey: 'notion' } });
    expect(row.oauthState).toBe(state);
    expect(row.oauthCodeVerifier?.startsWith('v1:')).toBe(true);
    expect(row.oauthClientInformation).not.toContain('fake-client');
  });

  it('콜백: 로그인 없이 state로 찾아 토큰을 받고 화면으로 돌려보낸다', async () => {
    const res = await fetch(`${baseUrl}/integrations/oauth/callback?code=good-code&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://client.test/admin/integrations?integration=notion&result=connected');

    const row = await prisma.integrationConnection.findUniqueOrThrow({ where: { providerKey: 'notion' } });
    expect(row.oauthTokens?.startsWith('v1:')).toBe(true);
    expect(row.oauthTokens).not.toContain('access-');
    expect(row.oauthState).toBeNull();
    expect(row.oauthCodeVerifier).toBeNull();
    const view = await notionView();
    expect(view).toMatchObject({ status: 'CONNECTED', connectedBy: { id: adminId }, lastError: null });
    expect(view.connectedAt).not.toBeNull();
  });

  it('같은 state를 다시 쓰거나 모르는 state면 오류 쿼리로 돌려보낸다', async () => {
    const again = await fetch(`${baseUrl}/integrations/oauth/callback?code=good-code&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
    expect(again.status).toBe(302);
    expect(new URL(again.headers.get('location') ?? '').searchParams.get('result')).toBe('error');
    const unknown = await fetch(`${baseUrl}/integrations/oauth/callback?error=access_denied`, { redirect: 'manual' });
    expect(new URL(unknown.headers.get('location') ?? '').searchParams.get('result')).toBe('error');
    expect((await notionView()).status).toBe('CONNECTED');
  });

  it('연결 확인: 도구 목록을 받고 필요한 도구가 있는지 본다', async () => {
    const { status, body } = await call<IntegrationTestResult>('POST', '/integrations/notion/test', adminCookie);
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ ok: true, tools: ['notion-search', 'notion-create-pages'], missingTools: [], error: null, driveFolder: null });
  });

  it('액세스 토큰이 만료되면 리프레시 토큰으로 갱신해 이어 간다', async () => {
    fake.accessTokens.clear();
    const before = fake.refreshGrants;
    const { body } = await call<IntegrationTestResult>('POST', '/integrations/notion/test', adminCookie);
    expect(body.data.ok).toBe(true);
    expect(fake.refreshGrants).toBe(before + 1);
  });

  it('갱신 요청이 일시적으로 실패하면 토큰을 지우지 않고 INT-004로 알린다', async () => {
    fake.accessTokens.clear();
    fake.refreshFails = true;
    const id = await confirmedMeeting(purchaseId);
    const failed = await call('POST', `/meeting-minutes/${id}/notion-export`, purchaseCookie);
    const test = await call<IntegrationTestResult>('POST', '/integrations/notion/test', adminCookie);
    fake.refreshFails = false;
    expect(failed.status).toBe(502);
    expect(failed.body.error?.code).toBe('INT-004');
    expect(test.body.data).toMatchObject({ ok: false, error: expect.stringContaining('잠시 뒤') });
    expect((await prisma.integrationConnection.findUniqueOrThrow({ where: { providerKey: 'notion' } })).oauthTokens).not.toBeNull();
    expect((await notionView()).status).toBe('CONNECTED');
    // 장애가 지나면 남겨 둔 리프레시 토큰으로 이어 간다
    expect((await call<IntegrationTestResult>('POST', '/integrations/notion/test', adminCookie)).body.data.ok).toBe(true);
  });

  it('다시 연결: 허용이 끝날 때까지 옛 토큰을 쓰고, 다른 사원으로 로그인한 콜백은 거절한다', async () => {
    const start = async () => {
      const { body } = await call<IntegrationConnectResult>('POST', '/integrations/notion/connect', adminCookie);
      const url = new URL(body.data.authorizationUrl);
      fake.pendingChallenge = url.searchParams.get('code_challenge');
      return url.searchParams.get('state') ?? '';
    };
    const issuedBefore = fake.issued;
    const first = await start();
    expect((await notionView()).status).toBe('CONNECTED');
    expect((await call<IntegrationTestResult>('POST', '/integrations/notion/test', adminCookie)).body.data.ok).toBe(true);

    const wrongUser = await fetch(`${baseUrl}/integrations/oauth/callback?code=good-code&state=${encodeURIComponent(first)}`, { redirect: 'manual', headers: { cookie: salesCookie } });
    const wrongUrl = new URL(wrongUser.headers.get('location') ?? '');
    expect(wrongUrl.searchParams.get('result')).toBe('error');
    expect(wrongUrl.searchParams.get('message')).toContain('연결을 시작한 관리자');
    expect(fake.issued).toBe(issuedBefore);
    expect((await call<IntegrationTestResult>('POST', '/integrations/notion/test', adminCookie)).body.data.ok).toBe(true);

    const second = await start();
    const ok = await fetch(`${baseUrl}/integrations/oauth/callback?code=good-code&state=${encodeURIComponent(second)}`, { redirect: 'manual', headers: { cookie: adminCookie } });
    expect(new URL(ok.headers.get('location') ?? '').searchParams.get('result')).toBe('connected');
    expect(fake.issued).toBe(issuedBefore + 1);
    expect(fake.registrations).toBe(1);
    expect((await call<IntegrationTestResult>('POST', '/integrations/notion/test', adminCookie)).body.data.ok).toBe(true);
  });
});

describe('POST meeting-minutes/:id/notion-export', () => {
  it('작성자도 관리자도 아니면 VOC-003', async () => {
    const id = await confirmedMeeting(purchaseId);
    const { status, body } = await call('POST', `/meeting-minutes/${id}/notion-export`, salesCookie);
    expect(status).toBe(403);
    expect(body.error?.code).toBe('VOC-003');
  });

  it('확정 전이면 VOC-004', async () => {
    const id = await confirmedMeeting(purchaseId, MEETING_MINUTES_STATUS.REVIEW);
    const { status, body } = await call('POST', `/meeting-minutes/${id}/notion-export`, purchaseCookie);
    expect(status).toBe(409);
    expect(body.error?.code).toBe('VOC-004');
  });

  it('작성자가 내보내면 상위 페이지 아래 페이지를 만들고 주소를 남긴다. 두 번째는 VOC-008', async () => {
    const id = await confirmedMeeting(purchaseId);
    fake.calls = [];
    const { status, body } = await call<MeetingNotionExportResult>('POST', `/meeting-minutes/${id}/notion-export`, purchaseCookie);
    expect(status).toBe(200);
    const url = `https://www.notion.so/Meeting-${CREATED_ID}`;
    expect(body.data.notionPageUrl).toBe(url);
    expect(body.data.meetingMinutes).toMatchObject({ id, notionPageUrl: url, notionExportedAt: body.data.notionExportedAt });

    expect(fake.calls).toHaveLength(1);
    const { name, args } = fake.calls[0];
    expect(name).toBe('notion-create-pages');
    expect(args).toMatchObject({ parent: { type: 'page_id', page_id: PARENT_ID }, pages: [{ properties: { title: '원료 수급 점검 회의' } }], allow_async: false });
    const content = (args.pages as { content: string }[])[0].content;
    expect(content).toContain('**회의일** 2026-10-14');
    expect(content).toContain('## 요약\n철광석 보충을 정했어요');

    const again = await call('POST', `/meeting-minutes/${id}/notion-export`, purchaseCookie);
    expect(again.status).toBe(409);
    expect(again.body.error?.code).toBe('VOC-008');
    expect(fake.calls).toHaveLength(1);
  });

  it('회의록은 도구를 부르기 바로 전에 잡는다 (도구 목록을 받을 때는 아직 잡지 않음)', async () => {
    const id = await confirmedMeeting(purchaseId);
    const seen: Record<string, Date | null> = {};
    const exportedAtNow = async () => (await prisma.meetingMinutes.findUniqueOrThrow({ where: { id } })).notionExportedAt;
    fake.onListTools = async () => {
      seen.listTools = await exportedAtNow();
    };
    fake.onCallTool = async () => {
      seen.callTool = await exportedAtNow();
    };
    const { status } = await call('POST', `/meeting-minutes/${id}/notion-export`, purchaseCookie);
    fake.onListTools = null;
    fake.onCallTool = null;
    expect(status).toBe(200);
    expect(seen.listTools).toBeNull();
    expect(seen.callTool).toBeInstanceOf(Date);
  });

  it('잡기를 잃으면(다른 요청이 가져감) 성공으로 답하지 않고 만든 주소를 문구에 담는다', async () => {
    const id = await confirmedMeeting(purchaseId);
    fake.onCallTool = async () => {
      await prisma.meetingMinutes.update({ where: { id }, data: { notionExportedAt: new Date('2000-01-01T00:00:00.000Z') } });
    };
    const { status, body } = await call('POST', `/meeting-minutes/${id}/notion-export`, purchaseCookie);
    fake.onCallTool = null;
    expect(status).toBe(409);
    expect(body.error?.code).toBe('COM-001');
    expect(body.error?.message).toContain(CREATED_ID);
    expect((await prisma.meetingMinutes.findUniqueOrThrow({ where: { id } })).notionPageUrl).toBeNull();
  });

  it('만들어졌는지 알 수 없으면 INT-009, 잡기를 남겨 바로 다시 눌러도 중복으로 만들지 않는다', async () => {
    const id = await confirmedMeeting(purchaseId);
    fake.createResponse = 'no-url';
    const { status, body } = await call('POST', `/meeting-minutes/${id}/notion-export`, purchaseCookie);
    fake.createResponse = 'ok';
    expect(status).toBe(502);
    expect(body.error?.code).toBe('INT-009');
    expect(body.error?.message).toContain('Notion에서 확인');
    const row = await prisma.meetingMinutes.findUniqueOrThrow({ where: { id } });
    expect(row.notionPageUrl).toBeNull();
    expect(row.notionExportedAt).not.toBeNull();

    const callsBefore = fake.calls.length;
    const retry = await call('POST', `/meeting-minutes/${id}/notion-export`, purchaseCookie);
    expect(retry.status).toBe(409);
    expect(retry.body.error?.code).toBe('VOC-008');
    expect(fake.calls).toHaveLength(callsBefore);
  });

  it('Notion이 오류로 답하면(만들지 않음) INT-004, 잡기를 풀어 다시 내보낼 수 있다', async () => {
    const id = await confirmedMeeting(purchaseId);
    fake.createResponse = 'error';
    const { status, body } = await call('POST', `/meeting-minutes/${id}/notion-export`, purchaseCookie);
    fake.createResponse = 'ok';
    expect(status).toBe(502);
    expect(body.error?.code).toBe('INT-004');
    expect((await prisma.meetingMinutes.findUniqueOrThrow({ where: { id } })).notionExportedAt).toBeNull();
    expect((await call('POST', `/meeting-minutes/${id}/notion-export`, purchaseCookie)).status).toBe(200);
  });

  it('관리자는 남의 회의록도 내보낸다', async () => {
    const id = await confirmedMeeting(purchaseId);
    const { status } = await call('POST', `/meeting-minutes/${id}/notion-export`, adminCookie);
    expect(status).toBe(200);
  });

  it('상위 페이지가 없으면 INT-006으로 막고 회의록을 잡지 않는다', async () => {
    await call('PUT', '/integrations/notion/settings', adminCookie, { parentPage: null });
    const id = await confirmedMeeting(purchaseId);
    const { status, body } = await call('POST', `/meeting-minutes/${id}/notion-export`, purchaseCookie);
    expect(status).toBe(409);
    expect(body.error?.code).toBe('INT-006');
    expect((await prisma.meetingMinutes.findUniqueOrThrow({ where: { id } })).notionExportedAt).toBeNull();
    await call('PUT', '/integrations/notion/settings', adminCookie, { parentPage: PARENT_ID });
  });

  it('필요한 도구가 없으면 INT-005, 잡은 것을 풀어 다시 내보낼 수 있다', async () => {
    const saved = fake.tools;
    fake.tools = saved.filter((t) => t.name !== 'notion-create-pages');
    const id = await confirmedMeeting(purchaseId);
    const { status, body } = await call('POST', `/meeting-minutes/${id}/notion-export`, purchaseCookie);
    fake.tools = saved;
    expect(status).toBe(502);
    expect(body.error?.code).toBe('INT-005');
    expect((await prisma.meetingMinutes.findUniqueOrThrow({ where: { id } })).notionExportedAt).toBeNull();
    expect((await call('POST', `/meeting-minutes/${id}/notion-export`, purchaseCookie)).status).toBe(200);
  });
});

describe('다시 연결이 필요할 때', () => {
  it('토큰이 모두 취소되면 INT-003, 상태는 RECONNECT_REQUIRED', async () => {
    fake.accessTokens.clear();
    fake.refreshTokens.clear();
    const id = await confirmedMeeting(purchaseId);
    const { status, body } = await call('POST', `/meeting-minutes/${id}/notion-export`, purchaseCookie);
    expect(status).toBe(409);
    expect(body.error?.code).toBe('INT-003');
    const view = await notionView();
    expect(view.status).toBe('RECONNECT_REQUIRED');
    expect(view.lastError).toContain('다시 연결');

    const test = await call<IntegrationTestResult>('POST', '/integrations/notion/test', adminCookie);
    expect(test.body.data).toMatchObject({ ok: false, error: expect.stringContaining('다시 연결') });
  });

  it('연결 끊기: 비밀값을 지우고 설정은 남긴다', async () => {
    const { status, body } = await call<IntegrationConnectionView>('POST', '/integrations/notion/disconnect', adminCookie);
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ status: 'NOT_CONNECTED', connectedAt: null, settings: { parentPageId: PARENT_ID } });
    const row = await prisma.integrationConnection.findUniqueOrThrow({ where: { providerKey: 'notion' } });
    expect([row.oauthClientInformation, row.oauthTokens, row.oauthCodeVerifier]).toEqual([null, null, null]);
  });
});
