// 심층 조사 api (이슈 #400): 계획 저장·제목 바꾸기·다시 조사의 서버 경로와 요청 본문.
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
});
