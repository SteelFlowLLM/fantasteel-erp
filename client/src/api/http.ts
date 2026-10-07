// 실제 서버(server/) 호출. NEXT_PUBLIC_DATA_SOURCE=server일 때만 쓰고, 기본은 지금처럼 브라우저 안 가짜 DB다.
// 화면은 이 파일을 직접 부르지 않는다: 각 api/<영역>.ts 함수가 데이터 출처에 따라 가짜 DB 또는 이 파일을 부른다.
//
// 로그인 화면은 아직 "계정 선택"이다 (SPEC 5장 결정 1). 서버는 쿠키 로그인이 필요해서, 서버 모드에서는
// 이 탭에서 고른 사원의 사원번호와 개발용 시드 비밀번호로 화면 뒤에서 POST /auth/login을 불러 쿠키를 받는다.
// 실제 로그인 화면을 넣으면 ensureLogin만 지운다.
import type { ApiResponse } from '@fantasteel/shared';
import { actingEmployeeId } from '@/api/actor';
import { ApiError, InputError } from '@/api/errors';
import { isErrorCode } from '@/codes';
import { getMockDb } from '@/mock/db';

export type DataSource = 'mock' | 'server';

/** 수주·출하·배정·대시보드·품질(검사·검사 기준·불합격)·생산(생산계획·작업 실적·열연 투입)·구매(구매요청·승인·발주·입고) 화면의 데이터 출처. 다른 화면은 아직 가짜 DB만 쓴다 */
export function dataSource(): DataSource {
  return process.env.NEXT_PUBLIC_DATA_SOURCE === 'server' ? 'server' : 'mock';
}

export const isServerDataSource = (): boolean => dataSource() === 'server';

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8787/api/v1').replace(/\/$/, '');
/** 서버 시드 비밀번호 (docs/backend/seed.md). 개발·시연용이며 실제 로그인 화면이 생기면 쓰지 않는다 */
const DEV_LOGIN_PASSWORD = process.env.NEXT_PUBLIC_DEV_LOGIN_PASSWORD ?? 'fantasteel';

/**
 * 서버 쿠키가 지금 누구 것인지. 쿠키는 브라우저의 모든 탭이 같이 쓰므로, 탭마다 다른 계정을 고르면
 * 다른 탭의 로그인이 쿠키를 덮어쓴다. 그래서 마지막 로그인 사원번호를 localStorage(탭 공유)에 두고 요청마다 비교한다.
 */
const SERVER_LOGIN_KEY = 'fantasteel.server-login.employee-no';
let memoryLoggedIn: string | null = null;
let pendingLogin: Promise<void> | null = null;

function readLoggedIn(): string | null {
  try {
    return window.localStorage.getItem(SERVER_LOGIN_KEY);
  } catch {
    return memoryLoggedIn;
  }
}

function writeLoggedIn(employeeNo: string | null): void {
  memoryLoggedIn = employeeNo;
  try {
    if (employeeNo === null) window.localStorage.removeItem(SERVER_LOGIN_KEY);
    else window.localStorage.setItem(SERVER_LOGIN_KEY, employeeNo);
  } catch {
    // localStorage를 못 쓰면 이 탭의 메모리만 쓴다
  }
}

/** 이 탭에서 고른 계정의 사원번호 (가짜 DB와 서버 시드는 사원번호가 같다) */
function sessionEmployeeNo(): string {
  // 이 탭의 계정 선택 (테스트에서는 setActingEmployeeForTest로 정한 사원)
  const employeeId = actingEmployeeId();
  const employeeNo = employeeId === null ? undefined : getMockDb().read((tables) => tables.employee.find((e) => e.id === employeeId)?.employeeNo);
  if (!employeeNo) throw new ApiError('COM-002', '계정을 먼저 골라 주세요');
  return employeeNo;
}

type ServerError = { code: string; message: string };

/**
 * 서버 실패 응답을 화면 오류로 바꾼다. 업무 오류(9.3)는 ApiError, 입력 형식 오류(COM-004)는 InputError.
 * 서버 문구는 화면 문구와 다를 수 있어 detail에 둔다 (ApiError.message는 늘 9.3 문구).
 */
function toClientError(error: ServerError): Error {
  if (isErrorCode(error.code)) return new ApiError(error.code, error.message);
  if (error.code === 'COM-004') return new InputError(error.message);
  if (error.code === 'AUTH-001' || error.code === 'AUTH-002') return new ApiError('COM-002', error.message);
  return new Error(error.message);
}

async function send(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      method,
      credentials: 'include',
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(`서버(${API_BASE_URL})에 연결할 수 없어요. 서버가 켜져 있는지 확인해 주세요`);
  }
}

async function readBody<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!json) throw new Error(`서버 응답을 읽을 수 없어요 (HTTP ${res.status})`);
  if (json.success) return json.data;
  throw toClientError(json.error);
}

async function ensureLogin(): Promise<void> {
  const employeeNo = sessionEmployeeNo();
  if (readLoggedIn() === employeeNo) return;
  if (!pendingLogin) {
    pendingLogin = (async () => {
      const res = await send('POST', '/auth/login', { employeeNo, password: DEV_LOGIN_PASSWORD });
      await readBody<unknown>(res);
      writeLoggedIn(employeeNo);
    })().finally(() => {
      pendingLogin = null;
    });
  }
  await pendingLogin;
  // 기다리는 사이 계정이 바뀌었으면 한 번 더
  if (readLoggedIn() !== sessionEmployeeNo()) await ensureLogin();
}

export interface ServerRequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

/** 서버 API 호출. 성공 응답의 data를 돌려주고, 실패는 화면 오류(ApiError·InputError)로 던진다 */
export async function serverRequest<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, options: ServerRequestOptions = {}): Promise<T> {
  const query = Object.entries(options.query ?? {}).filter((entry): entry is [string, string | number] => entry[1] !== undefined);
  const url = query.length ? `${path}?${new URLSearchParams(query.map(([k, v]) => [k, String(v)])).toString()}` : path;
  await ensureLogin();
  let res = await send(method, url, options.body, options.headers);
  if (res.status === 401) {
    // 쿠키가 만료됐거나 다른 탭이 다른 사원으로 로그인했다
    writeLoggedIn(null);
    await ensureLogin();
    res = await send(method, url, options.body, options.headers);
  }
  return readBody<T>(res);
}

/** 테스트에서 로그인 상태를 비운다 */
export function resetServerSessionForTest(): void {
  writeLoggedIn(null);
  pendingLogin = null;
}
