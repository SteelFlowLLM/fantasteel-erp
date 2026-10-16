import { Injectable, Logger } from '@nestjs/common';
import { Readable, Transform, pipeline } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { INTEGRATION_PROVIDER } from '@fantasteel/shared';
import { AppException } from '../../../common/errors/app.exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { IntegrationConnectionRepository } from '../integration-connection.repository';
import { IntegrationTokenStore } from '../integration-token.store';
import { oauthCallbackUrl } from '../integration-urls';
import { readDriveFile, type DriveFileMeta } from './google-drive.query';
import {
  buildAuthorizationUrl,
  classifyTokenFailure,
  createPkcePair,
  GoogleTokenResponseError,
  googleEndpoints,
  hasDriveReadScope,
  isAccessTokenFresh,
  isGoogleClientId,
  isGoogleTokens,
  parseTokenResponse,
  type GoogleClientCredentials,
  type GoogleTokens,
} from './google-oauth';

const KEY = INTEGRATION_PROVIDER.GOOGLE_DRIVE;
/** 토큰 요청·Drive JSON 요청 하나의 상한, 내용 받기는 응답 머리가 올 때까지의 상한 */
const HTTP_TIMEOUT_MS = 60_000;
/** 끊기 때 Google 쪽 허용 취소는 덤이라 짧게 기다린다 */
const REVOKE_TIMEOUT_MS = 10_000;
/** 내용 받기: 다음 조각이 이 시간 안에 오지 않으면 끊는다 (큰 녹음은 전체 시간을 정할 수 없다) */
const MEDIA_IDLE_TIMEOUT_MS = 60_000;

const RECONNECT_MESSAGE = 'Google 인증이 만료됐거나 취소됐어요. 관리자가 다시 연결해 주세요';

function messageOf(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') return `${HTTP_TIMEOUT_MS / 1000}초 안에 응답이 없어요`;
  if (error instanceof Error && error.name === 'AbortError') return '요청이 중단됐어요';
  return error instanceof Error ? error.message : String(error);
}

function errorMessage(error: AppException): string {
  return (error.getResponse() as { message: string }).message;
}

/** 받은 바이트가 상한을 넘거나, 조각이 오래 오지 않으면 끊는다. 소비하는 쪽이 끊으면 Google 요청도 끊는다 */
function guardStream(source: Readable, maxBytes: number, abort: () => void): Readable {
  let received = 0;
  let timer: NodeJS.Timeout | undefined;
  const guard = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > maxBytes) {
        callback(new AppException('INT-014', `파일이 너무 커요 (최대 ${Math.floor(maxBytes / 1024 / 1024)}MB)`));
        return;
      }
      arm();
      callback(null, chunk);
    },
  });
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => guard.destroy(new AppException('INT-004', `Google Drive에서 ${MEDIA_IDLE_TIMEOUT_MS / 1000}초 동안 받은 내용이 없어 끊었어요`)), MEDIA_IDLE_TIMEOUT_MS);
  };
  arm();
  pipeline(source, guard, (error) => {
    clearTimeout(timer);
    if (error) abort();
  });
  guard.on('close', () => {
    clearTimeout(timer);
    // 다 받기 전에 소비하는 쪽(브라우저·전사 작업)이 끊었으면 Google 요청도 끊는다
    if (!guard.readableEnded) abort();
  });
  return guard;
}

/** 끝까지 읽어 한 덩어리로 (회의 음성 전사용) */
export async function readStreamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/**
 * Google Drive REST API v3 + OAuth 2.0 (이슈 #361). MCP를 쓰지 않는다: Google의 Drive MCP는 개발자 미리보기 등록이 필요하고
 * 동적 클라이언트 등록이 없으며 큰 파일을 받지 못한다. 회사 Google 계정 하나의 토큰을 DB에 암호화해 둔다(IntegrationTokenStore).
 * 고정된 Google 주소로만 요청한다 (googleEndpoints).
 *
 * 토큰 읽기·갱신·저장은 연결 대상 줄(store.exclusive) 안에서만 한다. Drive 요청 자체는 줄 밖에서 보낸다:
 * 큰 녹음을 받는 동안 다른 호출이 기다리지 않게 하려는 것이고, 토큰을 쓰는 작업이 겹치지 않으면 충분하다.
 */
@Injectable()
export class GoogleDriveClient {
  private readonly logger = new Logger(GoogleDriveClient.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: IntegrationConnectionRepository,
    private readonly store: IntegrationTokenStore,
  ) {}

  // ───────── 관리자가 넣은 OAuth 클라이언트 ─────────

  async readClient(): Promise<GoogleClientCredentials> {
    return (await this.store.readClientInformation<GoogleClientCredentials>(KEY)) ?? {};
  }

  async requireClient(): Promise<{ clientId: string; clientSecret: string }> {
    const client = await this.readClient();
    if (!client.clientId || !client.clientSecret) throw new AppException('INT-010');
    return { clientId: client.clientId, clientSecret: client.clientSecret };
  }

  /**
   * client id·secret을 저장한다 (보낸 칸만 바꾸고 null·빈 글은 지운다). 행은 부르는 쪽이 먼저 만든다.
   * client id가 바뀌면 옛 클라이언트로 받은 리프레시 토큰은 새 클라이언트로 갱신할 수 없어 토큰을 지운다 (연결했었다면 다시 연결 필요).
   */
  updateClient(input: { clientId?: string | null; clientSecret?: string | null }): Promise<void> {
    if (input.clientId && !isGoogleClientId(input.clientId)) {
      throw new AppException('COM-004', 'OAuth 클라이언트 id는 Google Cloud Console의 "…apps.googleusercontent.com"으로 끝나는 값이에요');
    }
    if (input.clientSecret && (input.clientSecret.length > 200 || /\s/.test(input.clientSecret))) {
      throw new AppException('COM-004', 'client secret이 올바르지 않아요. Google Cloud Console에서 복사한 값을 그대로 붙여 넣어 주세요');
    }
    return this.store.exclusive(KEY, async () => {
      // 키가 바뀌어 옛 값을 풀 수 없으면 새로 넣는 값으로 덮어쓴다
      const current = await this.readClient().catch((error: unknown) => {
        if (error instanceof AppException && error.code === 'INT-003') return {} as GoogleClientCredentials;
        throw error;
      });
      const next: GoogleClientCredentials = { ...current };
      if (input.clientId !== undefined) next.clientId = input.clientId || undefined;
      if (input.clientSecret !== undefined) next.clientSecret = input.clientSecret || undefined;
      if (next.clientId || next.clientSecret) await this.store.saveClientInformation(KEY, next);
      else await this.store.clear(KEY, 'client');
      if ((current.clientId ?? null) !== (next.clientId ?? null)) await this.store.clear(KEY, 'tokens');
    });
  }

  // ───────── OAuth 연결 (부르는 쪽이 store.exclusive 안에서 부른다) ─────────

  /** PKCE verifier를 저장하고 Google 허용 화면 주소를 돌려준다. 지금 쓰는 토큰은 새 토큰을 받을 때까지 그대로 둔다 */
  async startAuthorization(state: string): Promise<string> {
    const client = await this.requireClient();
    const { verifier, challenge } = createPkcePair();
    await this.store.saveCodeVerifier(KEY, verifier);
    return buildAuthorizationUrl(googleEndpoints().authorize, { clientId: client.clientId, redirectUri: oauthCallbackUrl(), state, codeChallenge: challenge });
  }

  /** 콜백에서 인가 코드를 토큰으로 바꿔 옛 토큰을 덮어쓴다. 실패하면 화면에 보일 문구로 던진다 */
  async finishAuthorization(code: string): Promise<void> {
    try {
      const client = await this.requireClient();
      const verifier = await this.store.readCodeVerifier(KEY);
      if (!verifier) throw new AppException('INT-007');
      let response: { status: number; ok: boolean; body: unknown };
      try {
        response = await this.postToken({
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          redirect_uri: oauthCallbackUrl(),
          client_id: client.clientId,
          client_secret: client.clientSecret,
        });
      } catch (error) {
        this.logger.warn(`Google 토큰 교환 실패: ${messageOf(error)}`);
        throw new AppException('INT-004', `Google 토큰을 받지 못했어요: ${messageOf(error)}`);
      }
      if (!response.ok) {
        const failure = classifyTokenFailure(response.status, response.body);
        if (failure.kind === 'invalid_grant') throw new AppException('INT-007', '인가 코드가 만료됐거나 올바르지 않아요. 처음부터 다시 연결해 주세요');
        if (failure.kind === 'invalid_client') throw new AppException('INT-004', 'Google이 OAuth 클라이언트를 거절했어요. 연결 설정의 client id·secret을 확인해 주세요');
        throw new AppException('INT-004', `Google 토큰을 받지 못했어요 (HTTP ${response.status}${failure.error ? `, ${failure.error}` : ''})`);
      }
      let tokens: GoogleTokens;
      try {
        tokens = parseTokenResponse(response.body, Date.now());
      } catch (error) {
        if (error instanceof GoogleTokenResponseError) throw new AppException('INT-004', error.message);
        throw error;
      }
      if (!hasDriveReadScope(tokens.scope)) {
        throw new AppException('INT-007', 'Google Drive 읽기 권한을 허용하지 않았어요. 다시 연결하면서 Drive 권한을 모두 허용해 주세요');
      }
      await this.store.saveTokens(KEY, tokens);
    } finally {
      await this.store.clear(KEY, 'verifier');
    }
  }

  /** 끊기 전에 Google 쪽 허용을 취소한다. 실패해도 넘어간다 (우리 쪽 토큰은 부르는 쪽이 지운다). 부르는 쪽이 store.exclusive 안에서 부른다 */
  async revoke(): Promise<void> {
    const stored = await this.store.readTokens<unknown>(KEY).catch(() => undefined);
    if (!isGoogleTokens(stored)) return;
    try {
      // 리프레시 토큰을 취소하면 그 허용으로 받은 토큰이 모두 무효가 된다
      const res = await fetch(googleEndpoints().revoke, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: stored.refreshToken }).toString(),
        signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
      });
      if (!res.ok) this.logger.warn(`Google 허용 취소 응답 HTTP ${res.status}`);
    } catch (error) {
      this.logger.warn(`Google 허용 취소 실패: ${messageOf(error)}`);
    }
  }

  // ───────── Drive API ─────────

  /** 파일·폴더 메타데이터. 없거나 볼 수 없으면 INT-012 */
  async getFile(fileId: string, fields: string): Promise<DriveFileMeta> {
    const res = await this.driveGet(`/files/${encodeURIComponent(fileId)}`, { fields, supportsAllDrives: 'true' }, AbortSignal.timeout(HTTP_TIMEOUT_MS));
    const meta = readDriveFile(await this.readJson(res));
    if (!meta) throw await this.fail(new AppException('INT-004', 'Google Drive 응답을 읽을 수 없어요'));
    return meta;
  }

  async listFiles(input: { q: string; fields: string; pageSize: number; orderBy?: string; pageToken?: string }): Promise<{ files: DriveFileMeta[]; nextPageToken: string | null }> {
    const params: Record<string, string> = {
      q: input.q,
      fields: input.fields,
      pageSize: String(input.pageSize),
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    };
    if (input.orderBy) params.orderBy = input.orderBy;
    if (input.pageToken) params.pageToken = input.pageToken;
    const res = await this.driveGet('/files', params, AbortSignal.timeout(HTTP_TIMEOUT_MS));
    const body = await this.readJson(res);
    const record = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const files = Array.isArray(record.files) ? record.files.map(readDriveFile).filter((f): f is DriveFileMeta => f !== null) : [];
    return { files, nextPageToken: typeof record.nextPageToken === 'string' && record.nextPageToken ? record.nextPageToken : null };
  }

  /**
   * 파일 내용을 스트림으로 연다. maxBytes를 넘거나 조각이 오래 오지 않으면 스트림이 오류로 끝난다.
   * signal이 끊기면(브라우저가 떠남) Google 요청도 끊는다.
   */
  async openMedia(fileId: string, maxBytes: number, signal?: AbortSignal): Promise<Readable> {
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const headerTimer = setTimeout(() => controller.abort(new DOMException(`${HTTP_TIMEOUT_MS / 1000}초 안에 응답이 없어요`, 'TimeoutError')), HTTP_TIMEOUT_MS);
    let res: Response;
    try {
      // 압축을 받지 않는다: 크기 상한·Content-Length를 실제 바이트로 맞춘다
      res = await this.driveGet(`/files/${encodeURIComponent(fileId)}`, { alt: 'media', supportsAllDrives: 'true' }, controller.signal, { 'accept-encoding': 'identity' });
    } catch (error) {
      signal?.removeEventListener('abort', onAbort);
      throw error;
    } finally {
      clearTimeout(headerTimer);
    }
    const length = Number(res.headers.get('content-length') ?? NaN);
    if (Number.isFinite(length) && length > maxBytes) {
      controller.abort();
      throw new AppException('INT-014', `파일이 너무 커요 (최대 ${Math.floor(maxBytes / 1024 / 1024)}MB)`);
    }
    const source = res.body ? Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>) : Readable.from([]);
    const stream = guardStream(source, maxBytes, () => controller.abort());
    stream.on('close', () => signal?.removeEventListener('abort', onAbort));
    return stream;
  }

  // ───────── 안쪽 ─────────

  private async postToken(params: Record<string, string>): Promise<{ status: number; ok: boolean; body: unknown }> {
    const res = await fetch(googleEndpoints().token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: res.status, ok: res.ok, body };
  }

  /**
   * 쓸 수 있는 액세스 토큰. 만료가 가까우면 갱신한다.
   * rejected를 주면(Drive가 그 토큰을 401로 거절함) 아직 그 토큰이 저장돼 있을 때만 갱신한다: 줄을 기다리는 사이 다른 호출이 이미 갱신했으면 그 토큰을 쓴다.
   */
  private accessToken(rejected?: string): Promise<string> {
    return this.store.exclusive(KEY, async () => {
      const stored = await this.store.readTokens<unknown>(KEY);
      if (!isGoogleTokens(stored)) {
        if (stored !== undefined) {
          await this.store.clear(KEY, 'tokens');
          throw await this.fail(new AppException('INT-003', RECONNECT_MESSAGE));
        }
        const state = await this.store.connectionState(KEY);
        if (state.wasConnected) throw new AppException('INT-003', 'Google Drive 연결이 끊겼어요. 관리자가 다시 연결해 주세요');
        throw new AppException('INT-002', 'Google Drive가 연결되어 있지 않아요. 관리자가 먼저 연결해 주세요');
      }
      const stale = rejected !== undefined ? stored.accessToken === rejected : !isAccessTokenFresh(stored, Date.now());
      if (!stale) return stored.accessToken;
      return (await this.refresh(stored)).accessToken;
    });
  }

  /**
   * 리프레시 토큰으로 갱신한다. 거절(invalid_grant: 취소·만료, External+Testing 앱은 7일)이면 토큰을 지워 다시 연결하게 하고(INT-003),
   * 시간 초과·연결 끊김·5xx는 토큰을 남기고 INT-004 (다음 호출이 남은 리프레시 토큰으로 이어 간다). store.exclusive 안에서만 부른다.
   */
  private async refresh(tokens: GoogleTokens): Promise<GoogleTokens> {
    const client = await this.requireClient();
    let response: { status: number; ok: boolean; body: unknown };
    try {
      response = await this.postToken({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken, client_id: client.clientId, client_secret: client.clientSecret });
    } catch (error) {
      this.logger.warn(`Google 토큰 갱신 실패(일시): ${messageOf(error)}`);
      throw await this.fail(new AppException('INT-004', `Google 인증 토큰을 갱신하지 못했어요. 잠시 뒤 다시 시도해 주세요 (${messageOf(error)})`));
    }
    if (!response.ok) {
      const failure = classifyTokenFailure(response.status, response.body);
      if (failure.kind === 'invalid_grant') {
        await this.store.clear(KEY, 'tokens');
        throw await this.fail(new AppException('INT-003', RECONNECT_MESSAGE));
      }
      if (failure.kind === 'invalid_client') {
        throw await this.fail(new AppException('INT-004', 'Google이 OAuth 클라이언트를 거절했어요. 연결 설정의 client id·secret을 확인해 주세요'));
      }
      this.logger.warn(`Google 토큰 갱신 실패 HTTP ${response.status}`);
      throw await this.fail(new AppException('INT-004', `Google 인증 토큰을 갱신하지 못했어요. 잠시 뒤 다시 시도해 주세요 (HTTP ${response.status})`));
    }
    let next: GoogleTokens;
    try {
      next = parseTokenResponse(response.body, Date.now(), tokens);
    } catch (error) {
      if (error instanceof GoogleTokenResponseError) throw await this.fail(new AppException('INT-004', error.message));
      throw error;
    }
    await this.store.saveTokens(KEY, next);
    return next;
  }

  /** Drive API GET. 액세스 토큰이 거절되면(401) 한 번 갱신해 다시 보낸다. 2xx가 아니면 AppException */
  private async driveGet(path: string, params: Record<string, string>, signal: AbortSignal, headers: Record<string, string> = {}): Promise<Response> {
    const url = new URL(`${googleEndpoints().drive}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const send = async (token: string): Promise<Response> => {
      try {
        return await fetch(url, { headers: { ...headers, authorization: `Bearer ${token}` }, signal });
      } catch (error) {
        this.logger.warn(`Google Drive 요청 실패: ${messageOf(error)}`);
        throw await this.fail(new AppException('INT-004', `Google Drive 요청이 실패했어요: ${messageOf(error)}`));
      }
    };
    let token = await this.accessToken();
    let res = await send(token);
    if (res.status === 401) {
      await res.body?.cancel().catch(() => undefined);
      token = await this.accessToken(token);
      res = await send(token);
      if (res.status === 401) {
        await res.body?.cancel().catch(() => undefined);
        // 갱신한 토큰도 거절됨: 그 사이 새로 연결해 바뀐 토큰은 지우지 않는다
        await this.store.exclusive(KEY, async () => {
          const stored = await this.store.readTokens<unknown>(KEY).catch(() => undefined);
          if (isGoogleTokens(stored) && stored.accessToken === token) await this.store.clear(KEY, 'tokens');
        });
        throw await this.fail(new AppException('INT-003', RECONNECT_MESSAGE));
      }
    }
    if (!res.ok) throw await this.driveError(res);
    await this.repository.clearLastError(this.prisma, KEY).catch(() => undefined);
    return res;
  }

  private async readJson(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch (error) {
      throw await this.fail(new AppException('INT-004', `Google Drive 응답을 읽을 수 없어요: ${messageOf(error)}`));
    }
  }

  private async driveError(res: Response): Promise<AppException> {
    const body = (await res.json().catch(() => null)) as { error?: { message?: unknown; errors?: { reason?: unknown }[] } } | null;
    const reason = typeof body?.error?.errors?.[0]?.reason === 'string' ? body.error.errors[0].reason : '';
    const detail = typeof body?.error?.message === 'string' ? body.error.message.slice(0, 200) : `HTTP ${res.status}`;
    // 없는 파일·볼 수 없는 파일은 연결 문제가 아니다
    if (res.status === 404) return new AppException('INT-012');
    if (reason === 'accessNotConfigured' || /SERVICE_DISABLED|has not been used|is disabled/i.test(detail)) {
      return this.fail(new AppException('INT-004', 'Google Cloud 프로젝트에서 Google Drive API가 꺼져 있어요. Cloud Console의 API 및 서비스에서 Google Drive API를 사용 설정해 주세요'));
    }
    if (reason === 'insufficientPermissions' || reason === 'insufficientFilePermissions') {
      return this.fail(new AppException('INT-004', 'Google Drive 권한이 부족해요. 관리자가 다시 연결하면서 Drive 권한을 모두 허용해 주세요'));
    }
    if (res.status === 429 || /rateLimitExceeded/i.test(reason)) {
      return this.fail(new AppException('INT-004', 'Google Drive 요청이 너무 많아요. 잠시 뒤 다시 시도해 주세요'));
    }
    this.logger.warn(`Google Drive 요청 실패 HTTP ${res.status} ${reason}`);
    return this.fail(new AppException('INT-004', `Google Drive 요청이 실패했어요 (${detail})`.slice(0, 300)));
  }

  /** 연결 문제(INT-003·INT-004)는 last_error에 남긴다. 비밀값은 문구에 없다 */
  private async fail(error: AppException): Promise<AppException> {
    if (error.code === 'INT-003' || error.code === 'INT-004') await this.store.recordError(KEY, errorMessage(error)).catch(() => undefined);
    return error;
  }
}
