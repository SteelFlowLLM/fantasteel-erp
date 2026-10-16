import { Injectable, Logger } from '@nestjs/common';
import { auth, UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { ErrorCode, McpError, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { AppException } from '../../../common/errors/app.exception';
import { mcpServerUrlOf, providerPreset } from '../integration-providers';
import { IntegrationTokenStore } from '../integration-token.store';
import { McpOAuthProvider, McpReconnectRequiredError } from './mcp-oauth.provider';

/** HTTP 요청 하나(발견·등록·토큰·MCP 메시지)의 상한. Notion 페이지 만들기도 보통 몇 초다 */
const HTTP_TIMEOUT_MS = 60_000;
/**
 * MCP 요청(도구 목록·도구 호출) 하나의 상한. SDK가 요청을 보낸 때부터 재므로 그 사이의 토큰 갱신·재전송도 이 안에 든다.
 * 회의록 내보내기의 잡기 만료(meeting-minutes.service.ts)는 이 값보다 넉넉히 길어야 한다.
 */
export const MCP_REQUEST_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = MCP_REQUEST_TIMEOUT_MS;
const CLIENT_INFO = { name: 'fantasteel-erp', version: '0.2.0' };

/** 도구 이름과 입력 스키마. 서버 코드가 직접 고른 도구만 부르고, LLM에게 목록을 넘기지 않는다 */
export type McpToolInfo = Pick<Tool, 'name' | 'description' | 'inputSchema'>;

export interface McpSession {
  listTools(): Promise<McpToolInfo[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
}

/**
 * 요청마다 시간 상한을 건다. 서버가 보내는 알림용 SSE 스트림(GET, text/event-stream만 받음)은 오래 열려 있는 것이 정상이라 빼고,
 * 세션을 닫을 때 SDK가 끊는다.
 */
function fetchWithTimeout(timeoutMs: number): FetchLike {
  return (url, init) => {
    const accept = new Headers(init?.headers).get('accept');
    if ((init?.method ?? 'GET') === 'GET' && accept === 'text/event-stream') return fetch(url, init);
    const timeout = AbortSignal.timeout(timeoutMs);
    return fetch(url, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  };
}

/** 서버가 토큰을 받지 않음 (갱신한 토큰도 401) */
function isRejectedToken(error: unknown): boolean {
  return error instanceof UnauthorizedError || (error instanceof StreamableHTTPError && error.code === 401);
}

/**
 * 도구 호출이 서버에서 실행되기 전에 거절된 오류인지. 인증 실패(요청이 거절됨)와 서버가 JSON-RPC 오류로 답한 것(시간 초과 제외)은 실행되지 않았다.
 * 그 밖(시간 초과·연결 끊김·5xx)은 서버가 이미 실행했는지 알 수 없다.
 */
export function isRejectedBeforeRun(error: unknown): boolean {
  if (error instanceof McpReconnectRequiredError || isRejectedToken(error)) return true;
  return error instanceof McpError && error.code !== ErrorCode.RequestTimeout;
}

/** 연결 자체의 문제라 last_error에 남길 오류인지. 업무 오류(VOC- 등)는 연결 상태가 아니다 */
function isConnectionError(error: AppException): boolean {
  return error.code.startsWith('INT-');
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') return `${HTTP_TIMEOUT_MS / 1000}초 안에 응답이 없어요`;
  return error instanceof Error ? error.message : String(error);
}

/**
 * 원격 MCP 서버 클라이언트 (Streamable HTTP + OAuth). 연결 대상마다 회사 계정 하나의 토큰을 DB에 암호화해 둔다.
 * 부를 때마다 연결을 열고 닫는다: 호출이 드물고(회의록 내보내기), 서버 여러 대에서 세션을 나눌 필요가 없다.
 */
@Injectable()
export class McpClientService {
  private readonly logger = new Logger(McpClientService.name);

  constructor(private readonly store: IntegrationTokenStore) {}

  /**
   * 관리자가 연결을 시작한다: OAuth 서버를 찾고(필요하면 클라이언트 동적 등록), code verifier를 저장한 뒤 허용 화면 주소를 돌려준다.
   * 지금 쓰는 토큰은 지우지 않는다: 허용이 끝나 새 토큰을 받을 때(finishAuthorization) 덮어쓴다.
   * 부르는 쪽이 store.exclusive 안에서 부른다.
   */
  async startAuthorization(providerKey: string, state: string): Promise<URL> {
    const serverUrl = mcpServerUrlOf(providerPreset(providerKey));
    const provider = new McpOAuthProvider(this.store, providerKey, { kind: 'interactive', state });
    try {
      await auth(provider, { serverUrl, fetchFn: fetchWithTimeout(HTTP_TIMEOUT_MS) });
    } catch (error) {
      if (error instanceof AppException) throw error;
      this.logger.warn(`${providerKey} 연결 시작 실패: ${messageOf(error)}`);
      throw new AppException('INT-004', `연결을 시작하지 못했어요: ${messageOf(error)}`);
    }
    if (!provider.authorizationUrl) throw new AppException('INT-004', 'OAuth 허용 화면 주소를 받지 못했어요');
    return provider.authorizationUrl;
  }

  /** 콜백에서 인가 코드를 토큰으로 바꿔 옛 토큰을 덮어쓴다. 실패하면 화면에 보일 문구로 던진다. 부르는 쪽이 store.exclusive 안에서 부른다 */
  async finishAuthorization(providerKey: string, authorizationCode: string): Promise<void> {
    const serverUrl = mcpServerUrlOf(providerPreset(providerKey));
    const provider = new McpOAuthProvider(this.store, providerKey, { kind: 'background' });
    try {
      const result = await auth(provider, { serverUrl, authorizationCode, fetchFn: fetchWithTimeout(HTTP_TIMEOUT_MS) });
      if (result !== 'AUTHORIZED') throw new AppException('INT-007');
    } catch (error) {
      if (error instanceof AppException) throw error;
      if (error instanceof McpReconnectRequiredError) throw new AppException('INT-007');
      this.logger.warn(`${providerKey} 토큰 교환 실패: ${messageOf(error)}`);
      throw new AppException('INT-004', `토큰을 받지 못했어요: ${messageOf(error)}`);
    } finally {
      await this.store.clear(providerKey, 'verifier');
    }
  }

  /**
   * 저장된 토큰으로 MCP 서버에 붙어 fn을 실행하고 닫는다. 같은 연결 대상의 토큰 작업과 한 줄로 선다(store.exclusive).
   * 액세스 토큰이 만료됐으면 SDK가 리프레시 토큰으로 갱신한다. 리프레시 토큰이 거절되면 SDK가 토큰을 지우고 INT-003(다시 연결 필요),
   * 갱신 요청이 일시적으로 실패하면 토큰을 그대로 두고 INT-004를 던진다. 연결 문제는 last_error에 남기고, 성공하면 지운다.
   */
  withSession<T>(providerKey: string, fn: (session: McpSession) => Promise<T>): Promise<T> {
    return this.store.exclusive(providerKey, () => this.runSession(providerKey, fn));
  }

  private async runSession<T>(providerKey: string, fn: (session: McpSession) => Promise<T>): Promise<T> {
    const preset = providerPreset(providerKey);
    const serverUrl = mcpServerUrlOf(preset);
    const state = await this.store.connectionState(providerKey);
    if (!state.hasTokens) {
      if (state.wasConnected) throw new AppException('INT-003', `${preset.displayName} 연결이 끊겼어요. 관리자가 다시 연결해 주세요`);
      throw new AppException('INT-002', `${preset.displayName}이(가) 연결되어 있지 않아요. 관리자가 먼저 연결해 주세요`);
    }

    const provider = new McpOAuthProvider(this.store, providerKey, { kind: 'background' });
    const transport = new StreamableHTTPClientTransport(new URL(serverUrl), { authProvider: provider, fetch: fetchWithTimeout(HTTP_TIMEOUT_MS) });
    const client = new Client(CLIENT_INFO);
    const limits = { timeout: REQUEST_TIMEOUT_MS, maxTotalTimeout: REQUEST_TIMEOUT_MS };
    const session: McpSession = {
      listTools: async () => {
        const tools: McpToolInfo[] = [];
        let cursor: string | undefined;
        do {
          const page = await client.listTools(cursor ? { cursor } : undefined, limits);
          tools.push(...page.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })));
          cursor = page.nextCursor;
        } while (cursor);
        return tools;
      },
      callTool: async (name, args) => (await client.callTool({ name, arguments: args }, undefined, limits)) as CallToolResult,
    };

    let result: T;
    try {
      await client.connect(transport, limits);
      result = await fn(session);
    } catch (error) {
      throw await this.toAppException(providerKey, preset.displayName, error);
    } finally {
      await client.close().catch(() => undefined);
    }
    // 결과(예: 만든 페이지 주소)를 받은 뒤에는 기록 실패로 결과를 잃지 않게 한다
    await this.store.recordError(providerKey, null).catch(() => undefined);
    return result;
  }

  /** 실패를 화면에 보일 오류로 바꾸고, 연결 문제면 last_error를 남긴다 */
  private async toAppException(providerKey: string, displayName: string, error: unknown): Promise<AppException> {
    let failure: AppException;
    if (error instanceof AppException) {
      failure = error;
    } else if (error instanceof McpReconnectRequiredError) {
      const tokens = await this.store.readTokens<OAuthTokens>(providerKey).catch(() => undefined);
      if (tokens?.refresh_token) {
        // SDK는 리프레시 토큰이 거절되면 토큰을 지운 뒤 여기 온다. 남아 있으면 갱신 요청이 일시적으로 실패한 것이라 토큰을 지키고 다시 시도하게 한다
        failure = new AppException('INT-004', `${displayName} 인증 토큰을 갱신하지 못했어요. 잠시 뒤 다시 시도해 주세요`);
      } else {
        // 리프레시 토큰이 없으면 새로 허용받는 수밖에 없다
        if (tokens) await this.store.clear(providerKey, 'tokens');
        failure = new AppException('INT-003', `${displayName} 인증이 만료됐거나 취소됐어요. 관리자가 다시 연결해 주세요`);
      }
    } else if (isRejectedToken(error)) {
      await this.store.clear(providerKey, 'tokens');
      failure = new AppException('INT-003', `${displayName} 인증이 만료됐거나 취소됐어요. 관리자가 다시 연결해 주세요`);
    } else {
      this.logger.warn(`${providerKey} MCP 요청 실패: ${messageOf(error)}`);
      failure = new AppException('INT-004', `${displayName} 서버 요청이 실패했어요: ${messageOf(error)}`.slice(0, 300));
    }
    if (isConnectionError(failure)) await this.store.recordError(providerKey, (failure.getResponse() as { message: string }).message).catch(() => undefined);
    return failure;
  }
}
