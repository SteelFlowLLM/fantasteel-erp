// 철강맨AI 승인 카드(이슈 #362)를 실제 앱과 DB(fs_collab)로 확인한다. LLM 호출은 가짜로 바꾼다.
// 실시간 답 API에서 쓰기 도구 호출 → approval_required → 허용·거부 → tool_execution, 그리고 AI 경유 작업 로그를 본다.
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { BUSINESS_EVENT_TYPE, DRAFT_STATUS, type ActionDraftView, type AiAssistantStreamEvent, type PurchaseRequisitionDraftPayload } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmClient, type LlmModelCapabilities, type LlmStreamHandlers, type LlmToolCall, type LlmToolDefinition, type LlmToolMessage, type LlmToolReply } from '../llm/llm.client';
import type { LlmProfile } from '../llm/llm-profiles';
import { LlmSettingsStore } from '../llm/llm-settings.store';
import { AssistantApprovalRegistry } from './approval/approval.registry';

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
/** 구매 사원(부서장 아님) — 일정·구매요청 초안을 만들 수 있다 */
let purchaseCookie: string;
let purchaseId: number;
/** 영업 사원 — 구매요청 등록 권한이 없다 */
let salesCookie: string;
let start = { scheduleEventId: 0, businessEventId: 0, actionDraftId: 0 };

const llmClient = {
  chatWithTools: jest.fn<Promise<LlmToolReply>, [unknown, string, LlmToolMessage[], LlmToolDefinition[], LlmProfile]>(),
  streamWithTools: jest.fn<Promise<LlmToolReply>, [unknown, string, LlmToolMessage[], LlmToolDefinition[], LlmProfile, LlmStreamHandlers, AbortSignal | undefined]>(),
  modelCapabilities: jest.fn<Promise<LlmModelCapabilities>, [unknown, string]>(),
};
const llmSettings = { read: jest.fn(async () => ({ baseUrl: 'http://llm.test/v1', model: 'test-model', apiKey: null })) };

/** 가짜 LLM이 받은 호출 (메시지는 그 순간의 사본) */
interface SeenCall {
  messages: LlmToolMessage[];
  tools: string[];
}
let seen: SeenCall[] = [];

/** 차례마다 모델이 할 일: 도구 호출 목록이나 최종 답 글 */
function scriptLlm(steps: (LlmToolCall[] | string)[]): void {
  llmClient.streamWithTools.mockImplementation(async (_endpoint, _model, messages, tools, _profile, handlers) => {
    seen.push({ messages: [...messages], tools: tools.map((t) => t.name) });
    const step = steps[seen.length - 1] ?? '끝';
    if (typeof step === 'string') {
      handlers.onAnswer(step);
      return { content: step, toolCalls: [], reasoningApplied: true };
    }
    return { content: '', toolCalls: step, reasoningApplied: true };
  });
}

const toolCall = (id: string, name: string, args: Record<string, unknown>): LlmToolCall => ({ id, name, arguments: JSON.stringify(args) });

async function login(employeeNo: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ employeeNo, password: process.env.SEED_PASSWORD ?? 'fantasteel' }) });
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

async function decide(approvalId: string, decision: string, cookie = purchaseCookie) {
  const res = await fetch(`${baseUrl}/ai-assistant/approvals/${approvalId}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ decision }) });
  return { status: res.status, body: (await res.json()) as { data?: unknown; error?: { code: string; message: string } } };
}

/** 실시간 답을 한 줄씩 읽으며 onEvent를 부른다 (승인 카드가 오면 그 자리에서 허용·거부한다) */
async function stream(payload: Record<string, unknown>, onEvent: (event: AiAssistantStreamEvent) => Promise<void> | void = () => undefined, options: { cookie?: string; abort?: AbortController } = {}) {
  const res = await fetch(`${baseUrl}/ai-assistant/messages/stream`, {
    method: 'POST',
    headers: { cookie: options.cookie ?? purchaseCookie, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: options.abort?.signal,
  });
  const events: AiAssistantStreamEvent[] = [];
  const reader = res.body?.getReader();
  if (!reader) throw new Error('본문 없음');
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const event = JSON.parse(buffer.slice(0, i)) as AiAssistantStreamEvent;
        buffer = buffer.slice(i + 1);
        events.push(event);
        await onEvent(event);
      }
    }
  } catch (error) {
    if (!options.abort?.signal.aborted) throw error;
  }
  return events;
}

const toolMessages = (call: SeenCall | undefined) => (call?.messages ?? []).filter((m): m is Extract<LlmToolMessage, { role: 'tool' }> => m.role === 'tool').map((m) => JSON.parse(m.content) as Record<string, unknown>);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(LlmClient).useValue(llmClient).overrideProvider(LlmSettingsStore).useValue(llmSettings).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  prisma = app.get(PrismaService);
  start = {
    scheduleEventId: (await prisma.scheduleEvent.aggregate({ _max: { id: true } }))._max.id ?? 0,
    businessEventId: (await prisma.businessEvent.aggregate({ _max: { id: true } }))._max.id ?? 0,
    actionDraftId: (await prisma.actionDraft.aggregate({ _max: { id: true } }))._max.id ?? 0,
  };
  purchaseCookie = await login('2207005');
  salesCookie = await login('2103003');
  purchaseId = (await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2207005' } })).id;
}, 60_000);

afterAll(async () => {
  // 같은 묶음의 다른 시험(내 일정·작업 로그)이 이 시험의 행을 보지 않게 지운다
  await prisma?.businessEvent.deleteMany({ where: { id: { gt: start.businessEventId } } });
  await prisma?.actionDraft.deleteMany({ where: { id: { gt: start.actionDraftId } } });
  await prisma?.scheduleEventAttendee.deleteMany({ where: { scheduleEventId: { gt: start.scheduleEventId } } });
  await prisma?.scheduleEvent.deleteMany({ where: { id: { gt: start.scheduleEventId } } });
  await app?.close();
});

beforeEach(() => {
  seen = [];
  llmClient.streamWithTools.mockReset();
  llmClient.chatWithTools.mockReset();
  llmClient.modelCapabilities.mockReset();
  llmClient.modelCapabilities.mockResolvedValue({ vision: true, reasoning: true });
});

const SCHEDULE = { title: 'AI 승인 시험 회의', date: '2031-03-04', startTime: '14:00', endTime: '15:30', memo: '3층 회의실' };

describe('쓰기 도구를 알리는 때', () => {
  it('approvalCards가 없으면 실시간 답에도 쓰기 도구를 알리지 않는다 (회의 질문 카드처럼 카드를 못 보이는 화면)', async () => {
    scriptLlm(['네']);
    await stream({ question: '내일 회의 잡아줘' });
    expect(seen[0].tools).not.toContain('add_my_schedule_event');
    expect(seen[0].messages[0].content).not.toContain('승인 카드');
  });

  it('한 번에 답하는 API(사내 채팅 @AI)는 approvalCards를 보내도 쓰기 도구가 없다 (기다릴 수 없다)', async () => {
    llmClient.chatWithTools.mockResolvedValue({ content: '네', toolCalls: [] });
    const res = await fetch(`${baseUrl}/ai-assistant/messages`, { method: 'POST', headers: { cookie: purchaseCookie, 'content-type': 'application/json' }, body: JSON.stringify({ question: '내일 회의 잡아줘', approvalCards: true }) });
    expect(res.status).toBe(200);
    const tools = llmClient.chatWithTools.mock.calls[0][3].map((t) => t.name);
    expect(tools).toContain('get_inventory');
    expect(tools).not.toContain('add_my_schedule_event');
    expect(tools).not.toContain('create_purchase_request_draft');
  });
});

describe('내 일정 추가 (add_my_schedule_event)', () => {
  it('허용하면 일정을 만들고 AI 경유로 남긴다. 다른 사원의 허용은 403, 늦게 온 결정은 409', async () => {
    scriptLlm([[toolCall('c1', 'add_my_schedule_event', SCHEDULE)], '내 일정에 추가했어요.']);
    const decisions: number[] = [];
    const events = await stream({ question: '3월 4일 2시에 회의 잡아줘', approvalCards: true }, async (event) => {
      if (event.type !== 'approval_required') return;
      decisions.push((await decide(event.approvalId, 'ALLOW', salesCookie)).status);
      decisions.push((await decide(event.approvalId, 'ALLOW')).status);
      decisions.push((await decide(event.approvalId, 'DENY')).status);
    });

    expect(decisions).toEqual([403, 200, 409]);
    expect(seen[0].tools).toEqual(expect.arrayContaining(['get_inventory', 'add_my_schedule_event', 'create_purchase_request_draft']));
    expect(seen[0].messages[0].content).toContain('"실행했어요"가 오기 전에는 됐다고 말하지 않아요');
    expect(events.map((e) => e.type)).toEqual(['tool_start', 'approval_required', 'approval_resolved', 'tool_execution', 'tool_end', 'answer', 'done']);
    const required = events[1];
    if (required.type !== 'approval_required') throw new Error('카드가 아니에요');
    expect(required).toMatchObject({ toolId: 't1', toolName: 'add_my_schedule_event', title: '내 일정 추가: AI 승인 시험 회의' });
    expect(required.details).toEqual(expect.arrayContaining([{ label: '날짜', value: '2031-03-04 (화)' }, { label: '시간', value: '14:00~15:30' }, { label: '메모', value: '3층 회의실' }]));
    expect(Date.parse(required.expiresAt) - Date.now()).toBeGreaterThan(9 * 60 * 1000);
    expect(events[2]).toEqual({ type: 'approval_resolved', approvalId: required.approvalId, decision: 'ALLOW' });
    const execution = events[3];
    if (execution.type !== 'tool_execution') throw new Error('실행 결과가 아니에요');
    expect(execution).toMatchObject({ status: 'SUCCESS', attempts: 1, result: { table: 'schedule_event', label: SCHEDULE.title, linkPath: '/schedule?week=2031-03-03' } });

    const created = await prisma.scheduleEvent.findUniqueOrThrow({ where: { id: execution.result?.id ?? 0 }, include: { attendees: true } });
    expect(created).toMatchObject({ scheduleEventTitle: SCHEDULE.title, scheduleEventDescription: '3층 회의실', creatorId: purchaseId, meetingMinutesId: null });
    expect(created.startAt.toISOString()).toBe('2031-03-04T05:00:00.000Z');
    expect(created.endAt.toISOString()).toBe('2031-03-04T06:30:00.000Z');
    expect(created.attendees.map((a) => a.employeeId)).toEqual([purchaseId]);
    // AI 실행 카드 확정 = DRAFT_CONFIRMED + AI 경유 (공통 코드 정의서 BUSINESS_EVENT_TYPE, REQ-AST-010)
    const logged = await prisma.businessEvent.findMany({ where: { targetType: 'schedule_event', targetId: created.id } });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ businessEventType: BUSINESS_EVENT_TYPE.DRAFT_CONFIRMED, isAiAssisted: true, actorEmployeeId: purchaseId, actorType: 'USER' });

    // 모델은 실행 결과를 받고 나서 답한다
    expect(toolMessages(seen[1])).toEqual([expect.objectContaining({ 결과: '실행했어요' })]);
    const done = events.at(-1);
    if (done?.type !== 'done') throw new Error('done이 아니에요');
    expect(done.reply.toolCalls.map((c) => c.name)).toEqual(['add_my_schedule_event']);
    expect(app.get(AssistantApprovalRegistry).pendingCount()).toBe(0);
  });

  it('거부하면 만들지 않고, 모델에 거부했다고 알린다', async () => {
    const before = await prisma.scheduleEvent.count();
    scriptLlm([[toolCall('c1', 'add_my_schedule_event', { ...SCHEDULE, title: '거부할 회의' })], '추가하지 않았어요.']);
    const events = await stream({ question: '회의 잡아줘', approvalCards: true }, async (event) => {
      if (event.type === 'approval_required') expect((await decide(event.approvalId, 'DENY')).status).toBe(200);
    });
    expect(events.map((e) => e.type)).toEqual(['tool_start', 'approval_required', 'approval_resolved', 'tool_end', 'answer', 'done']);
    expect(events[2]).toMatchObject({ decision: 'DENY' });
    expect(await prisma.scheduleEvent.count()).toBe(before);
    expect(toolMessages(seen[1])).toEqual([expect.objectContaining({ 결과: '사용자가 거부해 실행하지 않았어요' })]);
  });

  it('사전 확인이 틀리면 카드 없이 이유를 돌려주고, 모델이 고친 두 번째 호출에서 카드를 보인다', async () => {
    scriptLlm([
      [toolCall('c1', 'add_my_schedule_event', { ...SCHEDULE, title: '고쳐서 잡은 회의', startTime: '15:00', endTime: '14:00' })],
      [toolCall('c2', 'add_my_schedule_event', { ...SCHEDULE, title: '고쳐서 잡은 회의', startTime: '14:00', endTime: '15:00' })],
      '잡았어요.',
    ]);
    const events = await stream({ question: '회의 잡아줘', approvalCards: true }, async (event) => {
      if (event.type === 'approval_required') await decide(event.approvalId, 'ALLOW');
    });
    expect(events.filter((e) => e.type === 'approval_required')).toHaveLength(1);
    expect(events.map((e) => e.type)).toEqual(['tool_start', 'tool_end', 'tool_start', 'approval_required', 'approval_resolved', 'tool_execution', 'tool_end', 'answer', 'done']);
    const [first] = toolMessages(seen[1]);
    expect(first.오류).toBe('끝나는 시각은 시작 시각보다 뒤여야 해요');
    expect(first.안내).toContain('남은 기회 2번');
    // 실패해도 쓰기 도구를 계속 알려 고칠 수 있게 한다
    expect(seen[1].tools).toContain('add_my_schedule_event');
    expect(await prisma.scheduleEvent.count({ where: { scheduleEventTitle: '고쳐서 잡은 회의' } })).toBe(1);
  });

  it('스키마가 계속 틀리면 세 번째에서 멈추고 도구 없이 답하게 한다', async () => {
    scriptLlm([
      [toolCall('c1', 'add_my_schedule_event', { date: '2031-03-04' })],
      [toolCall('c2', 'add_my_schedule_event', { date: '2031-03-05' })],
      [toolCall('c3', 'add_my_schedule_event', { date: '2031-03-06' })],
      '일정 제목을 알려 주세요.',
    ]);
    const events = await stream({ question: '회의 잡아줘', approvalCards: true });
    expect(events.some((e) => e.type === 'approval_required')).toBe(false);
    expect(seen).toHaveLength(4);
    expect(seen[3].tools).toEqual([]);
    expect(toolMessages(seen[3]).at(-1)?.안내).toContain('여러 번 고쳐도 맞지 않아');
  });

  it('화면이 연결을 끊으면 기다리던 카드를 거부로 끝내고 만들지 않는다', async () => {
    const before = await prisma.scheduleEvent.count();
    scriptLlm([[toolCall('c1', 'add_my_schedule_event', { ...SCHEDULE, title: '끊긴 회의' })], '끝']);
    const abort = new AbortController();
    const registry = app.get(AssistantApprovalRegistry);
    await stream({ question: '회의 잡아줘', approvalCards: true }, (event) => {
      if (event.type === 'approval_required') abort.abort();
    }, { abort });
    for (let i = 0; i < 50 && registry.pendingCount() > 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(registry.pendingCount()).toBe(0);
    expect(await prisma.scheduleEvent.count()).toBe(before);
    // 끊긴 뒤에는 LLM을 다시 부르지 않는다
    expect(seen).toHaveLength(1);
  });

  it('없는 카드는 AST-001(404), 형식이 틀린 결정은 400', async () => {
    expect((await decide('00000000-0000-4000-8000-000000000000', 'ALLOW')).body.error?.code).toBe('AST-001');
    expect((await decide('00000000-0000-4000-8000-000000000000', 'MAYBE')).status).toBe(400);
    expect((await decide('not-a-uuid', 'ALLOW')).status).toBe(400);
  });
});

describe('구매요청 초안 만들기 (create_purchase_request_draft)', () => {
  it('허용하면 요청자 확인 대기 초안을 만들고 AI 경유로 남긴다. 내 초안 목록에 보인다', async () => {
    scriptLlm([[toolCall('c1', 'create_purchase_request_draft', { itemCode: 'ORE01', requestedTon: 30, desiredReceiptDate: '2031-04-01', requestReason: '재고 보충' })], '초안을 만들었어요.']);
    const events = await stream({ question: '철광석 30톤 구매요청 초안 만들어 줘', approvalCards: true }, async (event) => {
      if (event.type === 'approval_required') await decide(event.approvalId, 'ALLOW');
    });
    const required = events.find((e) => e.type === 'approval_required');
    expect(required).toMatchObject({ toolName: 'create_purchase_request_draft', title: '구매요청 초안 만들기: 철광석 30.000t' });
    const execution = events.find((e) => e.type === 'tool_execution');
    if (execution?.type !== 'tool_execution' || !execution.result) throw new Error('실행 결과가 없어요');
    expect(execution).toMatchObject({ status: 'SUCCESS', result: { table: 'action_draft', linkPath: `/action-drafts/${execution.result.id}` } });

    const draft = await prisma.actionDraft.findUniqueOrThrow({ where: { id: execution.result.id } });
    expect(draft).toMatchObject({ draftStatus: DRAFT_STATUS.WAITING_APPROVAL, requesterId: purchaseId, messageId: null, meetingMinutesId: null });
    const payload = draft.payload as unknown as PurchaseRequisitionDraftPayload;
    expect(payload).toMatchObject({ requestedTon: '30.000', desiredReceiptDate: '2031-04-01', requestReason: '재고 보충', sourceText: '철광석 30톤 구매요청 초안 만들어 줘', fromAiAssistant: true });
    expect(payload.aiFilledFields).toEqual(['itemId', 'requestedTon', 'desiredReceiptDate']);
    const logged = await prisma.businessEvent.findMany({ where: { actionDraftId: draft.id } });
    expect(logged).toEqual([expect.objectContaining({ businessEventType: BUSINESS_EVENT_TYPE.DRAFT_CREATED, isAiAssisted: true, actorEmployeeId: purchaseId })]);

    const list = await fetch(`${baseUrl}/action-drafts`, { headers: { cookie: purchaseCookie } });
    const views = ((await list.json()) as { data: ActionDraftView[] }).data;
    expect(views.find((v) => v.id === draft.id)).toMatchObject({ message: null, meetingMinutes: null, payload: { fromAiAssistant: true }, unresolvedFields: [] });
  });

  it('없는 원료는 원료 목록과 함께 돌려줘 모델이 고치게 한다', async () => {
    scriptLlm([[toolCall('c1', 'create_purchase_request_draft', { itemCode: '금', requestedTon: 1 })], '어떤 원료인가요?']);
    const events = await stream({ question: '금 1톤 사 줘', approvalCards: true });
    expect(events.some((e) => e.type === 'approval_required')).toBe(false);
    const [result] = toolMessages(seen[1]);
    expect(String(result.오류)).toContain('원료 품목을 찾을 수 없어요: 금');
    expect(String(result.오류)).toContain('ORE01(철광석)');
    expect(seen[1].tools).toContain('create_purchase_request_draft');
  });

  it('권한이 없으면(영업) 카드 없이 바로 멈추고 할 수 있는 역할을 안내한다', async () => {
    const before = await prisma.actionDraft.count();
    scriptLlm([[toolCall('c1', 'create_purchase_request_draft', { itemCode: 'ORE01', requestedTon: 10 })], '구매 담당에게 요청해 주세요.']);
    const events = await stream({ question: '철광석 10톤 구매요청 해 줘', approvalCards: true }, undefined, { cookie: salesCookie });
    expect(events.some((e) => e.type === 'approval_required')).toBe(false);
    const [result] = toolMessages(seen[1]);
    expect(result.오류).toBe('권한 없음');
    expect(result['할 수 있는 역할']).toContain('구매');
    expect(result['할 수 있는 역할']).not.toContain('영업');
    // 고칠 수 없는 실패라 다음 차례는 도구 없이 답한다
    expect(seen[1].tools).toEqual([]);
    expect(await prisma.actionDraft.count()).toBe(before);
  });
});
