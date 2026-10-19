// 철강맨AI의 Notion 읽기·쓰기 카드와 일정·업무 고치기 카드(이슈 #398)를 실제 앱·DB(fs_collab)와 이 파일 안의 가짜 Notion MCP 서버로 확인한다.
// 가짜 서버는 MCP SDK의 Server + Streamable HTTP로 notion-search·fetch·create-pages·update-page·query-data-sources를 흉내 내고,
// 페이지 나무(상위 페이지 · 그 아래 · 밖 · ERP가 채우는 데이터베이스와 행)를 들고 있다. OAuth는 integration.spec.ts가 보므로 여기서는 토큰을 바로 넣는다.
// 실제 Notion·LLM은 부르지 않는다.
import { Test, type TestingModule } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { INTEGRATION_PROVIDER, TASK_STATUS, type AiActionCard, type AiNotionCard, type AuthUser } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { AppException } from '../../common/errors/app.exception';
import { seoulToday } from '../../common/time/seoul-date';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationConnectionRepository } from '../integration/integration-connection.repository';
import { IntegrationTokenStore } from '../integration/integration-token.store';
import { NotionWorkspaceService } from '../integration/notion/notion-workspace.service';
import { AiAssistantService } from './ai-assistant.service';
import type { ExecuteAiActionCardDto } from './dto/ai-assistant.dto';
import { AssistantNotionToolbox } from './notion/assistant-notion-toolbox';
import { AssistantToolbox } from './tools/assistant-toolbox';

const ROOT = '0000000000000000000000000000aaaa';
const PARENT = '1a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6';
const MEETINGS = '2a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6';
const NOTE = '3a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6';
const OUTSIDE = '4a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6';
const MIRROR_DB = '5a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6';
const MIRROR_DS = '6a2b3c4d-5e6f-47a8-b9c0-d1e2f3a4b5c6';
const MIRROR_DS_HEX = MIRROR_DS.replace(/-/g, '');
const MIRROR_ROW = '7a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6';
const TOKEN = 'fake-notion-token';
const url = (id: string) => `https://www.notion.so/${id}`;

interface FakePage {
  id: string;
  kind: 'page' | 'database' | 'data_source';
  title: string;
  /** 바로 위 (페이지·데이터베이스·데이터 소스 id). 없으면 작업 공간 맨 위 */
  parent: string | null;
  body: string;
}

const fake = {
  origin: '',
  pages: new Map<string, FakePage>(),
  calls: [] as { name: string; args: Record<string, unknown> }[],
  /** notion-create-pages 답: 정상 · 주소 없는 성공(만들어졌을 수 있다) */
  createResponse: 'ok' as 'ok' | 'no-url',
  serial: 0,
};

function resetPages() {
  fake.pages.clear();
  const add = (page: FakePage) => fake.pages.set(page.id, page);
  add({ id: ROOT, kind: 'page', title: '회사 작업 공간', parent: null, body: '맨 위' });
  add({ id: PARENT, kind: 'page', title: 'Fantasteel_ERP', parent: ROOT, body: 'ERP 상위 페이지' });
  add({ id: MEETINGS, kind: 'page', title: '주간 회의', parent: PARENT, body: '# 안건\n<table><tr><td>마감</td><td>10/20</td></tr></table>\n담당: 정다은' });
  add({ id: NOTE, kind: 'page', title: '설비 메모', parent: MEETINGS, body: '설비 점검 메모' });
  add({ id: OUTSIDE, kind: 'page', title: '관리자 개인 메모', parent: ROOT, body: '개인 메모 (회의 비밀)' });
  add({ id: MIRROR_DB, kind: 'database', title: 'ERP 일정', parent: PARENT, body: '' });
  add({ id: MIRROR_DS_HEX, kind: 'data_source', title: 'ERP 일정', parent: MIRROR_DB, body: '' });
  add({ id: MIRROR_ROW, kind: 'page', title: '라인 점검', parent: MIRROR_DS_HEX, body: '' });
}

function ancestorsOf(id: string): FakePage[] {
  const out: FakePage[] = [];
  let parent = fake.pages.get(id)?.parent ?? null;
  while (parent) {
    const page = fake.pages.get(parent);
    if (!page) break;
    out.push(page);
    parent = page.parent;
  }
  return out;
}

const hexOf = (value: string) => value.replace(/^collection:\/\//, '').replace(/^https:\/\/www\.notion\.so\//, '').replace(/-/g, '').toLowerCase();
const dashed = (hex: string) => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
const linkOf = (page: FakePage) => (page.kind === 'data_source' ? `collection://${dashed(page.id)}` : url(page.id));

type ToolAnswer = { content: { type: 'text'; text: string }[]; isError?: boolean };
const answer = (text: string, isError = false): ToolAnswer => ({ content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) });
const notFound = answer('API error: {"status":404,"code":"object_not_found"}', true);

/** 실제 Notion MCP처럼 fetch는 { metadata, title, url, text } JSON, text에 <page>·<ancestor-path>·<content> 마크업 */
function fetchAnswer(page: FakePage): ToolAnswer {
  const tag = page.kind === 'data_source' ? 'data-source' : page.kind;
  const ancestors = ancestorsOf(page.id)
    .map((a, i) => `<${i === 0 ? 'parent' : `ancestor-${i + 1}`}-${a.kind === 'data_source' ? 'data-source' : a.kind} url="{{${linkOf(a)}}}" title="${a.title}"/>`)
    .join('\n');
  const inner =
    page.kind === 'database'
      ? `<data-source url="{{collection://${MIRROR_DS}}}">\nCREATE TABLE ("제목" TITLE, "일시" DATE)\n</data-source>`
      : page.kind === 'data_source'
        ? 'CREATE TABLE ("제목" TITLE, "일시" DATE)'
        : `<properties>\n{"title":"${page.title}"}\n</properties>\n<content>\n${page.body}\n</content>`;
  const text = `<${tag} url="{{${linkOf(page)}}}">\n<ancestor-path>\n${ancestors}\n</ancestor-path>\n${inner}\n</${tag}>`;
  return answer(JSON.stringify({ metadata: { type: page.kind === 'data_source' ? 'data_source' : page.kind }, title: page.title, url: linkOf(page), text }));
}

function callFakeTool(name: string, args: Record<string, unknown>): ToolAnswer {
  if (name === 'notion-fetch') {
    const page = fake.pages.get(hexOf(String(args.id)));
    return page ? fetchAnswer(page) : notFound;
  }
  if (name === 'notion-search') {
    const root = hexOf(String(args.page_url ?? ''));
    const query = String(args.query);
    const results = [...fake.pages.values()]
      .filter((p) => p.kind === 'page' && (p.id === root || ancestorsOf(p.id).some((a) => a.id === root)) && (p.title.includes(query) || p.body.includes(query)))
      .map((p) => ({ id: dashed(p.id), title: p.title, url: url(p.id), type: 'page', highlight: p.body.slice(0, 50), timestamp: '2026-10-19T00:00:00Z' }));
    return answer(JSON.stringify({ results, type: 'workspace_search' }));
  }
  if (name === 'notion-query-data-sources') return answer(JSON.stringify({ results: [{ 제목: '라인 점검', 'date:일시:start': '2026-10-21T14:00:00+09:00' }], has_more: false }));
  if (name === 'notion-create-pages') {
    if (fake.createResponse === 'no-url') return answer('Accepted');
    const parent = args.parent as { page_id: string };
    const pages = (args.pages as { properties: { title: string }; content: string }[]).map((draft) => {
      fake.serial += 1;
      const id = `9${String(fake.serial).padStart(31, '0')}`;
      fake.pages.set(id, { id, kind: 'page', title: draft.properties.title, parent: hexOf(parent.page_id), body: draft.content });
      return { id: dashed(id), url: `${url(id)}?pvs=204`, properties: {} };
    });
    return answer(JSON.stringify({ pages }));
  }
  if (name === 'notion-update-page') {
    const page = fake.pages.get(hexOf(String(args.page_id)));
    if (!page) return notFound;
    if (args.command === 'insert_content') page.body = `${page.body}\n${String(args.content)}`;
    else if (args.command === 'update_properties') page.title = String((args.properties as { title: string }).title);
    else if (args.command === 'update_content') {
      const updates = args.content_updates as { old_str: string; new_str: string }[];
      const missing = updates.filter((u) => !page.body.includes(u.old_str)).map((u) => u.old_str);
      if (missing.length === updates.length) return answer('No content_updates matched', true);
      for (const u of updates) page.body = page.body.replace(u.old_str, u.new_str);
      return answer(JSON.stringify({ page_id: args.page_id, ...(missing.length ? { warnings: missing.map((m) => `old_str not found: ${m}`) } : {}) }));
    } else return answer(`unsupported command ${String(args.command)}`, true);
    return answer(JSON.stringify({ page_id: args.page_id }));
  }
  return answer(`unknown tool ${name}`, true);
}

const shape = (name: string, properties: string[]): Tool => ({ name, inputSchema: { type: 'object', properties: Object.fromEntries(properties.map((p) => [p, { type: 'string' }])) } });
const TOOLS: Tool[] = [
  shape('notion-search', ['query', 'page_url', 'page_size', 'max_highlight_length', 'filters']),
  shape('notion-fetch', ['id']),
  shape('notion-query-data-sources', ['data']),
  shape('notion-create-pages', ['parent', 'pages', 'allow_async']),
  shape('notion-update-page', ['page_id', 'command', 'properties', 'content', 'content_updates', 'position', 'new_str', 'allow_async', 'allow_deleting_content']),
];

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    res.writeHead(401).end();
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405).end();
    return;
  }
  const server = new McpServer({ name: 'fake-notion', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    fake.calls.push({ name: request.params.name, args: request.params.arguments ?? {} });
    return callFakeTool(request.params.name, request.params.arguments ?? {});
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
}

let fakeServer: HttpServer;
let moduleRef: TestingModule;
let prisma: PrismaService;
let assistant: AiAssistantService;
let notionTools: AssistantNotionToolbox;
let toolbox: AssistantToolbox;
/** 정다은 (구매) */
let author: AuthUser;
/** 박서영 (영업) */
let sales: AuthUser;
let startEventId = 0;
let startTaskId = 0;
let startNotificationId = 0;

const writes = () => fake.calls.filter((c) => c.name === 'notion-create-pages' || c.name === 'notion-update-page');
const plusDays = (days: number): string => new Date(Date.parse(`${seoulToday()}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

async function settings(value: Record<string, unknown>) {
  await moduleRef.get(IntegrationConnectionRepository).update(prisma, INTEGRATION_PROVIDER.NOTION, { settings: value as Prisma.InputJsonObject });
}

const WORKSPACE = {
  parentPageId: PARENT,
  // 데이터베이스 하나만 넣어 자동 반영(세 개가 모두 있어야 돈다)은 돌지 않게 한다. 범위 규칙은 있는 것만으로 본다
  notionWorkspace: { scheduleEvents: { databaseId: MIRROR_DB, dataSourceId: MIRROR_DS, url: url(MIRROR_DB), views: [] } },
};

/** 모델이 도구를 부른 것처럼 Notion 도구를 실행한다 */
async function runNotion(name: string, args: unknown, user: AuthUser = author) {
  return notionTools.session(user, { actionCards: true }).run({ id: 'c1', name, arguments: JSON.stringify(args) });
}

async function propose(args: unknown, user: AuthUser = author): Promise<AiNotionCard> {
  const result = await runNotion('propose_notion_page', args, user);
  const card = result.cards?.[0];
  if (!card) throw new Error(`카드가 없어요: ${result.content}`);
  return { key: 'a1', ...card } as AiNotionCard;
}

function executeInput(card: AiNotionCard): ExecuteAiActionCardDto {
  if (card.kind === 'NOTION_PAGE_CREATE') return { kind: card.kind, nonce: card.nonce, notionPageId: card.parent.id, pageTitle: card.pageTitle, content: card.content } as ExecuteAiActionCardDto;
  if (card.kind === 'NOTION_PAGE_APPEND') return { kind: card.kind, nonce: card.nonce, notionPageId: card.page.id, content: card.content } as ExecuteAiActionCardDto;
  return { kind: card.kind, nonce: card.nonce, notionPageId: card.page.id, ...(card.newTitle ? { pageTitle: card.newTitle } : {}), edits: card.edits } as ExecuteAiActionCardDto;
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppException) return error.code;
    throw error;
  }
  throw new Error('오류가 나지 않았어요');
}

async function toolCard(name: string, args: unknown, user: AuthUser): Promise<{ card: AiActionCard | null; content: string }> {
  const result = await toolbox.run(user, { id: 'c1', name, arguments: JSON.stringify(args) });
  return { card: result.cards?.[0] ? ({ key: 'a1', ...result.cards[0] } as AiActionCard) : null, content: result.content };
}

beforeAll(async () => {
  fakeServer = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  await new Promise<void>((resolve) => fakeServer.listen(0, '127.0.0.1', resolve));
  fake.origin = `http://127.0.0.1:${(fakeServer.address() as AddressInfo).port}`;
  process.env.INTEGRATION_SECRET_KEY = randomBytes(32).toString('base64');
  process.env.NOTION_MCP_URL = `${fake.origin}/mcp`;
  process.env.CLIENT_BASE_URL = 'http://client.test';

  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  assistant = moduleRef.get(AiAssistantService);
  notionTools = moduleRef.get(AssistantNotionToolbox);
  toolbox = moduleRef.get(AssistantToolbox);
  const authUsers = moduleRef.get(AuthUserService);
  const load = async (employeeNo: string) => {
    const employee = await prisma.employee.findUniqueOrThrow({ where: { employeeNo } });
    const user = await authUsers.load(employee.id);
    if (!user) throw new Error(employeeNo);
    return user;
  };
  author = await load('2207005');
  sales = await load('2103003');
  startEventId = (await prisma.scheduleEvent.aggregate({ _max: { id: true } }))._max.id ?? 0;
  startTaskId = (await prisma.task.aggregate({ _max: { id: true } }))._max.id ?? 0;
  startNotificationId = (await prisma.notification.aggregate({ _max: { id: true } }))._max.id ?? 0;

  // 같은 묶음의 다른 시험(integration.spec.ts)이 남긴 연결·설정을 쓰지 않게 새로 시작한다
  await prisma.integrationConnection.deleteMany({ where: { providerKey: INTEGRATION_PROVIDER.NOTION } });
}, 60_000);

/** 회사 계정으로 연결하고 상위 페이지·ERP 데이터베이스 하나를 정한다 (여러 번 불러도 같다) */
async function connect() {
  await moduleRef.get(IntegrationConnectionRepository).ensure(prisma, INTEGRATION_PROVIDER.NOTION, `${fake.origin}/mcp`);
  await moduleRef.get(IntegrationTokenStore).saveTokens(INTEGRATION_PROVIDER.NOTION, { access_token: TOKEN, token_type: 'Bearer' });
  await settings(WORKSPACE);
}

beforeEach(() => {
  resetPages();
  fake.calls = [];
  fake.createResponse = 'ok';
});

afterAll(async () => {
  // 일정·업무를 고치면 service가 Notion 반영을 깨운다. 그 일이 끝난 뒤에 닫아야 DB 연결이 남지 않는다
  await moduleRef?.get(NotionWorkspaceService).runNow();
  await prisma?.notification.deleteMany({ where: { id: { gt: startNotificationId } } });
  await prisma?.task.deleteMany({ where: { id: { gt: startTaskId } } });
  await prisma?.scheduleEventAttendee.deleteMany({ where: { scheduleEventId: { gt: startEventId } } });
  await prisma?.scheduleEvent.deleteMany({ where: { id: { gt: startEventId } } });
  await prisma?.integrationConnection.deleteMany({ where: { providerKey: INTEGRATION_PROVIDER.NOTION } });
  await moduleRef?.close();
  await new Promise<void>((resolve) => fakeServer?.close(() => resolve()));
});

describe('Notion 칩을 켤 수 있는지', () => {
  it('연결 전·상위 페이지 전에는 이유와 함께 꺼지고, 둘 다 있으면 켜진다', async () => {
    expect((await assistant.capabilities()).notion).toEqual({ available: false, reason: 'Notion이 연결되어 있지 않아요. 관리자가 먼저 연결해 주세요' });
    await moduleRef.get(IntegrationConnectionRepository).ensure(prisma, INTEGRATION_PROVIDER.NOTION, `${fake.origin}/mcp`);
    await moduleRef.get(IntegrationTokenStore).saveTokens(INTEGRATION_PROVIDER.NOTION, { access_token: TOKEN, token_type: 'Bearer' });
    expect((await assistant.capabilities()).notion).toEqual({ available: false, reason: '관리자가 Notion 상위 페이지를 정하지 않았어요' });
    await settings(WORKSPACE);
    expect((await assistant.capabilities()).notion).toEqual({ available: true });
  });
});

describe('Notion 읽기 도구', () => {
  beforeAll(connect);

  it('검색: 상위 페이지 아래로만 좁혀 찾고 제목·주소·요약을 감싸 돌려준다 (밖의 페이지는 나오지 않는다)', async () => {
    const result = await runNotion('notion_search', { query: '회의' });
    const search = fake.calls.find((c) => c.name === 'notion-search');
    expect(search?.args).toEqual({ query: '회의', page_url: url(PARENT), page_size: 8, max_highlight_length: 200 });
    expect(result.content).toContain('<untrusted_web_content source="notion_search">');
    expect(result.content).toContain('주간 회의');
    expect(result.content).not.toContain('관리자 개인 메모');
    expect(result.webSources).toEqual([{ title: '주간 회의', url: url(MEETINGS) }]);
  });

  it('읽기: 상위 페이지 아래 페이지의 본문을 읽고, 밖의 페이지는 거절한다', async () => {
    const inside = await runNotion('notion_read_page', { page: url(NOTE) });
    expect(inside.content).toContain('[Notion 페이지] 설비 메모');
    expect(inside.content).toContain('설비 점검 메모');
    expect(inside.webSources).toEqual([{ title: '설비 메모', url: url(NOTE) }]);
    const outside = await runNotion('notion_read_page', { page: OUTSIDE });
    expect(JSON.parse(outside.content).오류).toContain('밖의 페이지');
    expect(outside.content).not.toContain('개인 메모 (회의 비밀)');
  });

  it('ERP가 채우는 데이터베이스는 읽을 수 있고 앞의 행을 함께 준다 (읽기 전용 SQL)', async () => {
    const result = await runNotion('notion_read_page', { page: url(MIRROR_DB) });
    expect(result.content).toContain('[Notion 데이터베이스] ERP 일정');
    expect(result.content).toContain('ERP가 자동으로 채워요');
    expect(result.content).toContain('라인 점검');
    expect(fake.calls.find((c) => c.name === 'notion-query-data-sources')?.args).toEqual({ data: { data_source_urls: [`collection://${MIRROR_DS}`], query: `SELECT * FROM "collection://${MIRROR_DS}" LIMIT 20` } });
  });
});

describe('Notion 쓰기 카드', () => {
  beforeAll(connect);

  it('새 페이지: 대상을 말하지 않으면 상위 페이지 아래에 한 번만 만들고, 누가 부탁했는지 남긴다', async () => {
    const card = await propose({ action: 'create', title: '10월 3주 정리', content: '## 요약\n- 설비 점검 완료' });
    expect(card).toMatchObject({ kind: 'NOTION_PAGE_CREATE', parent: { id: PARENT, title: 'Fantasteel_ERP' } });
    expect(writes()).toHaveLength(0);
    const result = await assistant.executeActionCard(author, executeInput(card));
    expect(result.registered).toMatchObject({ type: 'notion_page', id: 0 });
    const created = [...fake.pages.values()].find((p) => p.title === '10월 3주 정리');
    expect(created?.parent).toBe(PARENT);
    expect(created?.body).toContain('## 요약\n- 설비 점검 완료');
    expect(created?.body).toContain('*철강맨AI · 정다은 요청 · ');
    expect(result.registered.url).toBe(url(created?.id ?? ''));
    expect(await codeOf(assistant.executeActionCard(author, executeInput(card)))).toBe('COM-001');
    expect(writes()).toHaveLength(1);
  });

  it('더하기·고치기: 끝에 더하고, 여러 군데를 찾아 바꾸고 제목을 바꾼다. 전체 덮어쓰기는 쓰지 않는다', async () => {
    const append = await propose({ action: 'append', page: url(NOTE), content: '- 베어링 교체 예정' });
    await assistant.executeActionCard(author, executeInput(append));
    expect(fake.pages.get(NOTE)?.body).toMatch(/^설비 점검 메모\n- 베어링 교체 예정\n\n\*철강맨AI · 정다은 요청/);

    const update = await propose({ action: 'update', page: url(MEETINGS), title: '주간 회의 (10/24 변경)', edits: [{ old: '<td>10/20</td>', new: '<td>10/24</td>' }, { old: '담당: 정다은', new: '담당: 박서영' }] });
    expect(update).toMatchObject({ newTitle: '주간 회의 (10/24 변경)', issues: [] });
    const result = await assistant.executeActionCard(sales, executeInput(update));
    expect(result.registered.url).toBe(url(MEETINGS));
    expect(fake.pages.get(MEETINGS)).toMatchObject({ title: '주간 회의 (10/24 변경)', body: '# 안건\n<table><tr><td>마감</td><td>10/24</td></tr></table>\n담당: 박서영' });
    const commands = writes().map((c) => c.args.command);
    expect(commands).toEqual(['insert_content', 'update_content', 'update_properties']);
    expect(JSON.stringify(writes())).not.toMatch(/replace_content|allow_deleting_content/);
  });

  it('상위 페이지 밖은 카드도 만들지 않고, 실행으로 밀어 넣어도 쓰지 않는다', async () => {
    const proposed = await runNotion('propose_notion_page', { action: 'append', page: url(OUTSIDE), content: '추가' });
    expect(proposed.cards).toBeUndefined();
    expect(JSON.parse(proposed.content).오류).toContain('밖의 페이지');
    const forged = { kind: 'NOTION_PAGE_APPEND', nonce: '3f2504e0-4f89-41d3-9a0c-0305e82c3302', notionPageId: OUTSIDE, content: '추가' } as ExecuteAiActionCardDto;
    expect(await codeOf(assistant.executeActionCard(author, forged))).toBe('COM-002');
    const createOutside = { kind: 'NOTION_PAGE_CREATE', nonce: '3f2504e0-4f89-41d3-9a0c-0305e82c3303', notionPageId: OUTSIDE, pageTitle: '밖', content: '추가' } as ExecuteAiActionCardDto;
    expect(await codeOf(assistant.executeActionCard(author, createOutside))).toBe('COM-002');
    expect(writes()).toHaveLength(0);
  });

  it('ERP가 채우는 데이터베이스와 그 행은 쓰지 않고 ERP 일정·업무 카드를 쓰라고 알린다', async () => {
    for (const page of [url(MIRROR_DB), url(MIRROR_ROW)]) {
      const proposed = await runNotion('propose_notion_page', { action: 'update', page, edits: [{ old: '라인 점검', new: '라인 점검 (연기)' }] });
      expect(JSON.parse(proposed.content).오류).toContain('ERP가 자동으로 채우는');
    }
    const forged = { kind: 'NOTION_PAGE_UPDATE', nonce: '3f2504e0-4f89-41d3-9a0c-0305e82c3304', notionPageId: MIRROR_ROW, edits: [{ oldStr: 'a', newStr: 'b' }] } as ExecuteAiActionCardDto;
    expect(await codeOf(assistant.executeActionCard(author, forged))).toBe('COM-004');
    // 바로 아래 행을 만드는 것도 데이터베이스 안이라 막는다
    const createIn = { kind: 'NOTION_PAGE_CREATE', nonce: '3f2504e0-4f89-41d3-9a0c-0305e82c3305', notionPageId: MIRROR_DB, pageTitle: '새 일정', content: '추가' } as ExecuteAiActionCardDto;
    expect(await codeOf(assistant.executeActionCard(author, createIn))).toBe('COM-004');
    expect(writes()).toHaveLength(0);
  });

  it('만들어졌는지 모르는 답이면 INT-009, 같은 카드를 다시 눌러도 또 만들지 않는다', async () => {
    fake.createResponse = 'no-url';
    const card = await propose({ action: 'create', page: url(MEETINGS), title: '정리', content: '본문' });
    expect(await codeOf(assistant.executeActionCard(author, executeInput(card)))).toBe('INT-009');
    expect(await codeOf(assistant.executeActionCard(author, executeInput(card)))).toBe('COM-001');
    expect(fake.calls.filter((c) => c.name === 'notion-create-pages')).toHaveLength(1);
  });

  it('Notion이 고칠 곳을 하나도 못 찾으면 INT-004이고, 고쳐서 다시 실행할 수 있다', async () => {
    const card = (await propose({ action: 'update', page: url(MEETINGS), edits: [{ old: '없는 글', new: '새 글' }] })) as Extract<AiNotionCard, { kind: 'NOTION_PAGE_UPDATE' }>;
    expect(card.issues).toHaveLength(1);
    expect(await codeOf(assistant.executeActionCard(author, executeInput(card)))).toBe('INT-004');
    const fixed = { ...card, edits: [{ oldStr: '담당: 정다은', newStr: '담당: 김영업' }] };
    await assistant.executeActionCard(author, executeInput(fixed));
    expect(fake.pages.get(MEETINGS)?.body).toContain('담당: 김영업');
  });
});

describe('일정·업무 고치기 카드', () => {
  beforeAll(connect);

  it('내 일정 조회 → 일정 고치기: 등록자만, 실행하면 일정이 바뀌고 Notion 반영 대상(updated_at > notion_synced_at)이 된다', async () => {
    const day = plusDays(3);
    const event = await prisma.scheduleEvent.create({
      data: { scheduleEventTitle: 'AI 라인 점검', startAt: new Date(`${day}T14:00:00+09:00`), endAt: new Date(`${day}T15:00:00+09:00`), creatorId: author.employeeId, attendees: { create: [{ employeeId: author.employeeId }, { employeeId: sales.employeeId }] } },
    });
    // 이미 Notion에 반영한 일정처럼 둔다 (반영 시각이 updated_at 바로 앞)
    await prisma.scheduleEvent.update({ where: { id: event.id }, data: { notionPageId: 'page-x', notionSyncedAt: new Date() } });
    const before = await prisma.scheduleEvent.findUniqueOrThrow({ where: { id: event.id } });

    const list = await toolbox.run(author, { id: 'c1', name: 'get_my_schedule', arguments: JSON.stringify({ from: day, to: day }) });
    expect(list.content).toContain(`"일정id":${event.id}`);
    expect(list.content).toContain('"고칠수있음":true');

    const refused = await toolCard('propose_schedule_event_update', { scheduleEventId: event.id, startAt: `${day}T16:00` }, sales);
    expect(refused.card).toBeNull();
    expect(refused.content).toContain('내가 등록한 일정만');

    const { card } = await toolCard('propose_schedule_event_update', { scheduleEventId: event.id, startAt: `${day}T16:00` }, author);
    if (card?.kind !== 'SCHEDULE_EVENT_UPDATE') throw new Error('일정 카드가 없어요');
    expect(card).toMatchObject({ startAt: `${day}T16:00:00+09:00`, endAt: `${day}T17:00:00+09:00` });
    const result = await assistant.executeActionCard(author, { kind: card.kind, scheduleEventId: card.scheduleEventId, title: card.scheduleEventTitle, description: card.scheduleEventDescription, startAt: card.startAt, endAt: card.endAt } as ExecuteAiActionCardDto);
    expect(result.registered).toEqual({ type: 'schedule_event', id: event.id, updated: true });
    const after = await prisma.scheduleEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.startAt.toISOString()).toBe(new Date(`${day}T16:00:00+09:00`).toISOString());
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(after.updatedAt.getTime()).toBeGreaterThan(after.notionSyncedAt?.getTime() ?? Infinity);
    // 남이 실행으로 밀어 넣어도 일정 service가 막는다
    expect(await codeOf(assistant.executeActionCard(sales, { kind: 'SCHEDULE_EVENT_UPDATE', scheduleEventId: event.id, title: '바꿈', startAt: `${day}T18:00`, endAt: `${day}T19:00` } as ExecuteAiActionCardDto))).toBe('COM-002');
  });

  it('내 업무 조회 → 마감일 바꾸기(등록자) → 완료(담당자만). 완료한 업무는 더 고칠 수 없다', async () => {
    const task = await prisma.task.create({ data: { taskTitle: 'AI 견적서 보내기', assigneeId: sales.employeeId, creatorId: author.employeeId, dueDate: new Date(`${plusDays(5)}T00:00:00.000Z`), taskStatus: TASK_STATUS.OPEN } });
    const list = await toolbox.run(author, { id: 'c1', name: 'get_my_tasks', arguments: JSON.stringify({ scope: 'created' }) });
    expect(list.content).toContain(`"업무id":${task.id}`);

    const edit = await toolCard('propose_task_update', { taskId: task.id, dueDate: plusDays(8) }, author);
    if (edit.card?.kind !== 'TASK_UPDATE') throw new Error('업무 카드가 없어요');
    await assistant.executeActionCard(author, { kind: 'TASK_UPDATE', taskId: task.id, dueDate: edit.card.dueDate } as ExecuteAiActionCardDto);
    const edited = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(edited.dueDate.toISOString().slice(0, 10)).toBe(plusDays(8));
    expect(edited.updatedAt.getTime()).toBeGreaterThan(task.updatedAt.getTime());

    expect((await toolCard('propose_task_update', { taskId: task.id, complete: true }, author)).content).toContain('담당자만 완료');
    expect(await codeOf(assistant.executeActionCard(author, { kind: 'TASK_UPDATE', taskId: task.id, complete: true } as ExecuteAiActionCardDto))).toBe('COM-002');
    const done = await toolCard('propose_task_update', { taskId: task.id, complete: true }, sales);
    expect(done.card).toMatchObject({ kind: 'TASK_UPDATE', complete: true });
    await assistant.executeActionCard(sales, { kind: 'TASK_UPDATE', taskId: task.id, complete: true } as ExecuteAiActionCardDto);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).taskStatus).toBe(TASK_STATUS.DONE);
    expect((await toolCard('propose_task_update', { taskId: task.id, title: '다시' }, author)).content).toContain('되돌릴 수 없어요');
  });

  it('내 일정·업무 조회는 사내 채팅 @AI(카드 없는 답)에는 알리지 않고, 방 멤버에게 보일 수 없는 도구로 본다', () => {
    const names = toolbox.definitions({}).map((d) => d.name);
    expect(names).not.toContain('get_my_schedule');
    expect(names).not.toContain('get_my_tasks');
    expect(toolbox.definitions({ actionCards: true }).map((d) => d.name)).toEqual(expect.arrayContaining(['get_my_schedule', 'get_my_tasks', 'propose_schedule_event_update', 'propose_task_update']));
    expect(toolbox.canViewAll(sales, ['get_my_tasks'])).toBe(false);
  });
});
