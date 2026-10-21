// 심층 조사 반복 실행(이슈 #521)을 실제 앱과 DB(fs_collab)로 확인한다. LLM·웹 검색은 가짜로 바꾸고 네트워크는 쓰지 않는다.
// 일꾼·반복 타이머는 돌지 않게 끄고(AI_RESEARCH_WORKER=off) 시험이 scheduler.fireDue()·runner.processNext()를 직접 부른다.
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { AI_RESEARCH_LIMITS, nextAiResearchRunAt, type AiResearchRunSummaryView, type AiResearchRunView, type AiResearchScheduleView, type PageResult } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantWebToolbox, UserSearchLimiter } from '../ai-assistant/web/assistant-web-toolbox';
import type { WebSearchClient } from '../ai-assistant/web/web-search.client';
import { KakaoPlaceClient } from '../ai-assistant/web/web-search.client';
import { LlmClient, type ChatMessage, type LlmJsonSchema } from '../llm/llm.client';
import { LlmSettingsStore } from '../llm/llm-settings.store';
import { NotificationService } from '../notification/notification.service';
import { ResearchKnowledgeFinder } from './ai-research.knowledge';
import { AiResearchRepository } from './ai-research.repository';
import { AiResearchRunner } from './ai-research.runner';
import { AiResearchScheduler, SCHEDULE_OFF_INACTIVE, SCHEDULE_SKIP_NO_MODEL, SCHEDULE_SKIP_PREVIOUS_ACTIVE, SCHEDULE_SKIP_TOO_MANY } from './ai-research.scheduler';

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
let runner: AiResearchRunner;
let scheduler: AiResearchScheduler;
let ownerCookie: string;
let otherCookie: string;
let ownerId: number;
let startRunId = 0;
let startScheduleId = 0;
const settings = { model: 'test-model' as string | null };

const wrap = (value: unknown) => ({ value, rawText: JSON.stringify(value), thinking: null });
/** 모델은 늘 끝내려 한다: 출처가 없으면 계획의 검색어로 대신 찾고, 하나라도 모이면 끝낸다 */
const llmClient = {
  chatJsonWithText: jest.fn(async (_endpoint: unknown, _model: string, _messages: ChatMessage[], format: LlmJsonSchema) => {
    if (format.name === 'research_audit') return wrap({ thesis: '반복 조사 결론', outline: [], supportedClaims: [], contradictions: [], missingDimensions: [] });
    if (format.name === 'research_charts') return wrap({ charts: [] });
    return wrap({ action: 'finish', query: '', sourceId: 0, researchState: { summary: '반복 메모', gaps: [], unsupportedClaims: [] } });
  }),
  chatText: jest.fn(async () => ({ text: '# 반복 보고서\n오늘 가격은 그대로예요 [1].', thinking: null, truncated: false })),
  modelContextLength: jest.fn(async () => null),
  streamWithTools: jest.fn(async () => ({ content: '조회 필요 없음', toolCalls: [], reasoning: null, reasoningApplied: true })),
};
const llmSettings = { read: jest.fn(async () => ({ baseUrl: 'http://llm.test/v1', model: settings.model, apiKey: null })) };
const fakeSearch = {
  engines: () => ['wikipedia'],
  search: async (query: string) => ({ engine: '위키백과(한국어)', results: [{ title: `${query} 개요`, url: `https://ko.wikipedia.org/wiki/${encodeURIComponent(query)}`, snippet: `${query} 요약` }] }),
} as unknown as WebSearchClient;
const toolbox = new AssistantWebToolbox({
  search: fakeSearch,
  places: new KakaoPlaceClient(() => null),
  pages: { read: async (url) => ({ url, title: '읽은 페이지', text: '본문' }) },
  userLimiter: new UserSearchLimiter(1000),
});

async function login(employeeNo: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ employeeNo, password: process.env.SEED_PASSWORD ?? 'fantasteel' }) });
  if (!res.ok) throw new Error(`로그인 실패 (HTTP ${res.status})`);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

async function call<T>(method: 'GET' | 'PUT' | 'DELETE', path: string, cookie: string, payload?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { cookie, ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return { status: res.status, body: (await res.json()) as { data: T; error?: { code: string; message: string } } };
}

const getRun = async (id: number) => (await call<AiResearchRunView>('GET', `/ai-research/runs/${id}`, ownerCookie)).body.data;
const setSchedule = (id: number, body: unknown, cookie = ownerCookie) => call<AiResearchScheduleView>('PUT', `/ai-research/runs/${id}/schedule`, cookie, body);
const plan = { title: '열연 가격 아침 점검', steps: [{ title: '가격', query: '열연 코일 가격 동향' }] };

/** 끝난 조사 하나 (DB에 바로 넣는다: 반복은 끝난 조사의 질문·계획만 본다) */
async function completedRun(question = '열연 코일 가격이 오늘 어떤지', status = 'COMPLETED'): Promise<number> {
  const run = await prisma.aiResearchRun.create({
    data: { employeeId: ownerId, question, status, plan, planRevision: 1, budget: { maxSteps: 2, maxSources: 5 }, researchState: { summary: '', gaps: [], unsupportedClaims: [], searchedQueries: [] }, report: status === 'COMPLETED' ? '# 처음 보고서' : null, finishedAt: new Date() },
  });
  return run.id;
}

/** 다음 차례를 지난 시각으로 당긴다 (시계를 기다리지 않고 차례를 만든다) */
const makeDue = (scheduleId: number) => prisma.aiResearchSchedule.update({ where: { id: scheduleId }, data: { nextRunAt: new Date(Date.now() - 60_000) } });

beforeAll(async () => {
  process.env.AI_RESEARCH_WORKER = 'off';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LlmClient)
    .useValue(llmClient)
    .overrideProvider(LlmSettingsStore)
    .useValue(llmSettings)
    .overrideProvider(AssistantWebToolbox)
    .useValue(toolbox)
    .overrideProvider(ResearchKnowledgeFinder)
    .useValue({ find: () => [] })
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  prisma = app.get(PrismaService);
  runner = app.get(AiResearchRunner);
  scheduler = app.get(AiResearchScheduler);
  startRunId = (await prisma.aiResearchRun.aggregate({ _max: { id: true } }))._max.id ?? 0;
  startScheduleId = (await prisma.aiResearchSchedule.aggregate({ _max: { id: true } }))._max.id ?? 0;
  ownerCookie = await login('2103003');
  otherCookie = await login('2205013');
  ownerId = (await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2103003' } })).id;
}, 60_000);

async function cleanup(): Promise<void> {
  // 반복과 조사는 서로를 가리킨다(Prisma가 Restrict를 흉내 낸다): 조사의 반복 표시를 지우고 반복을 지운 뒤 조사를 지운다
  await prisma.aiResearchRun.updateMany({ where: { id: { gt: startRunId } }, data: { scheduleId: null } });
  await prisma.aiResearchSchedule.deleteMany({ where: { id: { gt: startScheduleId } } });
  await prisma.notification.deleteMany({ where: { recipientId: ownerId, linkPath: { startsWith: '/ai-research?id=' } } });
  await prisma.aiResearchEvent.deleteMany({ where: { runId: { gt: startRunId } } });
  await prisma.aiResearchRun.deleteMany({ where: { id: { gt: startRunId } } });
}

afterAll(async () => {
  await cleanup();
  await app?.close();
});

beforeEach(async () => {
  await cleanup();
  settings.model = 'test-model';
});

describe('심층 조사 반복 (이슈 #521)', () => {
  it('완료한 조사에 매일·매주 반복을 걸고 바꾸면 다음 차례(서울)가 보이고, 목록·상세에 반복으로 보인다', async () => {
    const id = await completedRun();
    const before = new Date();
    const set = await setSchedule(id, { frequency: 'DAILY', time: '07:30' });
    expect(set.status).toBe(200);
    expect(set.body.data).toMatchObject({ runId: id, title: plan.title, frequency: 'DAILY', weekdays: [], time: '07:30', enabled: true, lastRunId: null });
    const next = new Date(set.body.data.nextRunAt ?? '');
    const expected = nextAiResearchRunAt({ frequency: 'DAILY', weekdays: [], time: '07:30' }, before);
    expect(Math.abs(next.getTime() - (expected?.getTime() ?? 0))).toBeLessThan(60_000);
    expect(next.getTime()).toBeGreaterThan(Date.now());

    // 매주로 바꾸면 같은 반복 (요일은 정리해 둔다)
    const weekly = await setSchedule(id, { frequency: 'WEEKLY', weekdays: [5, 1], time: '18:00' });
    expect(weekly.body.data).toMatchObject({ id: set.body.data.id, frequency: 'WEEKLY', weekdays: [1, 5], time: '18:00' });
    const weekday = (new Date(new Date(weekly.body.data.nextRunAt ?? '').getTime() + 9 * 3_600_000).getUTCDay() || 7);
    expect([1, 5]).toContain(weekday);

    const run = await getRun(id);
    expect(run.schedule).toMatchObject({ id: set.body.data.id, runId: id, frequency: 'WEEKLY', enabled: true });
    expect(run.repeating).toBe(true);
    expect(run.fromSchedule).toBe(false);
    const list = await call<PageResult<AiResearchRunSummaryView>>('GET', '/ai-research/runs', ownerCookie);
    expect(list.body.data.items.find((r) => r.id === id)).toMatchObject({ repeating: true, fromSchedule: false });
    const mine = await call<AiResearchScheduleView[]>('GET', '/ai-research/schedules', ownerCookie);
    expect(mine.body.data.map((s) => s.runId)).toEqual([id]);
    expect((await call<AiResearchScheduleView[]>('GET', '/ai-research/schedules', otherCookie)).body.data).toEqual([]);
  });

  it('끝나지 않은 조사·남의 조사·틀린 규칙은 막는다', async () => {
    const waiting = await completedRun('계획 확인 중', 'AWAITING_APPROVAL');
    const notDone = await setSchedule(waiting, { frequency: 'DAILY', time: '09:00' });
    expect(notDone.status).toBe(409);
    expect(notDone.body.error?.code).toBe('RES-002');
    const id = await completedRun();
    expect((await setSchedule(id, { frequency: 'DAILY', time: '09:00' }, otherCookie)).body.error?.code).toBe('RES-001');
    for (const bad of [{ frequency: 'HOURLY', time: '09:00' }, { frequency: 'DAILY', time: '24:00' }, { frequency: 'DAILY', time: '9:00' }, { frequency: 'WEEKLY', weekdays: [8], time: '09:00' }, { frequency: 'WEEKLY', weekdays: [1, 1], time: '09:00' }, { frequency: 'DAILY' }]) {
      const res = await setSchedule(id, bad);
      expect(res.status).toBe(400);
    }
    const noDay = await setSchedule(id, { frequency: 'WEEKLY', weekdays: [], time: '09:00' });
    expect(noDay.status).toBe(400);
    expect(noDay.body.error?.code).toBe('COM-004');
    expect(await prisma.aiResearchSchedule.count({ where: { runId: id } })).toBe(0);
  });

  it(`켜진 반복은 사원당 ${AI_RESEARCH_LIMITS.maxSchedulesPerEmployee}개까지 (RES-009). 바꾸기는 상한에 걸리지 않고, 끄면 다시 걸 수 있다`, async () => {
    const ids: number[] = [];
    for (let i = 0; i < AI_RESEARCH_LIMITS.maxSchedulesPerEmployee + 1; i += 1) ids.push(await completedRun(`반복 상한 ${i}`));
    for (const id of ids.slice(0, -1)) expect((await setSchedule(id, { frequency: 'DAILY', time: '06:00' })).status).toBe(200);
    const over = await setSchedule(ids[ids.length - 1], { frequency: 'DAILY', time: '06:00' });
    expect(over.status).toBe(409);
    expect(over.body.error?.code).toBe('RES-009');
    expect((await setSchedule(ids[0], { frequency: 'DAILY', time: '06:30' })).status).toBe(200);

    const off = await call<AiResearchScheduleView>('DELETE', `/ai-research/runs/${ids[0]}/schedule`, ownerCookie);
    expect(off.status).toBe(200);
    expect(off.body.data).toMatchObject({ enabled: false, nextRunAt: null });
    expect((await setSchedule(ids[ids.length - 1], { frequency: 'DAILY', time: '06:00' })).status).toBe(200);
    // 끈 반복을 다시 켜려면 다시 상한을 본다
    expect((await setSchedule(ids[0], { frequency: 'DAILY', time: '06:00' })).body.error?.code).toBe('RES-009');
  });

  it('차례가 되면 같은 질문·계획으로 새 조사를 계획 확인 없이 줄에 세우고, 다음 차례로 넘긴다. 끝나면 반복 완료 알림이 간다', async () => {
    const id = await completedRun();
    const schedule = (await setSchedule(id, { frequency: 'DAILY', time: '08:00' })).body.data;
    // 아직 차례가 아니면 아무것도 하지 않는다
    expect(await scheduler.fireDue()).toEqual([]);
    await makeDue(schedule.id);
    const [result] = await scheduler.fireDue();
    expect(result).toMatchObject({ scheduleId: schedule.id, kind: 'created' });
    const runId = result.kind === 'created' ? result.runId : 0;

    const created = await getRun(runId);
    expect(created).toMatchObject({ status: 'QUEUED', question: '열연 코일 가격이 오늘 어떤지', plan, planRevision: 1, fromSchedule: true, repeating: false });
    expect(created.schedule).toMatchObject({ id: schedule.id, runId: id, lastRunId: runId, lastSkipReason: null });
    expect(new Date(created.schedule?.nextRunAt ?? '').getTime()).toBeGreaterThan(Date.now());
    expect(created.events.map((e) => e.type)).toEqual(['plan.ready']);
    expect(created.events[0].payload).toMatchObject({ copiedFrom: id, scheduled: true, stepCount: 1 });
    // 같은 차례는 다시 하지 않는다
    expect(await scheduler.fireDue()).toEqual([]);

    expect(await runner.processNext()).toBe(true);
    const done = await getRun(runId);
    expect(done.status).toBe('COMPLETED');
    expect(done.report).toContain('오늘 가격은 그대로예요');
    const notes = await prisma.notification.findMany({ where: { recipientId: ownerId, linkPath: `/ai-research?id=${runId}` } });
    expect(notes.map((n) => n.notificationContent)).toEqual([`반복 심층 조사 완료 · ${plan.title}`]);
    // 원래 조사는 그대로
    expect((await getRun(id)).report).toBe('# 처음 보고서');
  });

  it('두 서버가 같은 차례를 동시에 집어도 한 번만 만든다 (조건부 UPDATE)', async () => {
    const id = await completedRun();
    const schedule = (await setSchedule(id, { frequency: 'DAILY', time: '08:00' })).body.data;
    await makeDue(schedule.id);
    const other = new AiResearchScheduler(prisma, app.get(AiResearchRepository), llmSettings as unknown as LlmSettingsStore, app.get(NotificationService), runner);
    const results = (await Promise.all([scheduler.fireDue(), other.fireDue(), scheduler.fireDue()])).flat();
    expect(results.filter((r) => r.kind === 'created')).toHaveLength(1);
    expect(await prisma.aiResearchRun.count({ where: { scheduleId: schedule.id } })).toBe(1);
  });

  it('앞 반복 조사가 아직 진행 중이거나 진행 중 조사가 3개거나 모델이 없으면 그 차례를 건너뛰고 알린다', async () => {
    const id = await completedRun();
    const schedule = (await setSchedule(id, { frequency: 'DAILY', time: '08:00' })).body.data;
    await makeDue(schedule.id);
    await scheduler.fireDue();
    // 앞 반복 조사가 QUEUED 그대로
    await makeDue(schedule.id);
    expect(await scheduler.fireDue()).toEqual([{ scheduleId: schedule.id, kind: 'skipped', reason: SCHEDULE_SKIP_PREVIOUS_ACTIVE }]);
    expect(await prisma.aiResearchRun.count({ where: { scheduleId: schedule.id } })).toBe(1);
    const row = await prisma.aiResearchSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
    expect(row.lastSkipReason).toBe(SCHEDULE_SKIP_PREVIOUS_ACTIVE);
    expect(row.nextRunAt?.getTime()).toBeGreaterThan(Date.now());
    const skipped = await prisma.notification.findMany({ where: { recipientId: ownerId, linkPath: `/ai-research?id=${id}` } });
    expect(skipped.map((n) => n.notificationContent)).toEqual([`반복 심층 조사 건너뜀 · ${plan.title} (${SCHEDULE_SKIP_PREVIOUS_ACTIVE})`]);

    // 앞 반복은 끝났지만 진행 중인 조사가 3개
    await prisma.aiResearchRun.updateMany({ where: { scheduleId: schedule.id }, data: { status: 'COMPLETED' } });
    for (let i = 0; i < AI_RESEARCH_LIMITS.activeRunsPerEmployee; i += 1) await completedRun(`진행 중 ${i}`, 'QUEUED');
    await makeDue(schedule.id);
    expect((await scheduler.fireDue())[0]).toMatchObject({ kind: 'skipped', reason: SCHEDULE_SKIP_TOO_MANY });
    await prisma.aiResearchRun.updateMany({ where: { employeeId: ownerId, status: 'QUEUED' }, data: { status: 'CANCELLED' } });

    settings.model = null;
    await makeDue(schedule.id);
    expect((await scheduler.fireDue())[0]).toMatchObject({ kind: 'skipped', reason: SCHEDULE_SKIP_NO_MODEL });
    settings.model = 'test-model';
    await makeDue(schedule.id);
    expect((await scheduler.fireDue())[0]).toMatchObject({ kind: 'created' });
    expect((await prisma.aiResearchSchedule.findUniqueOrThrow({ where: { id: schedule.id } })).lastSkipReason).toBeNull();
  });

  it('반복을 끄면 차례가 오지 않고, 반복이 만든 조사에서 바꾸거나 끄면 원래 조사의 반복이 바뀐다', async () => {
    const id = await completedRun();
    const schedule = (await setSchedule(id, { frequency: 'DAILY', time: '08:00' })).body.data;
    await makeDue(schedule.id);
    const [first] = await scheduler.fireDue();
    const childId = first.kind === 'created' ? first.runId : 0;

    // 반복이 만든 조사에서 바꾸면 같은 반복이 바뀐다 (반복이 새로 생기지 않는다)
    const changed = await setSchedule(childId, { frequency: 'WEEKLY', weekdays: [3], time: '12:00' });
    expect(changed.status).toBe(200);
    expect(changed.body.data).toMatchObject({ id: schedule.id, runId: id, frequency: 'WEEKLY', weekdays: [3] });
    expect(await prisma.aiResearchSchedule.count({ where: { id: { gt: startScheduleId } } })).toBe(1);

    const off = await call<AiResearchScheduleView>('DELETE', `/ai-research/runs/${childId}/schedule`, ownerCookie);
    expect(off.body.data).toMatchObject({ id: schedule.id, enabled: false, nextRunAt: null });
    expect((await getRun(id)).repeating).toBe(false);
    expect(await scheduler.fireDue()).toEqual([]);
    // 이미 꺼진 것을 또 꺼도 그대로, 반복이 없는 조사는 404
    expect((await call('DELETE', `/ai-research/runs/${id}/schedule`, ownerCookie)).status).toBe(200);
    const none = await call('DELETE', `/ai-research/runs/${await completedRun('반복 없음')}/schedule`, ownerCookie);
    expect(none.status).toBe(404);
    expect(none.body.error?.code).toBe('RES-001');
    expect((await call('DELETE', `/ai-research/runs/${id}/schedule`, otherCookie)).status).toBe(404);
  });

  it('퇴사한 사원의 반복은 차례가 오면 끈다', async () => {
    const id = await completedRun();
    const schedule = (await setSchedule(id, { frequency: 'DAILY', time: '08:00' })).body.data;
    await makeDue(schedule.id);
    await prisma.employee.update({ where: { id: ownerId }, data: { isActive: false } });
    try {
      expect(await scheduler.fireDue()).toEqual([{ scheduleId: schedule.id, kind: 'disabled', reason: SCHEDULE_OFF_INACTIVE }]);
    } finally {
      await prisma.employee.update({ where: { id: ownerId }, data: { isActive: true } });
    }
    const row = await prisma.aiResearchSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
    expect(row).toMatchObject({ enabled: false, nextRunAt: null, lastSkipReason: SCHEDULE_OFF_INACTIVE });
    expect(await prisma.aiResearchRun.count({ where: { scheduleId: schedule.id } })).toBe(0);
  });
});
