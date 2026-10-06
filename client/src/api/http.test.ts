// 서버 호출 계층: 계정 선택한 사원으로 자동 로그인, 계정이 바뀌면 다시 로그인, 401이면 한 번 다시 로그인, 오류 코드 변환.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActingEmployeeForTest } from '@/api/actor';
import { ApiError, InputError } from '@/api/errors';
import { dataSource, resetServerSessionForTest, serverRequest } from '@/api/http';
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

  it('처음 부를 때 고른 계정의 사원번호로 로그인하고, 같은 계정이면 다시 로그인하지 않는다', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    useServer((c) => (c.url.endsWith('/auth/login') ? ok({}) : ok({ value: 1 })));
    await expect(serverRequest('GET', '/sales-orders', { query: { page: 1, size: 20, skip: undefined } })).resolves.toEqual({ value: 1 });
    await serverRequest('GET', '/sales-orders/1');
    expect(calls.map((c) => `${c.method} ${c.url.replace(/^.*\/api\/v1/, '')}`)).toEqual(['POST /auth/login', 'GET /sales-orders?page=1&size=20', 'GET /sales-orders/1']);
    expect(calls[0].body).toEqual({ employeeNo: SEED_EMPLOYEE_NO.sales, password: 'fantasteel' });
  });

  it('계정을 바꾸면 바꾼 사원으로 다시 로그인한다', async () => {
    useServer((c) => (c.url.endsWith('/auth/login') ? ok({}) : ok(null)));
    actAs(SEED_EMPLOYEE_NO.sales);
    await serverRequest('GET', '/a');
    actAs(SEED_EMPLOYEE_NO.logistics);
    await serverRequest('GET', '/b');
    expect(calls.filter((c) => c.url.endsWith('/auth/login')).map((c) => (c.body as { employeeNo: string }).employeeNo)).toEqual([SEED_EMPLOYEE_NO.sales, SEED_EMPLOYEE_NO.logistics]);
  });

  it('쿠키가 만료돼 401이면 다시 로그인하고 한 번 더 보낸다', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    let first = true;
    useServer((c) => {
      if (c.url.endsWith('/auth/login')) return ok({});
      if (first) {
        first = false;
        return fail(401, 'AUTH-002', '로그인이 필요합니다');
      }
      return ok('done');
    });
    await expect(serverRequest('GET', '/x')).resolves.toBe('done');
    expect(calls.filter((c) => c.url.endsWith('/auth/login'))).toHaveLength(2);
  });

  it('업무 오류는 ApiError(서버 문구는 detail), 입력 형식 오류는 InputError로 바꾼다', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    useServer((c) => {
      if (c.url.endsWith('/auth/login')) return ok({});
      if (c.url.endsWith('/so')) return fail(409, 'SO-004', '진행 중인 출하요청을 먼저 취소해 주세요');
      return fail(400, 'COM-004', 'items.0.납기는 YYYY-MM-DD로 입력해 주세요');
    });
    const so = await serverRequest('POST', '/so').catch((e: unknown) => e);
    expect(so).toBeInstanceOf(ApiError);
    expect(so).toMatchObject({ code: 'SO-004', detail: '진행 중인 출하요청을 먼저 취소해 주세요' });
    await expect(serverRequest('POST', '/other')).rejects.toBeInstanceOf(InputError);
  });

  it('계정을 고르지 않았으면 서버를 부르지 않고 COM-002', async () => {
    setActingEmployeeForTest(null);
    useServer(() => ok(null));
    await expect(serverRequest('GET', '/x')).rejects.toMatchObject({ code: 'COM-002' });
    expect(calls).toHaveLength(0);
  });
});
