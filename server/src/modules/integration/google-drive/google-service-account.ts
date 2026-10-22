import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sign } from 'node:crypto';
import { AppException } from '../../../common/errors/app.exception';
import { IntegrationFaultException } from '../integration-fault.rules';
import { loadServiceAccountConfig, serviceAccountSignature, type ServiceAccountConfig, type ServiceAccountKey } from './google-drive.env';
import { classifyTokenFailure, googleEndpoints, GoogleTokenResponseError, TOKEN_REFRESH_MARGIN_MS } from './google-oauth';

/** 서비스 계정은 폴더를 읽기만 한다 (OAuth 연결의 drive.file은 받지 않는다) */
export const SERVICE_ACCOUNT_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
export const JWT_BEARER_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
/** Google이 받는 assertion 유효 시간의 상한이 1시간이다 */
const ASSERTION_LIFETIME_SEC = 3600;
const DEFAULT_EXPIRES_IN_SEC = 3600;
const HTTP_TIMEOUT_MS = 60_000;

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/**
 * OAuth 2.0 JWT bearer assertion (RFC 7523, RS256). aud는 토큰을 요청할 주소다.
 * 키 파일의 token_uri는 쓰지 않는다: 요청은 고정된 Google 주소로만 보내고(googleEndpoints), aud는 그 주소와 같아야 하므로.
 */
export function buildServiceAccountAssertion(key: ServiceAccountKey, input: { audience: string; nowSec: number; scope?: string }): string {
  const iat = Math.floor(input.nowSec);
  const header = base64urlJson({ alg: 'RS256', typ: 'JWT' });
  const claims = base64urlJson({ iss: key.clientEmail, scope: input.scope ?? SERVICE_ACCOUNT_SCOPE, aud: input.audience, iat, exp: iat + ASSERTION_LIFETIME_SEC });
  const signingInput = `${header}.${claims}`;
  // RSA 키에 sha256을 주면 PKCS#1 v1.5 서명이라 RS256이다
  const signature = sign('sha256', Buffer.from(signingInput, 'utf8'), key.privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

export interface ServiceAccountToken {
  accessToken: string;
  /** epoch ms */
  expiresAt: number;
}

/** jwt-bearer 토큰 응답. 리프레시 토큰은 없다 (만료되면 assertion을 새로 만들어 받는다) */
export function parseServiceAccountTokenResponse(body: unknown, now: number): ServiceAccountToken {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new GoogleTokenResponseError('Google 토큰 응답을 읽을 수 없어요');
  const record = body as Record<string, unknown>;
  const accessToken = typeof record.access_token === 'string' ? record.access_token : '';
  if (!accessToken) throw new GoogleTokenResponseError('Google 토큰 응답에 액세스 토큰이 없어요');
  if (typeof record.token_type === 'string' && record.token_type.toLowerCase() !== 'bearer') {
    throw new GoogleTokenResponseError(`Google 토큰 종류가 Bearer가 아니에요 (${record.token_type.slice(0, 20)})`);
  }
  const raw = typeof record.expires_in === 'string' && record.expires_in.trim() !== '' ? Number(record.expires_in) : record.expires_in;
  const expiresIn = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_EXPIRES_IN_SEC;
  return { accessToken, expiresAt: now + expiresIn * 1000 };
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') return `${HTTP_TIMEOUT_MS / 1000}초 안에 응답이 없어요`;
  return error instanceof Error ? error.message : String(error);
}

/**
 * .env의 Google 서비스 계정으로 Drive 액세스 토큰을 받는다 (이슈 #395). 관리자 로그인·DB 토큰이 없어
 * 서버를 다시 띄우거나 DB를 비우거나 다른 PC에서 띄워도 다시 연결하지 않는다.
 * 토큰은 메모리에만 두고 만료 60초 전에 새로 받는다. 동시에 여러 요청이 와도 토큰 요청은 하나만 보낸다.
 */
@Injectable()
export class GoogleServiceAccount implements OnModuleInit {
  private readonly logger = new Logger(GoogleServiceAccount.name);
  /** 읽은 설정. .env 값이 바뀌면(테스트) 다시 읽는다. 읽지 못한 것은 기억하지 않는다: 파일을 고치면 재시작 없이 다시 읽게 */
  private loaded: { signature: string; config: ServiceAccountConfig } | null = null;
  private token: (ServiceAccountToken & { key: ServiceAccountKey }) | null = null;
  private inflight: { key: ServiceAccountKey; promise: Promise<string> } | null = null;

  onModuleInit(): void {
    const config = this.config();
    if (!config.configured) return;
    if (config.key) this.logger.log(`Google Drive를 서비스 계정 ${config.key.clientEmail}으로 읽어요`);
    else this.logger.warn(`Google 서비스 계정 설정을 읽지 못했어요: ${config.error}`);
  }

  config(): ServiceAccountConfig {
    const signature = serviceAccountSignature();
    if (this.loaded?.signature === signature) return this.loaded.config;
    const config = loadServiceAccountConfig();
    if (!config.configured || config.key) this.loaded = { signature, config };
    else this.loaded = null;
    return config;
  }

  /** 서비스 계정 키를 넣었는지 (읽을 수 있는지와 상관없이). 넣었으면 OAuth 연결보다 먼저다 */
  isActive(): boolean {
    return this.config().configured;
  }

  email(): string | null {
    const config = this.config();
    return config.configured && config.key ? config.key.clientEmail : null;
  }

  /** 키를 넣었는데 읽을 수 없으면 그 문구 */
  configError(): string | null {
    const config = this.config();
    return config.configured ? config.error : null;
  }

  /**
   * 쓸 수 있는 액세스 토큰. rejected를 주면(Drive가 그 토큰을 401로 거절함) 기억한 토큰이 그것일 때만 새로 받는다.
   * 실패는 AppException(INT-015 설정, INT-004 Google 요청)이다.
   */
  accessToken(rejected?: string): Promise<string> {
    const config = this.config();
    if (!config.configured) return Promise.reject(new AppException('INT-002'));
    if (!config.key) return Promise.reject(new AppException('INT-015', config.error));
    const key = config.key;
    const current = this.token?.key === key ? this.token : null;
    if (current && current.accessToken !== rejected && current.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) return Promise.resolve(current.accessToken);
    if (this.inflight?.key === key) return this.inflight.promise;
    const promise = this.requestToken(key)
      .then((token) => {
        this.token = { ...token, key };
        return token.accessToken;
      })
      .finally(() => {
        if (this.inflight?.promise === promise) this.inflight = null;
      });
    this.inflight = { key, promise };
    return promise;
  }

  /** 기억한 토큰을 버린다 (Drive가 새로 받은 토큰도 거절했을 때) */
  forget(accessToken: string): void {
    if (this.token?.accessToken === accessToken) this.token = null;
  }

  private async requestToken(key: ServiceAccountKey): Promise<ServiceAccountToken> {
    const endpoint = googleEndpoints().token;
    const assertion = buildServiceAccountAssertion(key, { audience: endpoint, nowSec: Date.now() / 1000 });
    let res: Response;
    let body: unknown = null;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ grant_type: JWT_BEARER_GRANT_TYPE, assertion }).toString(),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      body = await res.json().catch(() => null);
    } catch (error) {
      this.logger.warn(`Google 서비스 계정 토큰 요청 실패: ${messageOf(error)}`);
      throw new AppException('INT-004', `Google 서비스 계정 토큰을 받지 못했어요. 잠시 뒤 다시 시도해 주세요 (${messageOf(error)})`);
    }
    if (!res.ok) {
      const failure = classifyTokenFailure(res.status, body);
      this.logger.warn(`Google 서비스 계정 토큰 요청 실패 HTTP ${res.status}${failure.error ? ` ${failure.error}` : ''}`);
      if (failure.kind === 'invalid_grant' || failure.kind === 'invalid_client') {
        // 서버 관리자가 키를 고쳐야 하는 장애로 알린다 (이슈 #518)
        throw new IntegrationFaultException(
          'INT-004',
          `Google이 서비스 계정 키를 거절했어요 (${failure.error}). 키가 삭제·사용 중지됐거나 서버 시계가 맞지 않을 수 있어요. Cloud Console에서 키를 확인하고 필요하면 새 키를 .env에 넣어 주세요`,
          'CREDENTIAL_ERROR',
        );
      }
      if (failure.kind === 'transient') throw new AppException('INT-004', `Google 서비스 계정 토큰을 받지 못했어요. 잠시 뒤 다시 시도해 주세요 (HTTP ${res.status})`);
      throw new AppException('INT-004', `Google 서비스 계정 토큰을 받지 못했어요 (HTTP ${res.status}${failure.error ? `, ${failure.error}` : ''})`);
    }
    try {
      return parseServiceAccountTokenResponse(body, Date.now());
    } catch (error) {
      if (error instanceof GoogleTokenResponseError) throw new AppException('INT-004', error.message);
      throw error;
    }
  }
}
