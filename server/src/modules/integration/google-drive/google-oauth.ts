import { createHash, randomBytes } from 'node:crypto';

/** Google 고정 주소. 사용자가 넣은 주소로는 요청하지 않는다 (SSRF 없음) */
const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_DRIVE_API_URL = 'https://www.googleapis.com/drive/v3';

/**
 * drive.readonly: 폴더 안 녹음·사진 목록과 내용을 읽는다.
 * drive.file: 이 앱이 만든 파일만 쓸 수 있다 (나중에 회의록·사진을 Drive에 올릴 때를 위해 처음 허용에 함께 받는다).
 */
export const GOOGLE_DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive.file'] as const;

/** 이것(또는 전체 drive 권한)이 없으면 폴더를 읽을 수 없다 */
const DRIVE_READ_SCOPES = ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive'];

/** 액세스 토큰이 이만큼 안에 만료되면 미리 갱신한다 (요청 중에 만료되지 않게) */
export const TOKEN_REFRESH_MARGIN_MS = 60_000;
/** 토큰 응답에 expires_in이 없을 때. Google 액세스 토큰은 보통 1시간이다 */
const DEFAULT_EXPIRES_IN_SEC = 3600;

export interface GoogleEndpoints {
  authorize: string;
  token: string;
  revoke: string;
  drive: string;
}

/**
 * 부를 때마다 읽는다. GOOGLE_API_TEST_ORIGIN은 테스트가 가짜 Google 서버로 바꿔 끼우는 값이라 NODE_ENV=test(Jest)일 때만 읽는다.
 * 개발·운영에서 잘못 넣어 둬도 토큰·client secret이 다른 주소로 가지 않는다.
 */
export function googleEndpoints(): GoogleEndpoints {
  const override = process.env.NODE_ENV === 'test' ? (process.env.GOOGLE_API_TEST_ORIGIN?.trim().replace(/\/+$/, '') ?? '') : '';
  if (override) {
    return { authorize: `${override}/o/oauth2/v2/auth`, token: `${override}/token`, revoke: `${override}/revoke`, drive: `${override}/drive/v3` };
  }
  return { authorize: GOOGLE_AUTHORIZE_URL, token: GOOGLE_TOKEN_URL, revoke: GOOGLE_REVOKE_URL, drive: GOOGLE_DRIVE_API_URL };
}

/** 관리자가 넣은 OAuth 클라이언트 (oauth_client_information 암호문 안의 모양) */
export interface GoogleClientCredentials {
  clientId?: string;
  clientSecret?: string;
}

/** oauth_tokens 암호문 안의 모양 */
export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  /** 액세스 토큰 만료 시각 (epoch ms) */
  expiresAt: number;
  /** 허용받은 권한 (공백으로 구분) */
  scope: string;
  /** 연결한 Google 계정 (Drive about.user.permissionId). 다시 연결할 때 다른 계정인지 가린다. 못 읽었으면 없다 */
  accountId?: string;
}

/** 토큰 응답을 읽을 수 없음. 문구는 화면에 보여도 되는 것만 담는다 (토큰 값 없음) */
export class GoogleTokenResponseError extends Error {}

/** Google Cloud Console의 웹 애플리케이션 클라이언트 id 모양 */
const CLIENT_ID_PATTERN = /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/;

export function isGoogleClientId(value: string): boolean {
  return value.length <= 200 && CLIENT_ID_PATTERN.test(value);
}

/** 설정 저장 전 client id·secret 확인. 문제가 없으면 null, 있으면 화면 문구 (null·빈 글은 비우기라 통과) */
export function clientInputError(input: { clientId?: string | null; clientSecret?: string | null }): string | null {
  if (input.clientId && !isGoogleClientId(input.clientId)) return 'OAuth 클라이언트 id는 Google Cloud Console의 "…apps.googleusercontent.com"으로 끝나는 값이에요';
  if (input.clientSecret && (input.clientSecret.length > 200 || /\s/.test(input.clientSecret))) {
    return 'client secret이 올바르지 않아요. Google Cloud Console에서 복사한 값을 그대로 붙여 넣어 주세요';
  }
  return null;
}

/** PKCE (S256). verifier는 32바이트 무작위 base64url(43자) */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: pkceChallenge(verifier) };
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * 관리자를 보낼 Google 허용 화면 주소.
 * access_type=offline + prompt=consent: 다시 연결할 때도 리프레시 토큰을 새로 받는다 (Google은 처음 허용에만 주는 일이 있다).
 */
export function buildAuthorizationUrl(
  authorizeEndpoint: string,
  input: { clientId: string; redirectUri: string; state: string; codeChallenge: string },
): string {
  const url = new URL(authorizeEndpoint);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_DRIVE_SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

function positiveSeconds(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 토큰 응답(인가 코드 교환·갱신)을 저장할 모양으로 읽는다.
 * 갱신 응답에는 보통 리프레시 토큰·권한이 없으므로 이전 값(previous)을 이어 쓴다. 리프레시 토큰이 끝내 없으면 거절한다
 * (회사 계정 하나로 오래 쓰는 연결이라 리프레시 토큰 없이는 1시간 뒤 끊긴다).
 */
export function parseTokenResponse(body: unknown, now: number, previous?: GoogleTokens): GoogleTokens {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new GoogleTokenResponseError('Google 토큰 응답을 읽을 수 없어요');
  const record = body as Record<string, unknown>;
  const accessToken = typeof record.access_token === 'string' ? record.access_token : '';
  if (!accessToken) throw new GoogleTokenResponseError('Google 토큰 응답에 액세스 토큰이 없어요');
  if (typeof record.token_type === 'string' && record.token_type.toLowerCase() !== 'bearer') {
    throw new GoogleTokenResponseError(`Google 토큰 종류가 Bearer가 아니에요 (${record.token_type.slice(0, 20)})`);
  }
  const refreshToken = (typeof record.refresh_token === 'string' && record.refresh_token) || previous?.refreshToken || '';
  if (!refreshToken) {
    throw new GoogleTokenResponseError('Google이 리프레시 토큰을 주지 않았어요. Google 계정 설정 > 보안 > 타사 액세스에서 이 앱을 지운 뒤 다시 연결해 주세요');
  }
  const expiresIn = positiveSeconds(record.expires_in) ?? DEFAULT_EXPIRES_IN_SEC;
  const scope = (typeof record.scope === 'string' && record.scope.trim()) || previous?.scope || '';
  const tokens: GoogleTokens = { accessToken, refreshToken, expiresAt: now + expiresIn * 1000, scope };
  // 갱신해도 같은 계정이다
  if (previous?.accountId) tokens.accountId = previous.accountId;
  return tokens;
}

/** 저장된 토큰이 쓸 수 있는 모양인지 (키가 같아도 옛 모양이면 다시 연결) */
export function isGoogleTokens(value: unknown): value is GoogleTokens {
  if (value === null || typeof value !== 'object') return false;
  const t = value as Record<string, unknown>;
  return typeof t.accessToken === 'string' && typeof t.refreshToken === 'string' && typeof t.expiresAt === 'number' && typeof t.scope === 'string';
}

/** 만료까지 여유(TOKEN_REFRESH_MARGIN_MS)가 있으면 그대로 쓴다 */
export function isAccessTokenFresh(tokens: GoogleTokens, now: number): boolean {
  return tokens.expiresAt - TOKEN_REFRESH_MARGIN_MS > now;
}

/** 허용 화면에서 Drive 권한을 빼고 허용했는지 (Google은 권한을 하나씩 고르게 한다) */
export function hasDriveReadScope(scope: string): boolean {
  const granted = scope.split(/\s+/);
  return DRIVE_READ_SCOPES.some((s) => granted.includes(s));
}

/** 토큰 요청 실패의 종류 */
export type GoogleTokenFailure =
  /** 리프레시 토큰·인가 코드가 거절됨 (취소·만료·이미 씀·PKCE 불일치) */
  | 'invalid_grant'
  /** client id·secret이 틀림 */
  | 'invalid_client'
  /** 잠깐 뒤 다시 하면 될 수 있음 (5xx·429) */
  | 'transient'
  | 'other';

export function classifyTokenFailure(status: number, body: unknown): { kind: GoogleTokenFailure; error: string | null } {
  const error = body !== null && typeof body === 'object' && typeof (body as Record<string, unknown>).error === 'string' ? ((body as Record<string, unknown>).error as string) : null;
  if (error === 'invalid_grant') return { kind: 'invalid_grant', error };
  if (error === 'invalid_client' || error === 'unauthorized_client') return { kind: 'invalid_client', error };
  if (status >= 500 || status === 429) return { kind: 'transient', error };
  return { kind: 'other', error };
}
