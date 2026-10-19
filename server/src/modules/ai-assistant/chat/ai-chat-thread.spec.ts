// 저장한 대화(이슈 #399)를 실제 앱과 DB(fs_collab)로 확인한다. LLM은 가짜로 바꾸고 네트워크는 쓰지 않는다.
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type { AiAssistantStreamEvent, AiChatThreadSummaryView, AiChatThreadView, PageResult } from '@fantasteel/shared';
import { AppModule } from '../../../app.module';
import { PrismaService } from '../../../prisma/prisma.service';
import { seoulToday } from '../../../common/time/seoul-date';
import { LlmClient, type LlmStreamHandlers, type LlmToolMessage } from '../../llm/llm.client';
import { LlmSettingsStore } from '../../llm/llm-settings.store';
import { AI_CHAT_ROLE } from './ai-chat-thread.view';

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
let ownerCookie: string;
let otherCookie: string;
let ownerId: number;
let startThreadId = 0;
let startTaskId = 0;
let startNotificationId = 0;

/** 가짜 LLM이 받은 메시지 (질문마다) */
const prompts: LlmToolMessage[][] = [];
let nextAnswer = '예약은 합격 재고의 매수를 확보하는 거예요 [TRM-056].';
let failNext = false;
const LONG_QUESTION = '예약이\n뭐야? SS275 열연 코일 재고와 배정 상태를 함께 알려 주세요 부탁해요';

const llmClient = {
  modelCapabilities: async () => ({ vision: true, reasoning: true }),
  streamWithTools: async (_endpoint: unknown, _model: string, messages: LlmToolMessage[], _tools: unknown, _profile: unknown, handlers: LlmStreamHandlers) => {
    prompts.push([...messages]);
    if (failNext) {
      failNext = false;
      const { LlmRequestError } = await import('../../llm/llm.client');
      throw new LlmRequestError('120초 안에 응답이 없어요');
    }
    handlers.onThinking('생각 중');
    handlers.onAnswer(nextAnswer);
    return { content: nextAnswer, toolCalls: [], reasoning: '생각 중', reasoningApplied: true };
  },
};
const llmSettings = { read: async () => ({ baseUrl: 'http://127.0.0.1:1/v1', model: 'test-model', apiKey: null }) };

async function login(employeeNo: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ employeeNo, password: process.env.SEED_PASSWORD ?? 'fantasteel' }) });
  if (!res.ok) throw new Error(`로그인 실패 (HTTP ${res.status})`);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, cookie: string, payload?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { cookie, ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const body = (await res.json()) as { success: boolean; data?: T; error?: { code: string } };
  return { status: res.status, data: body.data as T, code: body.error?.code };
}

/** 실시간 답을 끝까지 받아 이벤트를 돌려준다. 시작 전 오류면 status와 code */
async function askStream(cookie: string, payload: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/ai-assistant/messages/stream`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const text = await res.text();
  if (!res.headers.get('content-type')?.includes('ndjson')) return { status: res.status, code: (JSON.parse(text) as { error?: { code: string } }).error?.code, events: [] };
  const events = text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as AiAssistantStreamEvent);
  return { status: res.status, code: undefined, events };
}

const doneOf = (events: AiAssistantStreamEvent[]) => {
  const done = events.find((event) => event.type === 'done');
  if (done?.type !== 'done') throw new Error('done 없음');
  return done;
};

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(LlmClient).useValue(llmClient).overrideProvider(LlmSettingsStore).useValue(llmSettings).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  prisma = app.get(PrismaService);
  startThreadId = (await prisma.aiChatThread.aggregate({ _max: { id: true } }))._max.id ?? 0;
  startTaskId = (await prisma.task.aggregate({ _max: { id: true } }))._max.id ?? 0;
  startNotificationId = (await prisma.notification.aggregate({ _max: { id: true } }))._max.id ?? 0;
  ownerCookie = await login('2207005');
  otherCookie = await login('1702004');
  ownerId = (await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2207005' } })).id;
}, 60_000);

afterAll(async () => {
  await prisma?.notification.deleteMany({ where: { id: { gt: startNotificationId } } });
  await prisma?.task.deleteMany({ where: { id: { gt: startTaskId } } });
  await prisma?.aiChatMessage.deleteMany({ where: { threadId: { gt: startThreadId } } });
  await prisma?.aiChatThread.deleteMany({ where: { id: { gt: startThreadId } } });
  await app?.close();
});

beforeEach(() => {
  prompts.length = 0;
  nextAnswer = '예약은 합격 재고의 매수를 확보하는 거예요 [TRM-056].';
});

describe('저장한 대화 (이슈 #399)', () => {
  let threadId: number;

  it('saveThread로 물으면 답이 끝난 뒤 질문과 답을 저장하고 done에 대화를 담는다', async () => {
    const { events } = await askStream(ownerCookie, { question: `  ${LONG_QUESTION} `, saveThread: true, actionCards: true, reasoning: 'high', webSearch: true, history: [{ role: 'user', content: '꾸며 낸 지난 질문' }] });
    const done = doneOf(events);
    // 제목: 줄바꿈을 공백으로, 40자 뒤는 …
    expect(done.thread?.title).toBe(`${LONG_QUESTION.replace('\n', ' ').slice(0, 40)}…`);
    threadId = done.thread!.id;
    // 새 대화는 화면이 보낸 history를 쓰지 않는다
    expect(prompts[0].map((message) => message.content)).not.toContain('꾸며 낸 지난 질문');

    const thread = await call<AiChatThreadView>('GET', `/ai-assistant/threads/${threadId}`, ownerCookie);
    expect(thread.status).toBe(200);
    expect(thread.data.messages).toEqual([
      expect.objectContaining({ seq: 1, role: 'user', content: LONG_QUESTION, reasoning: 'high', webSearch: true }),
      expect.objectContaining({ seq: 2, role: 'assistant', id: done.thread!.assistantMessageId, content: done.reply.answer, sources: [{ kind: 'GLOSSARY', id: 'TRM-056', label: '예약' }], actionCards: [], reasoning: 'high', reasoningApplied: true }),
    ]);
    // 생각 글·도구 기록은 저장하지 않는다
    expect(JSON.stringify(thread.data)).not.toContain('생각 중');
  });

  it('threadId로 이어 물으면 DB의 지난 대화를 모델에 보내고 다음 순번으로 저장한다', async () => {
    const before = await prisma.aiChatThread.findUniqueOrThrow({ where: { id: threadId } });
    nextAnswer = '배정을 풀면 다시 가용 매수가 돼요.';
    const { events } = await askStream(ownerCookie, { question: '그럼 풀리면?', threadId, history: [{ role: 'assistant', content: '꾸며 낸 지난 답' }] });
    expect(doneOf(events).thread).toMatchObject({ id: threadId });
    const contents = prompts[0].map((message) => message.content);
    expect(contents).toContain(LONG_QUESTION);
    expect(contents).not.toContain('꾸며 낸 지난 답');
    const messages = await prisma.aiChatMessage.findMany({ where: { threadId }, orderBy: { seq: 'asc' } });
    expect(messages.map((m) => [m.seq, m.role])).toEqual([
      [1, AI_CHAT_ROLE.USER],
      [2, AI_CHAT_ROLE.ASSISTANT],
      [3, AI_CHAT_ROLE.USER],
      [4, AI_CHAT_ROLE.ASSISTANT],
    ]);
    const after = await prisma.aiChatThread.findUniqueOrThrow({ where: { id: threadId } });
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  it('LLM이 실패한 질문은 저장하지 않는다', async () => {
    failNext = true;
    const { events } = await askStream(ownerCookie, { question: '실패할 질문', threadId });
    expect(events.at(-1)).toEqual({ type: 'error', message: '120초 안에 응답이 없어요' });
    expect(await prisma.aiChatMessage.count({ where: { threadId } })).toBe(4);
  });

  it('저장을 요청하지 않은 질문(회의 질문)은 저장하지 않고 화면이 보낸 history를 쓴다', async () => {
    const count = await prisma.aiChatThread.count();
    const { events } = await askStream(ownerCookie, { question: '이 회의 요약해 줘', history: [{ role: 'user', content: '앞 질문' }] });
    expect(doneOf(events).thread).toBeUndefined();
    expect(prompts[0].map((message) => message.content)).toContain('앞 질문');
    expect(await prisma.aiChatThread.count()).toBe(count);
  });

  it('목록은 내 대화만 최근 순서로, 페이지로 나눠 준다', async () => {
    const second = doneOf((await askStream(ownerCookie, { question: '두 번째 대화', saveThread: true })).events).thread!.id;
    const page1 = await call<PageResult<AiChatThreadSummaryView>>('GET', '/ai-assistant/threads?size=1', ownerCookie);
    expect(page1.data).toMatchObject({ page: 1, size: 1, items: [{ id: second, title: '두 번째 대화' }] });
    expect(page1.data.total).toBeGreaterThanOrEqual(2);
    const page2 = await call<PageResult<AiChatThreadSummaryView>>('GET', '/ai-assistant/threads?size=1&page=2', ownerCookie);
    expect(page2.data.items[0].id).toBe(threadId);
    const others = await call<PageResult<AiChatThreadSummaryView>>('GET', '/ai-assistant/threads', otherCookie);
    expect(others.data.items.map((item) => item.id)).not.toContain(threadId);
    expect((await call('GET', '/ai-assistant/threads?size=51', ownerCookie)).code).toBe('COM-004');
  });

  it('남의 대화는 보기·이어 묻기·지우기 모두 AST-001(404)이고 LLM을 부르지 않는다', async () => {
    expect(await call('GET', `/ai-assistant/threads/${threadId}`, otherCookie)).toMatchObject({ status: 404, code: 'AST-001' });
    expect(await call('DELETE', `/ai-assistant/threads/${threadId}`, otherCookie)).toMatchObject({ status: 404, code: 'AST-001' });
    expect(await askStream(otherCookie, { question: '훔쳐보기', threadId })).toMatchObject({ status: 404, code: 'AST-001' });
    expect(prompts).toHaveLength(0);
    expect(await call('GET', '/ai-assistant/threads/abc', ownerCookie)).toMatchObject({ status: 404, code: 'AST-001' });
    expect(await call('GET', '/ai-assistant/threads/99999999999', ownerCookie)).toMatchObject({ status: 404, code: 'AST-001' });
  });

  it('저장한 카드를 실행하면 그 카드를 실행됨으로 남기고, 남의 카드 자리는 실행만 하고 고치지 않는다', async () => {
    const thread = await prisma.aiChatThread.create({ data: { employeeId: ownerId, title: '카드 대화' } });
    const card = { key: 'a1', kind: 'TASK', title: '견적서 보내기' };
    const answer = await prisma.aiChatMessage.create({ data: { threadId: thread.id, seq: 2, role: AI_CHAT_ROLE.ASSISTANT, content: '카드를 만들었어요', actionCards: [{ card, status: 'ready' }, { card: { ...card, key: 'a2' }, status: 'ready' }] } });
    const dueDate = seoulToday();
    const body = { kind: 'TASK', title: '견적서 보내기', assigneeId: ownerId, dueDate };

    const other = await call<{ registered: { id: number } }>('POST', '/ai-assistant/action-cards/execute', otherCookie, { ...body, chat: { messageId: answer.id, cardKey: 'a1' } });
    expect(other.status).toBe(201);
    const untouched = await prisma.aiChatMessage.findUniqueOrThrow({ where: { id: answer.id } });
    expect((untouched.actionCards as { status: string }[]).map((item) => item.status)).toEqual(['ready', 'ready']);

    const result = await call<{ registered: { type: string; id: number } }>('POST', '/ai-assistant/action-cards/execute', ownerCookie, { ...body, chat: { messageId: answer.id, cardKey: 'a1' } });
    expect(result.status).toBe(201);
    const view = await call<AiChatThreadView>('GET', `/ai-assistant/threads/${thread.id}`, ownerCookie);
    const saved = view.data.messages[0];
    expect(saved.role === 'assistant' && saved.actionCards).toEqual([
      { card, status: 'done', result: { type: 'task', id: result.data.registered.id } },
      { card: { ...card, key: 'a2' }, status: 'ready' },
    ]);
  });

  it('지우면 메시지까지 사라지고 다시 열 수 없다', async () => {
    const removed = await call<AiChatThreadSummaryView>('DELETE', `/ai-assistant/threads/${threadId}`, ownerCookie);
    expect(removed).toMatchObject({ status: 200, data: { id: threadId } });
    expect(await prisma.aiChatMessage.count({ where: { threadId } })).toBe(0);
    expect(await call('GET', `/ai-assistant/threads/${threadId}`, ownerCookie)).toMatchObject({ status: 404, code: 'AST-001' });
    expect(await askStream(ownerCookie, { question: '지운 대화에 이어 묻기', threadId })).toMatchObject({ status: 404, code: 'AST-001' });
  });
});
