import { Injectable, Logger } from '@nestjs/common';
import { auth, UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { AppException } from '../../../common/errors/app.exception';
import { mcpServerUrlOf, providerPreset } from '../integration-providers';
import { IntegrationTokenStore } from '../integration-token.store';
import { McpOAuthProvider, McpReconnectRequiredError } from './mcp-oauth.provider';

/** HTTP 요청 하나(발견·등록·토큰·MCP 메시지)의 상한. Notion 페이지 만들기도 보통 몇 초다 */
const HTTP_TIMEOUT_MS = 60_000;
/** MCP 요청(도구 목록·도구 호출) 하나의 상한 */
const REQUEST_TIMEOUT_MS = 60_000;
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

function isAuthFailure(error: unknown): boolean {
  if (error instanceof McpReconnectRequiredError || error instanceof UnauthorizedError) return true;
  return error instanceof StreamableHTTPError && error.code === 401;
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
  /** 같은 연결 대상의 호출을 한 줄로 세운다: 동시에 토큰을 갱신하면 한쪽의 리프레시 토큰이 무효가 될 수 있다 */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly store: IntegrationTokenStore) {}

  /**
   * 관리자가 연결을 시작한다: OAuth 서버를 찾고(필요하면 클라이언트 동적 등록), code verifier를 저장한 뒤 허용 화면 주소를 돌려준다.
   * 옛 토큰은 지운다: 다시 연결은 계정·워크스페이스를 바꾸려는 것일 수 있다.
   */
  async startAuthorization(providerKey: string, state: string): Promise<URL> {
    const serverUrl = mcpServerUrlOf(providerPreset(providerKey));
    await this.store.clear(providerKey, 'tokens');
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

  /** 콜백에서 인가 코드를 토큰으로 바꾼다. 실패하면 화면에 보일 문구로 던진다 */
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
   * 저장된 토큰으로 MCP 서버에 붙어 fn을 실행하고 닫는다. 토큰이 만료됐으면 SDK가 리프레시 토큰으로 갱신하고,
   * 갱신도 안 되면 토큰을 지우고 INT-003(다시 연결 필요)을 던진다. 결과에 따라 last_error를 남기거나 지운다.
   */
  withSession<T>(providerKey: string, fn: (session: McpSession) => Promise<T>): Promise<T> {
    const previous = this.queues.get(providerKey) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(() => this.runSession(providerKey, fn));
    const settled = run.catch(() => undefined);
    this.queues.set(providerKey, settled);
    void settled.then(() => {
      if (this.queues.get(providerKey) === settled) this.queues.delete(providerKey);
    });
    return run;
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
    const session: McpSession = {
      listTools: async () => {
        const tools: McpToolInfo[] = [];
        let cursor: string | undefined;
        do {
          const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: REQUEST_TIMEOUT_MS });
          tools.push(...page.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })));
          cursor = page.nextCursor;
        } while (cursor);
        return tools;
      },
      callTool: async (name, args) => (await client.callTool({ name, arguments: args }, undefined, { timeout: REQUEST_TIMEOUT_MS })) as CallToolResult,
    };

    try {
      await client.connect(transport, { timeout: REQUEST_TIMEOUT_MS });
      const result = await fn(session);
      await this.store.recordError(providerKey, null);
      return result;
    } catch (error) {
      if (isAuthFailure(error)) {
        await this.store.clear(providerKey, 'tokens');
        const message = `${preset.displayName} 인증이 만료됐거나 취소됐어요. 관리자가 다시 연결해 주세요`;
        await this.store.recordError(providerKey, message);
        throw new AppException('INT-003', message);
      }
      if (error instanceof AppException) {
        await this.store.recordError(providerKey, (error.getResponse() as { message: string }).message);
        throw error;
      }
      const message = `${preset.displayName} 서버 요청이 실패했어요: ${messageOf(error)}`;
      this.logger.warn(`${providerKey} MCP 요청 실패: ${messageOf(error)}`);
      await this.store.recordError(providerKey, message);
      throw new AppException('INT-004', message.slice(0, 300));
    } finally {
      await client.close().catch(() => undefined);
    }
  }
}
