import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  INTEGRATION_PROVIDER,
  type AuthUser,
  type IntegrationConnectResult,
  type IntegrationConnectionStatus,
  type IntegrationConnectionView,
  type IntegrationSettings,
  type IntegrationTestResult,
} from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import type { UpdateIntegrationSettingsDto, OAuthCallbackQuery } from './dto/integration.dto';
import { IntegrationConnectionRepository, type IntegrationConnectionRow } from './integration-connection.repository';
import { mcpServerUrlOf, providerPreset, providerPresets, type IntegrationProviderPreset } from './integration-providers';
import { readSettings } from './integration-settings';
import { IntegrationTokenStore } from './integration-token.store';
import { clientReturnUrl } from './integration-urls';
import { McpClientService } from './mcp/mcp.client';
import { normalizeNotionPageId } from './notion/notion.tools';

/** 관리자가 Notion 허용 화면에서 머무를 수 있는 시간 */
const OAUTH_STATE_TTL_MS = 10 * 60_000;

function statusOf(row: IntegrationConnectionRow | null): IntegrationConnectionStatus {
  if (row?.oauthTokens) return 'CONNECTED';
  return row?.connectedAt ? 'RECONNECT_REQUIRED' : 'NOT_CONNECTED';
}

function toView(preset: IntegrationProviderPreset, row: IntegrationConnectionRow | null): IntegrationConnectionView {
  const settings: IntegrationSettings = readSettings(row?.settings ?? null);
  return {
    providerKey: preset.key,
    displayName: preset.displayName,
    protocol: preset.protocol,
    serverUrl: preset.serverUrl,
    status: statusOf(row),
    connectedAt: row?.connectedAt?.toISOString() ?? null,
    connectedBy: row?.connectedBy ? { id: row.connectedBy.id, name: row.connectedBy.employeeName } : null,
    lastError: row?.lastError ?? null,
    settings: preset.key === INTEGRATION_PROVIDER.NOTION ? { parentPageId: settings.parentPageId ?? null } : settings,
  };
}

function messageOf(error: unknown): string {
  if (error instanceof AppException) return (error.getResponse() as { message: string }).message;
  return '연결을 마치지 못했어요';
}

/**
 * 외부 서비스 연결 관리 (문서에 없는 기능, 2026-10-16 이슈 #358). 회사 계정 하나로 연결하고 모든 사원이 함께 쓴다.
 * 작업 로그는 남기지 않는다: REQ-LOG-002 이벤트에 외부 연결이 없고, 공통 코드를 새로 만들지 않기로 했다.
 */
@Injectable()
export class IntegrationService {
  private readonly logger = new Logger(IntegrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: IntegrationConnectionRepository,
    private readonly store: IntegrationTokenStore,
    private readonly mcp: McpClientService,
  ) {}

  /** 연결할 수 있는 대상 전부. 아직 행이 없으면 연결하지 않은 상태로 보인다 */
  async list(): Promise<IntegrationConnectionView[]> {
    const rows = new Map((await this.repository.findAll(this.prisma)).map((row) => [row.providerKey, row]));
    return Object.values(providerPresets()).map((preset) => toView(preset, rows.get(preset.key) ?? null));
  }

  async get(providerKey: string): Promise<IntegrationConnectionView> {
    const preset = providerPreset(providerKey);
    return toView(preset, await this.repository.findByProviderKey(this.prisma, preset.key));
  }

  async updateSettings(providerKey: string, dto: UpdateIntegrationSettingsDto): Promise<IntegrationConnectionView> {
    const preset = providerPreset(providerKey);
    const row = await this.repository.ensure(this.prisma, preset.key, preset.serverUrl);
    const next: IntegrationSettings = { ...readSettings(row.settings) };
    if (preset.key === INTEGRATION_PROVIDER.NOTION && dto.parentPage !== undefined) {
      if (dto.parentPage === null || dto.parentPage === '') {
        next.parentPageId = null;
      } else {
        const pageId = normalizeNotionPageId(dto.parentPage);
        if (!pageId) throw new AppException('COM-004', 'Notion 페이지 주소나 id를 읽지 못했어요. 페이지에서 "링크 복사"한 주소를 붙여 넣어 주세요');
        next.parentPageId = pageId;
      }
    }
    return toView(preset, await this.repository.update(this.prisma, preset.key, { settings: next as Prisma.InputJsonObject }));
  }

  /**
   * 관리자가 연결을 시작한다. 콜백 확인값(state)을 저장하고 허용 화면 주소를 돌려준다.
   * 화면은 이 주소로 브라우저를 옮기고, 허용이 끝나면 OAuth 서버가 콜백으로 돌려보낸다.
   */
  async connect(user: AuthUser, providerKey: string): Promise<IntegrationConnectResult> {
    const preset = providerPreset(providerKey);
    const serverUrl = mcpServerUrlOf(preset);
    await this.repository.ensure(this.prisma, preset.key, serverUrl);
    const state = randomBytes(32).toString('base64url');
    await this.repository.update(this.prisma, preset.key, {
      serverUrl,
      oauthState: state,
      oauthStateExpiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
      connectedById: user.employeeId,
      lastError: null,
    });
    try {
      const url = await this.store.exclusive(preset.key, () => this.mcp.startAuthorization(preset.key, state));
      return { authorizationUrl: url.toString() };
    } catch (error) {
      await this.repository.update(this.prisma, preset.key, { oauthState: null, oauthStateExpiresAt: null, lastError: messageOf(error).slice(0, 500) });
      throw error;
    }
  }

  /**
   * OAuth 콜백 (로그인 쿠키 없이 브라우저가 들어올 수 있다). 저장해 둔 state로 연결을 찾고 한 번만 쓴다.
   * 로그인한 브라우저(쿠키가 SameSite=Lax라 이 GET에 함께 온다)면 연결을 시작한 관리자와 같은 사원이어야 한다.
   * 결과와 상관없이 화면으로 돌려보낼 주소를 돌려준다 (오류도 JSON이 아니라 화면 쿼리로 알린다).
   */
  async handleCallback(query: OAuthCallbackQuery, sessionEmployeeId: number | null): Promise<string> {
    const state = typeof query.state === 'string' ? query.state : '';
    const row = state ? await this.repository.findByState(this.prisma, state) : null;
    if (!row) return clientReturnUrl(null, 'error', '연결 요청을 찾을 수 없어요. 처음부터 다시 연결해 주세요');
    const providerKey = row.providerKey;
    const { count } = await this.repository.consumeState(this.prisma, providerKey, state);
    const fail = async (message: string) => {
      await this.store.clear(providerKey, 'verifier').catch(() => undefined);
      await this.store.recordError(providerKey, message).catch(() => undefined);
      return clientReturnUrl(providerKey, 'error', message);
    };
    if (count === 0) return clientReturnUrl(providerKey, 'error', '이미 처리한 연결 요청이에요. 처음부터 다시 연결해 주세요');
    if (sessionEmployeeId !== null && sessionEmployeeId !== row.connectedBy?.id) return fail('연결을 시작한 관리자와 지금 로그인한 사원이 달라요. 연결을 시작한 계정으로 다시 연결해 주세요');
    if (!row.oauthStateExpiresAt || row.oauthStateExpiresAt.getTime() < Date.now()) return fail('연결 요청이 만료됐어요. 처음부터 다시 연결해 주세요');
    if (typeof query.error === 'string' && query.error) {
      return fail(query.error === 'access_denied' ? '허용하지 않아 연결하지 않았어요' : `연결이 거절됐어요 (${query.error})`);
    }
    if (typeof query.code !== 'string' || !query.code) return fail('인가 코드가 없어요. 처음부터 다시 연결해 주세요');

    const code = query.code;
    try {
      // 토큰을 쓰는 호출이 끝난 뒤에 새 토큰을 넣는다: 그 호출의 갱신이 새 토큰을 덮어쓰지 않게
      await this.store.exclusive(providerKey, async () => {
        await this.mcp.finishAuthorization(providerKey, code);
        await this.repository.update(this.prisma, providerKey, { connectedAt: new Date(), lastError: null });
      });
    } catch (error) {
      if (!(error instanceof AppException)) this.logger.error(`${providerKey} 콜백 처리 실패`, error instanceof Error ? error.stack : undefined);
      return fail(messageOf(error));
    }
    return clientReturnUrl(providerKey, 'connected');
  }

  /**
   * 연결을 끊는다: 토큰·클라이언트 정보를 지운다. 설정(상위 페이지)은 남긴다.
   * Notion 쪽 허용까지 없애려면 Notion의 설정 > 연결에서 지운다 (MCP에는 토큰 취소 요청이 없다).
   */
  async disconnect(providerKey: string): Promise<IntegrationConnectionView> {
    const preset = providerPreset(providerKey);
    await this.repository.ensure(this.prisma, preset.key, preset.serverUrl);
    // 진행 중인 호출의 토큰 갱신이 끊은 뒤에 토큰을 되살리지 않게 그 호출이 끝난 뒤 지운다
    const row = await this.store.exclusive(preset.key, () => this.repository.update(this.prisma, preset.key, {
      oauthClientInformation: null,
      oauthTokens: null,
      oauthCodeVerifier: null,
      oauthState: null,
      oauthStateExpiresAt: null,
      connectedAt: null,
      connectedById: null,
      lastError: null,
    }));
    return toView(preset, row);
  }

  /** 저장된 토큰으로 붙어 도구 목록을 받는다. 실패도 오류가 아니라 결과로 돌려준다 */
  async test(providerKey: string): Promise<IntegrationTestResult> {
    const preset = providerPreset(providerKey);
    const started = Date.now();
    try {
      const tools = (await this.mcp.withSession(preset.key, (session) => session.listTools())).map((t) => t.name);
      return { ok: true, latencyMs: Date.now() - started, tools, missingTools: preset.requiredTools.filter((name) => !tools.includes(name)), error: null };
    } catch (error) {
      if (!(error instanceof AppException)) throw error;
      return { ok: false, latencyMs: null, tools: [], missingTools: [], error: messageOf(error) };
    }
  }
}
