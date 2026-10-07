// 실제 서버(server/) 호출. NEXT_PUBLIC_DATA_SOURCE=server일 때만 쓰고, 기본은 지금처럼 브라우저 안 가짜 DB다.
// 화면은 이 파일을 직접 부르지 않는다: 각 api/<영역>.ts 함수가 데이터 출처에 따라 가짜 DB 또는 이 파일을 부른다.
//
// 서버 모드 로그인은 사원번호·비밀번호다 (REQ-AUTH-001, 2026-10-07 사용자 결정. 가짜 DB 모드는 계정 선택 그대로).
// 로그인 쿠키(JWT)는 브라우저의 모든 탭이 같이 쓰므로 한 브라우저에서는 한 계정만 쓸 수 있다.
import type { ApiResponse, AuthUser } from '@fantasteel/shared';
import { actingEmployeeNo } from '@/api/actor';
import { ApiError, InputError } from '@/api/errors';
import { isErrorCode } from '@/codes';

export type DataSource = 'mock' | 'server';

/** 수주·출하·배정·출고 확정·밀시트·대시보드·품질(검사·검사 기준·불합격)·생산(생산계획·작업 실적·열연 투입)·구매(구매요청·승인·발주·입고)·LOT 추적·재고·작업 로그·조직 관리·조직도·업무·알림·메신저 화면의 데이터 출처. 다른 화면은 아직 가짜 DB만 쓴다 */
export function dataSource(): DataSource {
  return process.env.NEXT_PUBLIC_DATA_SOURCE === 'server' ? 'server' : 'mock';
}

export const isServerDataSource = (): boolean => dataSource() === 'server';

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8787/api/v1').replace(/\/$/, '');

/**
 * 서버 쿠키가 지금 누구 것인지. 다른 탭이 다른 사원으로 로그인하면 쿠키가 바뀌므로, 마지막 로그인 사원번호를
 * localStorage(탭 공유)에 두고 요청마다 이 탭의 사원과 비교한다. 다르면 요청을 보내지 않고 다시 로그인하게 한다.
 */
const SERVER_LOGIN_KEY = 'fantasteel.server-login.employee-no';
let memoryLoggedIn: string | null = null;

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

// ── 서버 세션이 끊김 (만료·로그아웃·다른 탭 로그인): 셸이 듣고 로그인 화면으로 보낸다 ──

type SessionLostListener = (message: string) => void;
const sessionLostListeners = new Set<SessionLostListener>();

const otherLoginMessage = (loggedIn: string | null) =>
  loggedIn === null ? '로그아웃됐어요. 다시 로그인해 주세요' : '다른 탭에서 다른 계정으로 로그인했어요. 다시 로그인해 주세요';

function sessionLost(message: string): ApiError {
  for (const listener of sessionLostListeners) listener(message);
  return new ApiError('COM-002', message);
}

/** 세션이 끊기면 부른다. 다른 탭의 로그인·로그아웃은 storage 이벤트로 바로 알아챈다. 해제 함수를 돌려준다 */
export function onServerSessionLost(listener: SessionLostListener): () => void {
  sessionLostListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === SERVER_LOGIN_KEY && event.newValue !== actingEmployeeNo()) listener(otherLoginMessage(event.newValue));
  };
  window.addEventListener('storage', onStorage);
  return () => {
    sessionLostListeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

type ServerError = { code: string; message: string };

/**
 * 서버 실패 응답을 화면 오류로 바꾼다. 업무 오류(9.3)는 ApiError, 입력 형식 오류(COM-004)는 InputError.
 * 서버 문구는 화면 문구와 다를 수 있어 detail에 둔다 (ApiError.message는 늘 9.3 문구).
 */
function toClientError(error: ServerError): Error {
  if (isErrorCode(error.code)) return new ApiError(error.code, error.message);
  if (error.code === 'COM-004') return new InputError(error.message);
  // 로그인 실패(AUTH-001)는 로그인 화면에 서버 문구 그대로 보인다
  if (error.code === 'AUTH-001' || error.code === 'AUTH-002') return new Error(error.message);
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

/** 로그인 (API-152). 쿠키는 서버가 httpOnly로 내려준다 */
export async function serverLogin(employeeNo: string, password: string): Promise<AuthUser> {
  const user = await readBody<AuthUser>(await send('POST', '/auth/login', { employeeNo, password }));
  writeLoggedIn(user.employeeNo);
  return user;
}

/** 이미 로그인된 브라우저에서 새 탭을 열면 쿠키의 사원을 돌려준다 (없거나 만료면 null) */
export async function currentServerLogin(): Promise<AuthUser | null> {
  if (readLoggedIn() === null) return null;
  const res = await send('GET', '/auth/me');
  if (res.status !== 401) return readBody<AuthUser>(res);
  writeLoggedIn(null);
  return null;
}

/** 로그아웃 (API-153). 다른 탭이 다른 사원으로 로그인해 쿠키가 바뀌었으면 그 로그인은 두고 이 탭만 나간다 */
export async function serverLogout(): Promise<void> {
  if (readLoggedIn() !== actingEmployeeNo()) return;
  writeLoggedIn(null);
  await send('POST', '/auth/logout').catch(() => undefined);
}

export interface ServerRequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

/** 서버 API 호출. 성공 응답의 data를 돌려주고, 실패는 화면 오류(ApiError·InputError)로 던진다 */
export async function serverRequest<T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, options: ServerRequestOptions = {}): Promise<T> {
  const query = Object.entries(options.query ?? {}).filter((entry): entry is [string, string | number] => entry[1] !== undefined);
  const url = query.length ? `${path}?${new URLSearchParams(query.map(([k, v]) => [k, String(v)])).toString()}` : path;
  const employeeNo = actingEmployeeNo();
  if (!employeeNo) throw new ApiError('COM-002', '로그인해 주세요');
  const loggedIn = readLoggedIn();
  if (loggedIn !== employeeNo) throw sessionLost(otherLoginMessage(loggedIn));
  const res = await send(method, url, options.body, options.headers);
  if (res.status === 401) {
    writeLoggedIn(null);
    throw sessionLost('로그인 시간이 지났어요. 다시 로그인해 주세요');
  }
  return readBody<T>(res);
}

/** 로그인 확인을 거쳐 fetch한다. 401이면 세션이 끊긴 것으로 본다 (serverRequest와 같은 규칙, 본문은 그대로 넘긴다) */
async function sendRaw(method: 'GET' | 'POST', path: string, body?: BodyInit): Promise<Response> {
  const employeeNo = actingEmployeeNo();
  if (!employeeNo) throw new ApiError('COM-002', '로그인해 주세요');
  const loggedIn = readLoggedIn();
  if (loggedIn !== employeeNo) throw sessionLost(otherLoginMessage(loggedIn));
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { method, credentials: 'include', body });
  } catch {
    throw new Error(`서버(${API_BASE_URL})에 연결할 수 없어요. 서버가 켜져 있는지 확인해 주세요`);
  }
  if (res.status === 401) {
    writeLoggedIn(null);
    throw sessionLost('로그인 시간이 지났어요. 다시 로그인해 주세요');
  }
  return res;
}

/** 파일 올리기 (multipart). content-type은 브라우저가 경계값과 함께 정한다 */
export async function serverUpload<T>(path: string, form: FormData): Promise<T> {
  return readBody<T>(await sendRaw('POST', path, form));
}

/** 파일 내려받기. 실패하면 서버 오류 응답(JSON)을 화면 오류로 바꾼다 */
export async function serverDownload(path: string): Promise<Blob> {
  const res = await sendRaw('GET', path);
  if (!res.ok) await readBody<never>(res);
  return res.blob();
}

/** 실시간 연결(WebSocket)용 서버 주소: API 주소에서 /api/v1을 뺀 origin */
export function serverOrigin(): string {
  return new URL(API_BASE_URL).origin;
}

/** 테스트에서 이 사원으로 로그인한 상태로 둔다 (null이면 로그아웃 상태) */
export function resetServerSessionForTest(employeeNo: string | null = null): void {
  writeLoggedIn(employeeNo);
}
