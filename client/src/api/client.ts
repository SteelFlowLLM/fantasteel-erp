// 모든 API 호출은 이 파일의 함수 + 커스텀 훅으로만 한다 (코드 컨벤션 9장). 컴포넌트에서 fetch 직접 호출 금지.
import type { ApiResponse } from '@fantasteel/shared';
import { getAccessToken, useAuthStore } from '@/stores/auth';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

const BASE = '/api/v1';
type Query = Record<string, string | number | boolean | null | undefined>;

function qs(query?: Query): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function request<T>(method: string, path: string, options: { query?: Query; body?: unknown; form?: FormData; headers?: Record<string, string> } = {}): Promise<T> {
  const token = getAccessToken();
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}${qs(options.query)}`, { method, headers, body });
  } catch {
    throw new ApiError('NETWORK', '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요', 0);
  }
  let json: ApiResponse<T> | null = null;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    // 본문이 없는 응답
  }
  if (res.status === 401 && token) useAuthStore.getState().setSession(null);
  if (!json) throw new ApiError('COM-999', `서버 응답을 읽지 못했습니다 (${res.status})`, res.status);
  if (!json.success) throw new ApiError(json.error.code, json.error.message, res.status);
  return json.data;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>('POST', path, { body: body ?? {}, headers }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body: body ?? {} }),
  delete: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, { form }),
};

/** 같은 요청을 다시 보내도 한 번만 처리되게 하는 키 (수주 등록·출고 확정 등). */
export const newIdempotencyKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/** 파일 다운로드·PDF 열기용 주소 (링크에는 헤더를 실을 수 없어 토큰을 쿼리로 붙인다). */
export function fileUrl(path: string): string {
  const token = getAccessToken();
  return `${BASE}${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token ?? '')}`;
}
