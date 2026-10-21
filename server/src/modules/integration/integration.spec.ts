// 외부 연결(Notion MCP)과 회의록 Notion 내보내기를 실제 앱·DB(fs_collab)와 이 파일 안의 가짜 OAuth·MCP 서버로 확인한다.
// 가짜 서버는 MCP SDK의 Server + Streamable HTTP로 notion-create-pages·create-database·create-view·update-page 도구를 흉내 내고, OAuth 발견·동적 등록·PKCE 토큰 교환·갱신을 한다.
// Notion 업무 공간(이슈 #391): 데이터베이스 만들기·자동 반영(만들고 고치기)·실패한 행 남기기도 여기서 본다.
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { MEETING_MINUTES_STATUS, TASK_STATUS, type IntegrationConnectResult, type IntegrationConnectionView, type IntegrationTestResult, type MeetingNotionExportResult } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { PARENT_PAGE_NOT_FOUND_MESSAGE } from './notion/notion.tools';
import { NotionWorkspaceService } from './notion/notion-workspace.service';

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
  /** notion-create-pages 답: 정상 · 주소 없는 성공 · 오류 · 상위 페이지 없음(404) */
  createResponse: 'ok' as 'ok' | 'no-url' | 'error' | 'not-found',
  /** notion-create-database 답 */
  databaseResponse: 'ok' as 'ok' | 'not-found',
  /** Notion 캘린더: 연결된 캘린더가 없는 계정 · 일정 만들기·고치기 답 */
  noCalendars: false,
  /** 만든 데이터베이스: 데이터 소스 id → 데이터베이스 id (notion-fetch가 읽는다). fetchEmpty면 데이터베이스를 알려 주지 않는다 */
  databases: new Map<string, string>(),
  fetchEmpty: false,
  calendarResponse: 'ok' as 'ok' | 'error',
  /** notion-update-page 답 */
  updateResponse: 'ok' as 'ok' | 'error',
  /** 데이터베이스·페이지 id를 새로 매길 때 쓰는 수 */
  serial: 0,
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
    {
      name: 'notion-create-database',
      description: '데이터베이스 만들기',
      inputSchema: { type: 'object', properties: { parent: { type: 'object' }, title: { type: 'string' }, description: { type: 'string' }, schema: { type: 'string' } } },
    },
    {
      name: 'notion-create-view',
      description: '보기 만들기',
      inputSchema: {
        type: 'object',
        properties: { database_id: { type: 'string' }, parent_page_id: { type: 'string' }, data_source_id: { type: 'string' }, name: { type: 'string' }, type: { type: 'string' }, configure: { type: 'string' } },
        required: ['data_source_id', 'name', 'type'],
      },
    },
    { name: 'notion-fetch', description: '읽기', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
    { name: 'notion-calendar-list-calendars', description: '캘린더 목록', inputSchema: { type: 'object', properties: { onlyAccountEmails: { type: 'array' } } } },
    {
      name: 'notion-calendar-create-events',
      description: '일정 만들기',
      inputSchema: { type: 'object', properties: { timeZone: { type: 'string' }, events: { type: 'array' } }, required: ['timeZone', 'events'] },
    },
    {
      name: 'notion-calendar-update-events',
      description: '일정 고치기',
      inputSchema: { type: 'object', properties: { timeZone: { type: 'string' }, updates: { type: 'array' } }, required: ['timeZone', 'updates'] },
    },
    {
      name: 'notion-update-page',
      description: '페이지 고치기',
      inputSchema: {
        type: 'object',
        properties: { page_id: { type: 'string' }, command: { type: 'string' }, properties: { type: 'object' }, new_str: { type: 'string' }, allow_async: { type: 'boolean' } },
        required: ['page_id', 'command'],
      },
    },
  ] as Tool[],
};

/** 32자리 16진수 id. 앞자리는 종류(d 데이터베이스, c 데이터 소스, e 페이지) */
function nextId(prefix: string): string {
  fake.serial += 1;
  return `${prefix}${String(fake.serial).padStart(31, '0')}`;
}

function dashed(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type ToolAnswer = { content: { type: 'text'; text: string }[]; isError?: boolean };
const answer = (text: string, isError = false): ToolAnswer => ({ content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) });

/** 실제 Notion MCP처럼 데이터베이스는 마크다운(<database>·<data-source> 태그), 페이지는 JSON으로 답한다 */
function callFakeTool(name: string, args: Record<string, unknown>): ToolAnswer {
  const notFound = 'API error: {"status":404,"code":"object_not_found","message":"Could not find page with ID"}';
  if (name === 'notion-calendar-list-calendars') {
    if (fake.noCalendars) return answer(JSON.stringify({ accounts: [] }));
    return answer(
      JSON.stringify({
        accounts: [
          {
            accountId: 'acc-1',
            email: 'erp@fantasteel.test',
            calendars: [
              { calendarId: 'erp-cal', name: 'ERP 일정', accessRole: 'owner', primary: true },
              { calendarId: 'holiday', name: '대한민국 휴일', accessRole: 'reader' },
            ],
          },
        ],
      }),
    );
  }
  if (name === 'notion-calendar-create-events') {
    if (fake.calendarResponse === 'error') return answer('Calendar is not writable', true);
    return answer(JSON.stringify({ events: (args.events as unknown[]).map(() => ({ eventId: `evt-${nextId('f')}` })) }));
  }
  if (name === 'notion-calendar-update-events') return fake.calendarResponse === 'error' ? answer('Event not found', true) : answer(JSON.stringify({ updated: 1 }));
  if (name === 'notion-create-database') {
    if (fake.databaseResponse === 'not-found') return answer(notFound, true);
    const db = nextId('d');
    const ds = dashed(nextId('c'));
    fake.databases.set(ds, db);
    // 실제 Notion처럼 app.notion.com/p/<id> 주소를 {{…}}로 감싼다
    return answer(`Created database "${String(args.title)}".\n<database url="{{https://app.notion.com/p/${db}}}" inline="false">\n<data-source url="{{collection://${ds}}}">\n${String(args.schema)}\n</data-source>\n</database>`);
  }
  if (name === 'notion-fetch') {
    const ds = String(args.id).replace('collection://', '');
    const db = fake.databases.get(ds);
    if (fake.fetchEmpty || !db) return answer(`<data-source url="{{collection://${ds}}}">\nCREATE TABLE ("제목" TITLE)\n</data-source>`);
    return answer(`<data-source url="{{collection://${ds}}}">\n<parent-database url="{{https://app.notion.com/p/${db}}}"/>\n</data-source>`);
  }
  if (name === 'notion-create-view') return answer('Created view.');
  if (name === 'notion-update-page') return fake.updateResponse === 'error' ? answer('Could not find page', true) : answer(JSON.stringify({ page_id: args.page_id }));
  if (fake.createResponse === 'error') return answer('Could not find parent page', true);
  if (fake.createResponse === 'not-found') return answer(notFound, true);
  if (fake.createResponse === 'no-url') return answer('Accepted');
  const parent = args.parent as { type?: string } | undefined;
  if (parent?.type === 'data_source_id') {
    const pages = (args.pages as unknown[]).map(() => {
      const id = nextId('e');
      return { id: dashed(id), url: `https://app.notion.com/p/${id}?pvs=204`, properties: {} };
    });
    return answer(JSON.stringify({ pages }));
  }
  return answer(JSON.stringify({ pages: [{ id: CREATED_ID, url: `https://www.notion.so/Meeting-${CREATED_ID}`, properties: {} }] }));
}

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
    return callFakeTool(request.params.name, request.params.arguments ?? {});
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

async function call<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, cookie: string | null, payload?: unknown) {
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
      authMode: 'OAUTH',
      serviceAccountEmail: null,
      driveFolderFromEnv: false,
      notionWorkspace: null,
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
    expect(body.data).toMatchObject({
      ok: true,
      tools: [
        'notion-search',
        'notion-create-pages',
        'notion-create-database',
        'notion-create-view',
        'notion-fetch',
        'notion-calendar-list-calendars',
        'notion-calendar-create-events',
        'notion-calendar-update-events',
        'notion-update-page',
      ],
      missingTools: [],
      error: null,
      driveFolder: null,
    });
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

  it('상위 페이지를 찾지 못하면(404) 알아볼 수 있는 문구로 INT-004, 잡기를 풀어 다시 내보낼 수 있다', async () => {
    const id = await confirmedMeeting(purchaseId);
    fake.createResponse = 'not-found';
    const { status, body } = await call('POST', `/meeting-minutes/${id}/notion-export`, purchaseCookie);
    fake.createResponse = 'ok';
    expect(status).toBe(502);
    expect(body.error).toEqual({ code: 'INT-004', message: PARENT_PAGE_NOT_FOUND_MESSAGE });
    expect((await prisma.meetingMinutes.findUniqueOrThrow({ where: { id } })).notionExportedAt).toBeNull();
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

describe('Notion 업무 공간 (이슈 #391)', () => {
  const DAY = 86_400_000;
  const sync = () => app.get(NotionWorkspaceService).runNow();
  const dueDate = () => new Date(Date.now() + 3 * DAY).toISOString().slice(0, 10);
  const HEX32 = /^[0-9a-f]{32}$/;
  // 같은 묶음 DB(fs_collab)를 쓰는 업무·일정 테스트가 개수를 세므로 여기서 만든 업무·일정은 끝나고 지운다
  const taskIds: number[] = [];
  const scheduleEventIds: number[] = [];

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.scheduleEventAttendee.deleteMany({ where: { scheduleEventId: { in: scheduleEventIds } } });
    await prisma.scheduleEvent.deleteMany({ where: { id: { in: scheduleEventIds } } });
  });

  async function workspaceSettings() {
    const row = await prisma.integrationConnection.findUniqueOrThrow({ where: { providerKey: 'notion' } });
    return (row.settings as { notionWorkspace: Record<'scheduleEvents' | 'meetingMinutes' | 'tasks', { dataSourceId: string; databaseId: string | null; url: string | null; views?: string[] }> }).notionWorkspace;
  }

  /** 이 데이터 소스에 만든 페이지 (보낸 속성·본문) */
  function createdIn(dataSourceId: string) {
    return fake.calls
      .filter((c) => c.name === 'notion-create-pages' && (c.args.parent as { data_source_id?: string }).data_source_id === dataSourceId)
      .flatMap((c) => c.args.pages as { properties: Record<string, unknown>; content?: string }[]);
  }

  function updatesOf(pageId: string | null) {
    return fake.calls.filter((c) => c.name === 'notion-update-page' && c.args.page_id === pageId);
  }

  async function createTask(title: string): Promise<number> {
    const { status, body } = await call<{ id: number }>('POST', '/tasks', purchaseCookie, { taskTitle: title, assigneeId: purchaseId, dueDate: dueDate() });
    expect(status).toBe(201);
    taskIds.push(body.data.id);
    return body.data.id;
  }

  it('업무 공간을 만들기 전에는 반영하지 않는다 (Notion을 부르지 않음)', async () => {
    fake.calls = [];
    const id = await createTask('만들기 전 업무');
    await sync();
    expect(fake.calls).toEqual([]);
    expect((await prisma.task.findUniqueOrThrow({ where: { id } })).notionSyncedAt).toBeNull();
    expect((await notionView()).notionWorkspace).toBeNull();
  });

  it('관리자가 아니면 만들 수 없다', async () => {
    const { status, body } = await call('POST', '/integrations/notion/workspace', purchaseCookie);
    expect(status).toBe(403);
    expect(body.error?.code).toBe('COM-002');
  });

  it('상위 페이지를 찾지 못하면(404) 알아볼 수 있는 문구로 INT-004, 카드의 마지막 오류에도 남고 아무것도 저장하지 않는다', async () => {
    fake.databaseResponse = 'not-found';
    const { status, body } = await call('POST', '/integrations/notion/workspace', adminCookie);
    fake.databaseResponse = 'ok';
    expect(status).toBe(502);
    expect(body.error).toEqual({ code: 'INT-004', message: PARENT_PAGE_NOT_FOUND_MESSAGE });
    const view = await notionView();
    expect(view.lastError).toBe(PARENT_PAGE_NOT_FOUND_MESSAGE);
    expect(view.notionWorkspace).toBeNull();
  });

  it('만들기: 상위 페이지 아래 데이터베이스 3개와 보기를 한 번만 만들고, 지난 업무를 반영한다', async () => {
    fake.calls = [];
    const { status, body } = await call<IntegrationConnectionView>('POST', '/integrations/notion/workspace', adminCookie);
    expect(status).toBe(200);
    expect(body.data.notionWorkspace).toMatchObject({
      ready: true,
      databases: [
        { key: 'scheduleEvents', title: 'ERP 일정' },
        { key: 'meetingMinutes', title: 'ERP 회의록' },
        { key: 'tasks', title: 'ERP 할 일' },
      ],
    });
    expect(body.data.notionWorkspace?.createdAt).not.toBeNull();
    expect(body.data.lastError).toBeNull();
    const databases = fake.calls.filter((c) => c.name === 'notion-create-database');
    expect(databases.map((c) => c.args.title)).toEqual(['ERP 일정', 'ERP 회의록', 'ERP 할 일']);
    expect(databases[0].args.parent).toEqual({ type: 'page_id', page_id: PARENT_ID });
    expect(String(databases[2].args.schema)).toContain(`'정다은'`);
    const views = fake.calls.filter((c) => c.name === 'notion-create-view');
    expect(views).toHaveLength(7);
    expect(views.find((v) => v.args.name === '담당자별')?.args).toMatchObject({ type: 'board', configure: 'GROUP BY "담당자"' });

    const ws = await workspaceSettings();
    expect(ws.tasks.databaseId).toMatch(HEX32);
    expect(ws.tasks).toMatchObject({ url: `https://app.notion.com/p/${ws.tasks.databaseId}`, views: ['상태별', '담당자별', '마감일순'] });
    expect(views.find((v) => v.args.name === '상태별')?.args).toMatchObject({ database_id: ws.tasks.databaseId, data_source_id: ws.tasks.dataSourceId });
    expect(views.every((v) => !('parent_page_id' in v.args))).toBe(true);

    // 두 번째는 만들지 않는다
    const again = await call<IntegrationConnectionView>('POST', '/integrations/notion/workspace', adminCookie);
    expect(again.status).toBe(200);
    expect(fake.calls.filter((c) => c.name === 'notion-create-database')).toHaveLength(3);
    expect(await workspaceSettings()).toEqual(ws);

    // 만든 뒤 반영: 만들기 전에 등록한 업무도 할 일 데이터베이스에 들어간다
    await sync();
    const before = await prisma.task.findFirstOrThrow({ where: { taskTitle: '만들기 전 업무' } });
    expect(before.notionPageId).toMatch(HEX32);
    expect(before.notionSyncedAt?.getTime()).toBe(before.updatedAt.getTime());
    expect(createdIn(ws.tasks.dataSourceId).some((p) => p.properties['번호'] === before.id)).toBe(true);
  });

  it('1단계 업무 공간 고치기: 데이터베이스 id를 모르면 데이터 소스를 읽어 찾고, 빠진 보기를 데이터베이스 탭으로 한 번만 만든다', async () => {
    await sync();
    const row = await prisma.integrationConnection.findUniqueOrThrow({ where: { providerKey: 'notion' } });
    const settings = row.settings as { notionWorkspace: Record<string, Record<string, unknown>> };
    const original = { ...settings.notionWorkspace.tasks };
    // 1단계 버그로 남은 모양: 데이터베이스 id·주소 없음, 보기 기록 없음
    settings.notionWorkspace.tasks = { dataSourceId: original.dataSourceId, databaseId: null, url: null };
    const tamper = () => prisma.integrationConnection.update({ where: { providerKey: 'notion' }, data: { settings: settings as object } });

    // 데이터 소스를 읽어도 데이터베이스를 모르면 보기를 건너뛰고 안내를 남긴다 (상위 페이지에 붙이지 않는다)
    await tamper();
    fake.fetchEmpty = true;
    fake.calls = [];
    await sync();
    fake.fetchEmpty = false;
    expect(fake.calls.filter((c) => c.name === 'notion-fetch').map((c) => c.args)).toEqual([{ id: `collection://${String(original.dataSourceId)}` }]);
    expect(fake.calls.filter((c) => c.name === 'notion-create-view')).toEqual([]);
    expect((await notionView()).notionWorkspace?.setupWarning).toContain('ERP 할 일');

    // "이어서 만들기"(같은 단추)도 고친다: 이번에는 찾아서 보기 탭을 만든다
    fake.calls = [];
    expect((await call('POST', '/integrations/notion/workspace', adminCookie)).status).toBe(200);
    const views = fake.calls.filter((c) => c.name === 'notion-create-view');
    expect(views.map((v) => v.args.name)).toEqual(['상태별', '담당자별', '마감일순']);
    expect(views.every((v) => v.args.database_id === original.databaseId && !('parent_page_id' in v.args))).toBe(true);
    expect(fake.calls.filter((c) => c.name === 'notion-create-database')).toEqual([]);
    const repaired = (await workspaceSettings()).tasks;
    expect(repaired).toEqual({ dataSourceId: original.dataSourceId, databaseId: original.databaseId, url: `https://app.notion.com/p/${String(original.databaseId)}`, views: ['상태별', '담당자별', '마감일순'] });
    expect((await notionView()).notionWorkspace?.setupWarning).toBeNull();

    // 다시 눌러도 보기를 또 만들지 않는다
    fake.calls = [];
    await call('POST', '/integrations/notion/workspace', adminCookie);
    expect(fake.calls.filter((c) => c.name === 'notion-create-view' || c.name === 'notion-create-database')).toEqual([]);
  });

  it('일정: 만들고, 바뀌지 않으면 다시 보내지 않고, 고치면 같은 페이지의 속성을 고친다', async () => {
    const ws = await workspaceSettings();
    const start = new Date(Date.now() + 2 * DAY);
    fake.calls = [];
    const created = await call<{ id: number }>('POST', '/schedule-events', purchaseCookie, {
      scheduleEventTitle: '공급사 미팅',
      scheduleEventDescription: null,
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + 3_600_000).toISOString(),
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    scheduleEventIds.push(id);
    await sync();
    const page = createdIn(ws.scheduleEvents.dataSourceId).find((p) => p.properties['번호'] === id);
    expect(page?.properties).toMatchObject({ 제목: '공급사 미팅', 'date:일시:is_datetime': 1, 참석자: '정다은', 등록자: '정다은', ERP: expect.stringContaining('http://client.test/schedule?week=') });
    const row = await prisma.scheduleEvent.findUniqueOrThrow({ where: { id } });
    expect(row.notionPageId).toMatch(HEX32);
    expect(row.notionSyncedAt?.getTime()).toBe(row.updatedAt.getTime());

    fake.calls = [];
    await sync();
    expect(createdIn(ws.scheduleEvents.dataSourceId).filter((p) => p.properties['번호'] === id)).toEqual([]);
    expect(updatesOf(row.notionPageId)).toEqual([]);

    const patched = await call('PATCH', `/schedule-events/${id}`, purchaseCookie, {
      scheduleEventTitle: '공급사 미팅 (장소 변경)',
      scheduleEventDescription: '2층 회의실',
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + 3_600_000).toISOString(),
    });
    expect(patched.status).toBe(200);
    await sync();
    const updates = updatesOf(row.notionPageId);
    expect(updates).toHaveLength(1);
    expect(updates[0].args).toMatchObject({ command: 'update_properties', properties: { 제목: '공급사 미팅 (장소 변경)', 설명: '2층 회의실' } });
    expect(createdIn(ws.scheduleEvents.dataSourceId).filter((p) => p.properties['번호'] === id)).toEqual([]);
  });

  it('일정: Notion에 넣지 않기로 한 일정은 만들지 않고, 상태 조회는 준비됨으로 답한다 (이슈 #434)', async () => {
    const ws = await workspaceSettings();
    const status = await call<{ ready: boolean; reason: string | null }>('GET', '/schedule-events/notion-status', purchaseCookie);
    expect(status.body.data).toMatchObject({ ready: true, reason: null });
    const start = new Date(Date.now() + 3 * DAY);
    fake.calls = [];
    const created = await call<{ id: number; notionSync: boolean; notionPageUrl: string | null }>('POST', '/schedule-events', purchaseCookie, {
      scheduleEventTitle: '개인 병원 예약',
      scheduleEventDescription: null,
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + 3_600_000).toISOString(),
      notionSync: false,
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ notionSync: false, notionPageUrl: null });
    const id = created.body.data.id;
    scheduleEventIds.push(id);
    await sync();
    expect(createdIn(ws.scheduleEvents.dataSourceId).filter((p) => p.properties['번호'] === id)).toEqual([]);
    expect((await prisma.scheduleEvent.findUniqueOrThrow({ where: { id } })).notionPageId).toBeNull();

    // 다시 켜면 다음 반영 때 만들고, 내 일정에 Notion 주소가 보인다
    const patched = await call('PATCH', `/schedule-events/${id}`, purchaseCookie, {
      scheduleEventTitle: '개인 병원 예약',
      scheduleEventDescription: null,
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + 3_600_000).toISOString(),
      notionSync: true,
    });
    expect(patched.status).toBe(200);
    await sync();
    expect(createdIn(ws.scheduleEvents.dataSourceId).filter((p) => p.properties['번호'] === id)).toHaveLength(1);
    const day = new Date(start.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
    const mine = await call<{ id: number; notionPageUrl: string | null }[]>('GET', `/schedule-events?from=${day}&to=${day}`, purchaseCookie);
    expect(mine.body.data.find((e) => e.id === id)?.notionPageUrl).toMatch(/^https:\/\/www\.notion\.so\/[0-9a-f]{32}$/);
  });

  it('업무: 완료하면(조건부 updateMany) 같은 페이지의 상태를 고친다', async () => {
    const ws = await workspaceSettings();
    const id = await createTask('견적서 보내기');
    await sync();
    const row = await prisma.task.findUniqueOrThrow({ where: { id } });
    expect(row.notionPageId).toMatch(HEX32);
    expect(createdIn(ws.tasks.dataSourceId).find((p) => p.properties['번호'] === id)?.properties).toMatchObject({ 상태: '진행', 담당자: '정다은', 출처: '직접 등록' });

    fake.calls = [];
    expect((await call('POST', `/tasks/${id}/complete`, purchaseCookie)).status).toBe(200);
    await sync();
    const updates = updatesOf(row.notionPageId);
    expect(updates).toHaveLength(1);
    expect(updates[0].args).toMatchObject({ properties: { 상태: '완료' } });
    const done = await prisma.task.findUniqueOrThrow({ where: { id } });
    expect(done.taskStatus).toBe(TASK_STATUS.DONE);
    expect(done.notionSyncedAt?.getTime()).toBe(done.updatedAt.getTime());
  });

  it('회의록: 확정한 회의록은 회의록 데이터베이스에 본문과 함께 만들고 주소를 남긴다. 직접 내보내기는 VOC-008', async () => {
    await sync();
    const ws = await workspaceSettings();
    const id = await confirmedMeeting(purchaseId);
    fake.calls = [];
    await sync();
    const page = createdIn(ws.meetingMinutes.dataSourceId).find((p) => p.properties['번호'] === id);
    expect(page?.properties).toMatchObject({ 제목: '원료 수급 점검 회의', 'date:회의일:start': '2026-10-14', ERP: `http://client.test/meetings?id=${id}` });
    expect(page?.content).toContain('## 요약\n철광석 보충을 정했어요');
    const row = await prisma.meetingMinutes.findUniqueOrThrow({ where: { id } });
    expect(row.notionPageId).toMatch(HEX32);
    // 실제 응답의 ?pvs=204는 떼고 남긴다
    expect(row.notionPageUrl).toBe(`https://app.notion.com/p/${row.notionPageId}`);
    expect(row.notionExportedAt).not.toBeNull();
    expect(row.notionSyncedAt?.getTime()).toBe(row.updatedAt.getTime());

    const again = await call('POST', `/meeting-minutes/${id}/notion-export`, purchaseCookie);
    expect(again.status).toBe(409);
    expect(again.body.error?.code).toBe('VOC-008');

    // 회의록이 바뀌면 같은 페이지의 속성과 본문을 고친다
    await prisma.meetingMinutes.update({ where: { id }, data: { summary: '철광석 150톤으로 늘렸어요' } });
    fake.calls = [];
    await sync();
    const updates = updatesOf(row.notionPageId);
    expect(updates.map((c) => c.args.command)).toEqual(['update_properties', 'replace_content']);
    expect(updates[1].args.new_str).toContain('철광석 150톤으로 늘렸어요');
    expect(createdIn(ws.meetingMinutes.dataSourceId)).toEqual([]);
  });

  it('업무 공간이 있으면 "Notion으로 내보내기"도 상위 페이지가 아니라 회의록 데이터베이스에 만든다', async () => {
    await sync();
    const ws = await workspaceSettings();
    const id = await confirmedMeeting(purchaseId);
    fake.calls = [];
    const { status, body } = await call<MeetingNotionExportResult>('POST', `/meeting-minutes/${id}/notion-export`, purchaseCookie);
    expect(status).toBe(200);
    expect(body.data.notionPageUrl).toMatch(/^https:\/\/app\.notion\.com\/p\/[0-9a-f]{32}$/);
    expect(body.data.meetingMinutes).toMatchObject({ id, notionPageUrl: body.data.notionPageUrl });
    expect(fake.calls.filter((c) => c.name === 'notion-create-pages')).toHaveLength(1);
    expect(createdIn(ws.meetingMinutes.dataSourceId).map((p) => p.properties['번호'])).toEqual([id]);
  });

  it('Notion이 오류로 답하면 행을 반영하지 않은 채로 두고, 관리 화면에 실패 수와 이유를 보인다', async () => {
    await sync();
    fake.createResponse = 'error';
    const id = await createTask('실패할 업무');
    await sync();
    fake.createResponse = 'ok';
    const row = await prisma.task.findUniqueOrThrow({ where: { id } });
    expect(row.notionPageId).toBeNull();
    expect(row.notionSyncedAt).toBeNull();
    const view = (await notionView()).notionWorkspace;
    expect(view?.failedCount).toBeGreaterThanOrEqual(1);
    expect(view?.pendingCount).toBeGreaterThanOrEqual(1);
    expect(view?.lastSyncError).toContain('Could not find parent page');
    expect(view?.lastSyncedAt).not.toBeNull();

    // 실패한 행은 잠시 미루므로 바로 다시 돌아도 Notion을 부르지 않는다
    fake.calls = [];
    await sync();
    expect(fake.calls.filter((c) => c.name === 'notion-create-pages')).toEqual([]);
  });

  it('만들었는지 알 수 없는 답이면(페이지 id 없음) 행을 반영하지 않은 채로 두고 오래 미룬다', async () => {
    await sync();
    fake.createResponse = 'no-url';
    const id = await createTask('결과를 모르는 업무');
    await sync();
    fake.createResponse = 'ok';
    expect((await prisma.task.findUniqueOrThrow({ where: { id } })).notionPageId).toBeNull();
    fake.calls = [];
    await sync();
    expect(fake.calls.filter((c) => c.name === 'notion-create-pages')).toEqual([]);
  });

  it('페이지 고치기가 실패해도 행을 남겨 둔다', async () => {
    await sync();
    const id = await createTask('고치기 실패');
    await sync();
    fake.updateResponse = 'error';
    await call('PATCH', `/tasks/${id}`, purchaseCookie, { taskTitle: '고치기 실패 (바뀜)' });
    await sync();
    fake.updateResponse = 'ok';
    const row = await prisma.task.findUniqueOrThrow({ where: { id } });
    expect(row.notionPageId).toMatch(HEX32);
    expect(row.notionSyncedAt?.getTime()).toBeLessThan(row.updatedAt.getTime());
  });
});

describe('Notion 캘린더 (이슈 #391 2단계)', () => {
  const DAY = 86_400_000;
  const sync = () => app.get(NotionWorkspaceService).runNow();
  const CAL = { accountId: 'acc-1', calendarId: 'erp-cal' };
  const eventIds: number[] = [];
  let salesId: number;

  beforeAll(async () => {
    salesId = (await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2103003' } })).id;
    // 정다은만 메일이 있다 (김영업은 없음)
    await prisma.employee.update({ where: { id: purchaseId }, data: { email: 'jung@fantasteel.test' } });
  });

  afterAll(async () => {
    await prisma.employee.update({ where: { id: purchaseId }, data: { email: null } });
    await prisma.scheduleEventAttendee.deleteMany({ where: { scheduleEventId: { in: eventIds } } });
    await prisma.scheduleEvent.deleteMany({ where: { id: { in: eventIds } } });
  });

  /** 정다은·김영업이 참석하는 앞으로의 일정 (저장 직후 반영은 service가 깨우므로 여기서는 runNow로 직접 돌린다) */
  async function makeEvent(title: string): Promise<number> {
    const start = new Date(Date.now() + 3 * DAY);
    const row = await prisma.scheduleEvent.create({
      data: { scheduleEventTitle: title, startAt: start, endAt: new Date(start.getTime() + 3_600_000), creatorId: purchaseId, attendees: { create: [{ employeeId: purchaseId }, { employeeId: salesId }] } },
      select: { id: true },
    });
    eventIds.push(row.id);
    return row.id;
  }

  const calendarCalls = () => fake.calls.filter((c) => c.name.startsWith('notion-calendar-'));
  const createdEvents = () => calendarCalls().filter((c) => c.name === 'notion-calendar-create-events').flatMap((c) => c.args.events as Record<string, unknown>[]);
  const eventUpdates = (eventId: string | null) =>
    calendarCalls()
      .filter((c) => c.name === 'notion-calendar-update-events')
      .flatMap((c) => c.args.updates as { event: { eventId: string }; update: Record<string, unknown> }[])
      .filter((u) => u.event.eventId === eventId);
  const pageCreatesFor = (id: number) =>
    fake.calls.filter((c) => c.name === 'notion-create-pages').flatMap((c) => c.args.pages as { properties: Record<string, unknown> }[]).filter((p) => p.properties['번호'] === id);

  it('캘린더를 고르지 않았으면 캘린더를 부르지 않고 일정 데이터베이스만 반영한다', async () => {
    await sync();
    const id = await makeEvent('캘린더 전 일정');
    fake.calls = [];
    await sync();
    expect(calendarCalls()).toEqual([]);
    const row = await prisma.scheduleEvent.findUniqueOrThrow({ where: { id } });
    expect(row.notionPageId).toMatch(/^[0-9a-f]{32}$/);
    expect(row.notionCalendarEventId).toBeNull();
    expect(row.notionSyncedAt?.getTime()).toBe(row.updatedAt.getTime());
    expect((await notionView()).notionWorkspace?.calendar).toBeNull();
  });

  it('캘린더 목록: 관리자만, 계정별 캘린더를 한 줄씩. 연결된 캘린더가 없으면 빈 목록', async () => {
    expect((await call('GET', '/integrations/notion/calendars', purchaseCookie)).status).toBe(403);
    const { status, body } = await call<{ calendarId: string; writable: boolean | null }[]>('GET', '/integrations/notion/calendars', adminCookie);
    expect(status).toBe(200);
    expect(body.data).toEqual([
      { accountId: 'acc-1', accountEmail: 'erp@fantasteel.test', calendarId: 'erp-cal', name: 'ERP 일정', primary: true, writable: true },
      { accountId: 'acc-1', accountEmail: 'erp@fantasteel.test', calendarId: 'holiday', name: '대한민국 휴일', primary: false, writable: false },
    ]);
    fake.noCalendars = true;
    const empty = await call<unknown[]>('GET', '/integrations/notion/calendars', adminCookie);
    fake.noCalendars = false;
    expect(empty.body.data).toEqual([]);
  });

  it('캘린더 고르기: 목록에 없거나 읽기 전용이면 COM-004, 고르면 앞으로의 일정을 그 캘린더에 만든다 (초대는 기본 꺼짐)', async () => {
    expect((await call('PUT', '/integrations/notion/calendar', purchaseCookie, CAL)).status).toBe(403);
    expect((await call('PUT', '/integrations/notion/calendar', adminCookie, { accountId: 'acc-1', calendarId: 'nope' })).body.error?.code).toBe('COM-004');
    expect((await call('PUT', '/integrations/notion/calendar', adminCookie, { accountId: 'acc-1', calendarId: 'holiday' })).body.error?.code).toBe('COM-004');
    expect((await call('PUT', '/integrations/notion/calendar', adminCookie, { sendInvites: true })).body.error?.code).toBe('COM-004');

    const { status, body } = await call<IntegrationConnectionView>('PUT', '/integrations/notion/calendar', adminCookie, CAL);
    expect(status).toBe(200);
    expect(body.data.notionWorkspace?.calendar).toEqual({ ...CAL, name: 'ERP 일정', accountEmail: 'erp@fantasteel.test', sendInvites: false });

    fake.calls = [];
    await sync();
    const before = await prisma.scheduleEvent.findFirstOrThrow({ where: { scheduleEventTitle: '캘린더 전 일정' } });
    expect(before.notionCalendarEventId).toMatch(/^evt-/);
    const created = createdEvents().find((e) => e.summary === '캘린더 전 일정');
    expect(created).toMatchObject({ calendar: CAL, disableConferencing: true, period: { type: 'DATE_TIME' } });
    expect(created).not.toHaveProperty('attendees');
    expect(String(created?.description)).toContain('ERP: http://client.test/schedule?week=');
    // 페이지는 이미 있어 새로 만들지 않는다
    expect(pageCreatesFor(before.id)).toEqual([]);
    expect(before.notionSyncedAt?.getTime()).toBe(before.updatedAt.getTime());
  });

  it('일정을 고치면 같은 캘린더 일정을 고친다 (새로 만들지 않음)', async () => {
    const id = await makeEvent('캘린더 일정');
    await sync();
    const row = await prisma.scheduleEvent.findUniqueOrThrow({ where: { id } });
    expect(row.notionCalendarEventId).toMatch(/^evt-/);

    await prisma.scheduleEvent.update({ where: { id }, data: { scheduleEventTitle: '캘린더 일정 (시간 변경)' } });
    fake.calls = [];
    await sync();
    const updates = eventUpdates(row.notionCalendarEventId);
    expect(updates).toHaveLength(1);
    expect(updates[0].update).toMatchObject({ summary: '캘린더 일정 (시간 변경)' });
    expect(updates[0].update).not.toHaveProperty('attendees');
    expect(createdEvents()).toEqual([]);
    expect(pageCreatesFor(id)).toEqual([]);
    expect((await prisma.scheduleEvent.findUniqueOrThrow({ where: { id } })).notionCalendarEventId).toBe(row.notionCalendarEventId);
  });

  it('초대를 켜면 참석자 중 메일이 있는 사원만 보낸다 (이미 만든 일정도 다시 보낸다)', async () => {
    const id = (await prisma.scheduleEvent.findFirstOrThrow({ where: { scheduleEventTitle: '캘린더 일정 (시간 변경)' } })).id;
    const { body } = await call<IntegrationConnectionView>('PUT', '/integrations/notion/calendar', adminCookie, { sendInvites: true });
    expect(body.data.notionWorkspace?.calendar?.sendInvites).toBe(true);
    fake.calls = [];
    await sync();
    const eventId = (await prisma.scheduleEvent.findUniqueOrThrow({ where: { id } })).notionCalendarEventId;
    expect(eventUpdates(eventId)[0]?.update.attendees).toEqual([{ email: 'jung@fantasteel.test', displayName: '정다은' }]);

    const fresh = await makeEvent('초대 일정');
    fake.calls = [];
    await sync();
    expect(createdEvents().find((e) => e.summary === '초대 일정')?.attendees).toEqual([{ email: 'jung@fantasteel.test', displayName: '정다은' }]);
    expect((await prisma.scheduleEvent.findUniqueOrThrow({ where: { id: fresh } })).notionCalendarEventId).toMatch(/^evt-/);
    await call('PUT', '/integrations/notion/calendar', adminCookie, { sendInvites: false });
    await sync();
  });

  it('캘린더 반영이 실패하면 행을 남기고, 다시 할 때 데이터베이스 페이지를 또 만들지 않는다', async () => {
    await sync();
    fake.calendarResponse = 'error';
    const id = await makeEvent('캘린더 실패 일정');
    fake.calls = [];
    await sync();
    fake.calendarResponse = 'ok';
    expect(pageCreatesFor(id)).toHaveLength(1);
    const failed = await prisma.scheduleEvent.findUniqueOrThrow({ where: { id } });
    expect(failed.notionPageId).toMatch(/^[0-9a-f]{32}$/);
    expect(failed.notionCalendarEventId).toBeNull();
    expect(failed.notionSyncedAt).toBeNull();
    expect((await notionView()).notionWorkspace?.lastSyncError).toContain('Calendar is not writable');

    // 설정을 다시 저장하면 미룬 일정을 풀어 바로 다시 해 본다
    await call('PUT', '/integrations/notion/calendar', adminCookie, { sendInvites: false, ...CAL });
    fake.calls = [];
    await sync();
    expect(pageCreatesFor(id)).toEqual([]);
    expect(createdEvents().filter((e) => e.summary === '캘린더 실패 일정')).toHaveLength(1);
    const done = await prisma.scheduleEvent.findUniqueOrThrow({ where: { id } });
    expect(done.notionPageId).toBe(failed.notionPageId);
    expect(done.notionCalendarEventId).toMatch(/^evt-/);
    expect(done.notionSyncedAt?.getTime()).toBe(done.updatedAt.getTime());
  });

  it('캘린더를 끄면(accountId null) 캘린더를 부르지 않는다', async () => {
    const { body } = await call<IntegrationConnectionView>('PUT', '/integrations/notion/calendar', adminCookie, { accountId: null });
    expect(body.data.notionWorkspace?.calendar).toBeNull();
    const id = await makeEvent('캘린더 끈 뒤 일정');
    fake.calls = [];
    await sync();
    expect(calendarCalls()).toEqual([]);
    expect((await prisma.scheduleEvent.findUniqueOrThrow({ where: { id } })).notionSyncedAt).not.toBeNull();
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
