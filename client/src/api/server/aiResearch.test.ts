// 심층 조사 api (이슈 #400·#416): 계획 저장·제목 바꾸기·다시 조사·계획 말로 고치기의 서버 경로와 요청 본문.
import type { AiResearchRunView } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { aiResearchApi } from '@/api/aiResearch';
import { ok, stopFakeServer, useFakeServer } from '@/api/server/serverTestKit';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

const view = (patch: Partial<AiResearchRunView>) => ({ id: 3, status: 'AWAITING_APPROVAL', planRevision: 2, ...patch }) as AiResearchRunView;

afterEach(() => stopFakeServer());

describe('심층 조사 api (api/aiResearch.ts)', () => {
  it('계획 저장은 판과 계획만 PUT하고 시작은 부르지 않는다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, (c) => (c.method === 'PUT' && c.path === '/ai-research/runs/3/plan' ? ok(view({ planRevision: 3 })) : undefined));
    const plan = { title: '계획', steps: [{ title: '가격', query: '열연 가격' }] };
    expect((await aiResearchApi.updatePlan(3, 2, plan)).planRevision).toBe(3);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['PUT /ai-research/runs/3/plan']);
    expect(calls[0].body).toEqual({ revision: 2, plan });
  });

  it('제목 바꾸기는 판과 앞뒤 공백을 뗀 제목을 PATCH', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, (c) => (c.method === 'PATCH' && c.path === '/ai-research/runs/3/title' ? ok(view({ status: 'COMPLETED', title: '새 제목', planRevision: 3 })) : undefined));
    expect((await aiResearchApi.rename(3, 2, '  새 제목 ')).title).toBe('새 제목');
    expect(calls[0].body).toEqual({ revision: 2, title: '새 제목' });
  });

  it('다시 조사는 본문 없이 POST하고 새 조사를 받는다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, (c) => (c.method === 'POST' && c.path === '/ai-research/runs/3/rerun' ? ok(view({ id: 9, planRevision: 1 })) : undefined));
    expect((await aiResearchApi.rerun(3)).id).toBe(9);
    expect(calls[0].body).toBeUndefined();
  });

  it('계획 말로 고치기는 다듬은 부탁과 지금 계획을 POST하고 고친 계획을 받는다', async () => {
    const suggested = { plan: { title: '계획', steps: [{ title: '전망', query: '열연 가격 전망' }] }, dropped: 1 };
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, (c) => (c.method === 'POST' && c.path === '/ai-research/runs/3/plan/suggest' ? ok(suggested) : undefined));
    const plan = { title: '계획', steps: [{ title: '가격', query: '' }] };
    expect(await aiResearchApi.suggestPlan(3, '  전망 넣어 줘 ', plan)).toEqual(suggested);
    expect(calls[0].body).toEqual({ instruction: '전망 넣어 줘', plan });
  });

  it('보고서 고치기는 다듬은 부탁과 더 검색 여부를 POST, 판은 GET으로 읽는다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, (c) => {
      if (c.method === 'POST' && c.path === '/ai-research/runs/3/revisions') return ok(view({ status: 'QUEUED' }));
      if (c.method === 'GET' && c.path === '/ai-research/runs/3/versions/2') return ok({ version: 2, instruction: '보강', search: true, createdAt: '2026-10-20T03:00:00.000Z', report: '# 2판', charts: [] });
      return undefined;
    });
    expect((await aiResearchApi.revise(3, '  3장 보강 ', false)).status).toBe('QUEUED');
    expect(calls[0].body).toEqual({ instruction: '3장 보강', search: false });
    expect((await aiResearchApi.getVersion(3, 2)).report).toBe('# 2판');
  });

  it('반복 걸기는 규칙을 PUT, 끄기는 DELETE, 목록은 GET (이슈 #521)', async () => {
    const schedule = { id: 1, runId: 3, title: '제목', frequency: 'DAILY', weekdays: [], time: '09:00', enabled: true, nextRunAt: '2026-10-23T00:00:00.000Z', lastRunAt: null, lastRunId: null, lastSkipReason: null };
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, (c) => {
      if (c.method === 'PUT' && c.path === '/ai-research/runs/3/schedule') return ok(schedule);
      if (c.method === 'DELETE' && c.path === '/ai-research/runs/3/schedule') return ok({ ...schedule, enabled: false, nextRunAt: null });
      if (c.method === 'GET' && c.path === '/ai-research/schedules') return ok([schedule]);
      return undefined;
    });
    expect((await aiResearchApi.setSchedule(3, { frequency: 'DAILY', weekdays: [], time: '09:00' })).nextRunAt).toBe(schedule.nextRunAt);
    expect(calls[0].body).toEqual({ frequency: 'DAILY', weekdays: [], time: '09:00' });
    expect((await aiResearchApi.disableSchedule(3)).enabled).toBe(false);
    expect(await aiResearchApi.schedules()).toHaveLength(1);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['PUT /ai-research/runs/3/schedule', 'DELETE /ai-research/runs/3/schedule', 'GET /ai-research/schedules']);
  });

  it('Notion 내보내기는 고른 판을 본문으로, PDF는 판을 쿼리로 보낸다 (이슈 #521)', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, (c) => {
      if (c.method === 'POST' && c.path === '/ai-research/runs/3/notion-export') return ok({ notionPageUrl: 'https://www.notion.so/x', run: view({ status: 'COMPLETED' }) });
      if (c.method === 'GET' && c.path === '/ai-research/runs/3/pdf') return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { 'content-type': 'application/pdf' } });
      return undefined;
    });
    await aiResearchApi.exportToNotion(3, 2);
    await aiResearchApi.exportToNotion(3);
    expect(calls.map((c) => c.body)).toEqual([{ version: 2 }, {}]);
    const blob = await aiResearchApi.pdf(3, 1);
    expect(blob.size).toBe(4);
    expect(calls[2].query).toEqual({ version: '1' });
    await aiResearchApi.pdf(3);
    expect(calls[3].query).toEqual({});
  });
});
