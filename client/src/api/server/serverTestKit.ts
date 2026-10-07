// 서버 모드 어댑터 테스트용: fetch를 가짜 서버로 바꾸고 요청을 모은다 (api/http.test.ts와 같은 방식).
import { vi } from 'vitest';
import { resetServerSessionForTest } from '@/api/http';
import { actAs } from '@/test/actors';

export interface ServerCall {
  method: string;
  /** /api/v1 뒤 경로 (쿼리 제외) */
  path: string;
  query: Record<string, string>;
  /** JSON 본문은 읽은 값, multipart는 FormData 그대로 */
  body: unknown;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
export const ok = (data: unknown): Response => json(200, { success: true, data });
export const fail = (status: number, code: string, message: string): Response => json(status, { success: false, error: { code, message } });
export const page = <T>(items: T[], total = items.length) => ({ items, page: 1, size: 100, total });

/** 서버 모드로 바꾸고 이 사원으로 로그인한 상태에서 응답한다. respond가 undefined를 돌려주면 404 */
export function useFakeServer(employeeNo: string, respond: (call: ServerCall) => Response | undefined): ServerCall[] {
  const calls: ServerCall[] = [];
  vi.stubEnv('NEXT_PUBLIC_DATA_SOURCE', 'server');
  actAs(employeeNo);
  resetServerSessionForTest(employeeNo);
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const parsed = new URL(url);
    const call: ServerCall = {
      method: init.method ?? 'GET',
      path: parsed.pathname.replace(/^.*\/api\/v1/, ''),
      query: Object.fromEntries(parsed.searchParams.entries()),
      body: init.body instanceof FormData ? init.body : init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    return respond(call) ?? fail(404, 'COM-003', `없는 경로 ${call.method} ${call.path}`);
  });
  return calls;
}

export function stopFakeServer(): void {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetServerSessionForTest();
}
