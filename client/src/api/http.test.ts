// 서버 호출 계층: 사원번호·비밀번호 로그인·로그아웃, 세션 끊김(401·다른 탭 로그인) 알림, 오류 코드 변환.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActingEmployeeForTest } from '@/api/actor';
import { ApiError, InputError } from '@/api/errors';
import { dataSource, onServerSessionLost, resetServerSessionForTest, serverLogin, serverLogout, serverRequest } from '@/api/http';
import { getMockDb } from '@/mock/db';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

interface Call {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ok = (data: unknown) => json(200, { success: true, data });
const fail = (status: number, code: string, message: string) => json(status, { success: false, error: { code, message } });

let calls: Call[];

function useServer(respond: (call: Call) => Response) {
  calls = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const call: Call = { method: init.method ?? 'GET', url, body: init.body ? JSON.parse(String(init.body)) : undefined, headers: (init.headers ?? {}) as Record<string, string> };
    calls.push(call);
    return respond(call);
  });
}

const actAs = (employeeNo: string) => {
  const id = getMockDb().read((t) => t.employee.find((e) => e.employeeNo === employeeNo)?.id);
  setActingEmployeeForTest(id ?? null);
};

beforeEach(() => resetServerSessionForTest());
afterEach(() => vi.unstubAllGlobals());

describe('서버 호출 계층 (api/http.ts)', () => {
  it('기본 데이터 출처는 가짜 DB다', () => {
    expect(dataSource()).toBe('mock');
  });

  it('로그인하면 그 사원으로 요청하고, 로그인 실패는 서버 문구 그대로 보인다', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    useServer((c) => {
      if (!c.url.endsWith('/auth/login')) return ok({ value: 1 });
      const body = c.body as { password: string };
      return body.password === 'fantasteel' ? ok({ employeeId: 3, employeeNo: SEED_EMPLOYEE_NO.sales }) : fail(401, 'AUTH-001', '사원번호 또는 비밀번호가 올바르지 않습니다');
    });
    await expect(serverLogin(SEED_EMPLOYEE_NO.sales, 'wrong')).rejects.toThrow('사원번호 또는 비밀번호가 올바르지 않습니다');
    await expect(serverRequest('GET', '/x')).rejects.toMatchObject({ code: 'COM-002' });
    await serverLogin(SEED_EMPLOYEE_NO.sales, 'fantasteel');
    await expect(serverRequest('GET', '/sales-orders', { query: { page: 1, size: 20, skip: undefined } })).resolves.toEqual({ value: 1 });
    expect(calls.map((c) => `${c.method} ${c.url.replace(/^.*\/api\/v1/, '')}`)).toEqual(['POST /auth/login', 'POST /auth/login', 'GET /sales-orders?page=1&size=20']);
  });

  it('다른 탭이 다른 사원으로 로그인했으면 요청을 보내지 않고 세션이 끊겼다고 알린다', async () => {
    useServer(() => ok({ employeeId: 9, employeeNo: SEED_EMPLOYEE_NO.logistics }));
    const lost = vi.fn();
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const stop = onServerSessionLost(lost);
    actAs(SEED_EMPLOYEE_NO.sales);
    resetServerSessionForTest(SEED_EMPLOYEE_NO.sales);
    await serverLogin(SEED_EMPLOYEE_NO.logistics, 'fantasteel');
    calls = [];
    await expect(serverRequest('GET', '/a')).rejects.toMatchObject({ code: 'COM-002', detail: '다른 탭에서 다른 계정으로 로그인했어요. 다시 로그인해 주세요' });
    expect(calls).toHaveLength(0);
    expect(lost).toHaveBeenCalledOnce();
    stop();
  });

  it('쿠키가 만료돼 401이면 로그아웃 상태로 두고 세션이 끊겼다고 알린다', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    resetServerSessionForTest(SEED_EMPLOYEE_NO.sales);
    useServer(() => fail(401, 'AUTH-002', '로그인이 필요합니다'));
    await expect(serverRequest('GET', '/x')).rejects.toMatchObject({ code: 'COM-002', detail: '로그인 시간이 지났어요. 다시 로그인해 주세요' });
    await expect(serverRequest('GET', '/y')).rejects.toMatchObject({ detail: '로그아웃됐어요. 다시 로그인해 주세요' });
    expect(calls).toHaveLength(1);
  });

  it('로그아웃은 쿠키가 이 탭 사원 것일 때만 서버에 보낸다', async () => {
    useServer(() => ok(null));
    actAs(SEED_EMPLOYEE_NO.sales);
    resetServerSessionForTest(SEED_EMPLOYEE_NO.logistics);
    await serverLogout();
    expect(calls).toHaveLength(0);
    resetServerSessionForTest(SEED_EMPLOYEE_NO.sales);
    await serverLogout();
    expect(calls.map((c) => `${c.method} ${c.url.replace(/^.*\/api\/v1/, '')}`)).toEqual(['POST /auth/logout']);
    await expect(serverRequest('GET', '/x')).rejects.toMatchObject({ code: 'COM-002' });
  });

  it('업무 오류는 ApiError(서버 문구는 detail), 입력 형식 오류는 InputError로 바꾼다', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    resetServerSessionForTest(SEED_EMPLOYEE_NO.sales);
    useServer((c) => {
      if (c.url.endsWith('/so')) return fail(409, 'SO-004', '진행 중인 출하요청을 먼저 취소해 주세요');
      return fail(400, 'COM-004', 'items.0.납기는 YYYY-MM-DD로 입력해 주세요');
    });
    const so = await serverRequest('POST', '/so').catch((e: unknown) => e);
    expect(so).toBeInstanceOf(ApiError);
    expect(so).toMatchObject({ code: 'SO-004', detail: '진행 중인 출하요청을 먼저 취소해 주세요' });
    await expect(serverRequest('POST', '/other')).rejects.toBeInstanceOf(InputError);
  });

  it('로그인하지 않았으면 서버를 부르지 않고 COM-002', async () => {
    setActingEmployeeForTest(null);
    useServer(() => ok(null));
    await expect(serverRequest('GET', '/x')).rejects.toMatchObject({ code: 'COM-002' });
    expect(calls).toHaveLength(0);
  });
});
