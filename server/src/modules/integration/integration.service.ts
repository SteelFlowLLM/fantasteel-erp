import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  INTEGRATION_PROVIDER,
  type AuthUser,
  type IntegrationConnectResult,
  type IntegrationConnectionStatus,
  type IntegrationConnectionView,
  type IntegrationOAuthClientView,
  type IntegrationSettings,
  type IntegrationTestResult,
} from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import type { UpdateIntegrationSettingsDto, OAuthCallbackQuery } from './dto/integration.dto';
import { IntegrationConnectionRepository, type IntegrationConnectionRow } from './integration-connection.repository';
import { IntegrationCrypto } from './integration-crypto';
import { isProviderKey, mcpServerUrlOf, providerPreset, providerPresets, type IntegrationProviderPreset } from './integration-providers';
import { readSettings } from './integration-settings';
import { IntegrationTokenStore } from './integration-token.store';
import { clientReturnUrl, oauthCallbackUrl } from './integration-urls';
import { GoogleDriveClient } from './google-drive/google-drive.client';
import { normalizeDriveFolderId } from './google-drive/google-drive.query';
import { GoogleDriveService } from './google-drive/google-drive.service';
import { clientInputError, type GoogleClientCredentials } from './google-drive/google-oauth';
import { McpClientService } from './mcp/mcp.client';
import { normalizeNotionPageId } from './notion/notion.tools';

/** 관리자가 허용 화면(Notion·Google)에서 머무를 수 있는 시간 */
const OAUTH_STATE_TTL_MS = 10 * 60_000;

function statusOf(row: IntegrationConnectionRow | null): IntegrationConnectionStatus {
  if (row?.oauthTokens) return 'CONNECTED';
  return row?.connectedAt ? 'RECONNECT_REQUIRED' : 'NOT_CONNECTED';
}

/** 연결 대상마다 쓰는 설정 칸만 보인다 */
function settingsView(preset: IntegrationProviderPreset, settings: IntegrationSettings): IntegrationSettings {
  if (preset.key === INTEGRATION_PROVIDER.NOTION) return { parentPageId: settings.parentPageId ?? null };
  if (preset.key === INTEGRATION_PROVIDER.GOOGLE_DRIVE) return { folderId: settings.folderId ?? null };
  return settings;
}

function toView(preset: IntegrationProviderPreset, row: IntegrationConnectionRow | null, oauthClient: IntegrationOAuthClientView | null): IntegrationConnectionView {
  return {
    providerKey: preset.key,
    displayName: preset.displayName,
    protocol: preset.protocol,
    serverUrl: preset.serverUrl,
    status: statusOf(row),
    connectedAt: row?.connectedAt?.toISOString() ?? null,
    connectedBy: row?.connectedBy ? { id: row.connectedBy.id, name: row.connectedBy.employeeName } : null,
    lastError: row?.lastError ?? null,
    settings: settingsView(preset, readSettings(row?.settings ?? null)),
    // 관리자가 OAuth 클라이언트에 등록할 주소. MCP는 동적 등록이 알아서 넣는다
    redirectUri: preset.protocol === 'OAUTH2' ? oauthCallbackUrl() : null,
    oauthClient,
  };
}

/** 이 연결 대상에 없는 설정 칸을 보냈는지 */
function foreignSettingFields(preset: IntegrationProviderPreset, dto: UpdateIntegrationSettingsDto): string[] {
  const allowed: Record<string, readonly (keyof UpdateIntegrationSettingsDto)[]> = {
    [INTEGRATION_PROVIDER.NOTION]: ['parentPage'],
    [INTEGRATION_PROVIDER.GOOGLE_DRIVE]: ['clientId', 'clientSecret', 'folder'],
  };
  const fields: (keyof UpdateIntegrationSettingsDto)[] = ['parentPage', 'clientId', 'clientSecret', 'folder'];
  return fields.filter((field) => dto[field] !== undefined && !(allowed[preset.key] ?? []).includes(field));
}

function messageOf(error: unknown): string {
  if (error instanceof AppException) return (error.getResponse() as { message: string }).message;
  return '연결을 마치지 못했어요';
}

/**
 * 외부 서비스 연결 관리 (문서에 없는 기능, 2026-10-16 이슈 #358·#361). 회사 계정 하나로 연결하고 모든 사원이 함께 쓴다.
 * Notion은 MCP(McpClientService), Google Drive는 REST API + OAuth 2.0(GoogleDriveClient)으로 프리셋의 protocol에 따라 나눈다.
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
    private readonly crypto: IntegrationCrypto,
    private readonly drive: GoogleDriveClient,
    private readonly driveService: GoogleDriveService,
  ) {}

  /**
   * OAUTH2 연결의 client id와 secret을 넣었는지. 목록은 비밀값을 담지 않으므로 secret은 있는지만 본다.
   * 키가 없거나 바뀌어 풀 수 없어도 목록은 보여야 하므로 그때는 넣지 않은 것으로 보인다 (설정 저장·연결이 INT-008·INT-003으로 알린다).
   */
  private oauthClientView(preset: IntegrationProviderPreset, row: IntegrationConnectionRow | null): IntegrationOAuthClientView | null {
    if (preset.protocol !== 'OAUTH2') return null;
    if (!row?.oauthClientInformation) return { clientId: null, clientSecretSet: false };
    try {
      const client = this.crypto.decryptJson<GoogleClientCredentials>(row.oauthClientInformation);
      return { clientId: client.clientId ?? null, clientSecretSet: Boolean(client.clientSecret) };
    } catch {
      return { clientId: null, clientSecretSet: false };
    }
  }

  private view(preset: IntegrationProviderPreset, row: IntegrationConnectionRow | null): IntegrationConnectionView {
    return toView(preset, row, this.oauthClientView(preset, row));
  }

  /** 연결할 수 있는 대상 전부. 아직 행이 없으면 연결하지 않은 상태로 보인다 */
  async list(): Promise<IntegrationConnectionView[]> {
    const rows = new Map((await this.repository.findAll(this.prisma)).map((row) => [row.providerKey, row]));
    return Object.values(providerPresets()).map((preset) => this.view(preset, rows.get(preset.key) ?? null));
  }

  async get(providerKey: string): Promise<IntegrationConnectionView> {
    const preset = providerPreset(providerKey);
    return this.view(preset, await this.repository.findByProviderKey(this.prisma, preset.key));
  }

  async updateSettings(providerKey: string, dto: UpdateIntegrationSettingsDto): Promise<IntegrationConnectionView> {
    const preset = providerPreset(providerKey);
    const foreign = foreignSettingFields(preset, dto);
    if (foreign.length > 0) throw new AppException('COM-004', `${preset.displayName} 연결에는 없는 설정이에요 (${foreign.join(', ')})`);
    // 값을 먼저 읽어 보고 행을 만든다: 잘못된 값으로 빈 행을 남기지 않게
    const pageId = dto.parentPage ? normalizeNotionPageId(dto.parentPage) : null;
    if (dto.parentPage && !pageId) throw new AppException('COM-004', 'Notion 페이지 주소나 id를 읽지 못했어요. 페이지에서 "링크 복사"한 주소를 붙여 넣어 주세요');
    const folderId = dto.folder ? normalizeDriveFolderId(dto.folder) : null;
    if (dto.folder && !folderId) throw new AppException('COM-004', 'Drive 폴더 주소나 id를 읽지 못했어요. Drive에서 폴더를 열고 주소창의 주소(…/drive/folders/…)를 붙여 넣어 주세요');
    const clientInvalid = clientInputError({ clientId: dto.clientId, clientSecret: dto.clientSecret });
    if (clientInvalid) throw new AppException('COM-004', clientInvalid);

    const row = await this.repository.ensure(this.prisma, preset.key, preset.serverUrl);
    const next: IntegrationSettings = { ...readSettings(row.settings) };
    if (dto.parentPage !== undefined) next.parentPageId = pageId;
    if (dto.folder !== undefined) next.folderId = folderId;
    if (dto.clientId !== undefined || dto.clientSecret !== undefined) await this.drive.updateClient({ clientId: dto.clientId, clientSecret: dto.clientSecret });
    return this.view(preset, await this.repository.update(this.prisma, preset.key, { settings: next as Prisma.InputJsonObject }));
  }

  /**
   * 관리자가 연결을 시작한다. 콜백 확인값(state)을 저장하고 허용 화면 주소를 돌려준다.
   * 화면은 이 주소로 브라우저를 옮기고, 허용이 끝나면 OAuth 서버가 콜백으로 돌려보낸다.
   */
  async connect(user: AuthUser, providerKey: string): Promise<IntegrationConnectResult> {
    const preset = providerPreset(providerKey);
    const serverUrl = preset.protocol === 'MCP' ? mcpServerUrlOf(preset) : null;
    await this.repository.ensure(this.prisma, preset.key, serverUrl);
    // 클라이언트를 넣지 않았으면 확인값을 쓰기 전에 알린다
    if (preset.protocol === 'OAUTH2') await this.drive.requireClient();
    const state = randomBytes(32).toString('base64url');
    await this.repository.update(this.prisma, preset.key, {
      serverUrl,
      oauthState: state,
      oauthStateExpiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
      connectedById: user.employeeId,
      lastError: null,
    });
    try {
      const url = await this.store.exclusive(preset.key, async () =>
        preset.protocol === 'MCP' ? (await this.mcp.startAuthorization(preset.key, state)).toString() : this.drive.startAuthorization(state),
      );
      return { authorizationUrl: url };
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
    if (!isProviderKey(providerKey)) return clientReturnUrl(null, 'error', '지원하지 않는 연결 대상이에요');
    const preset = providerPreset(providerKey);
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
        if (preset.protocol === 'MCP') await this.mcp.finishAuthorization(providerKey, code);
        else await this.drive.finishAuthorization(code);
        await this.repository.update(this.prisma, providerKey, { connectedAt: new Date(), lastError: null });
      });
    } catch (error) {
      if (!(error instanceof AppException)) this.logger.error(`${providerKey} 콜백 처리 실패`, error instanceof Error ? error.stack : undefined);
      return fail(messageOf(error));
    }
    return clientReturnUrl(providerKey, 'connected');
  }

  /**
   * 연결을 끊는다: 토큰·확인값을 지운다. 설정(상위 페이지·폴더)은 남긴다.
   * Notion: 동적 등록한 클라이언트 정보도 지운다. Notion 쪽 허용까지 없애려면 Notion의 설정 > 연결에서 지운다 (MCP에는 토큰 취소 요청이 없다).
   * Google Drive: Google에 허용 취소를 먼저 보내고(실패해도 넘어간다), 관리자가 넣은 client id·secret은 남긴다.
   */
  async disconnect(providerKey: string): Promise<IntegrationConnectionView> {
    const preset = providerPreset(providerKey);
    await this.repository.ensure(this.prisma, preset.key, preset.serverUrl);
    // 진행 중인 호출의 토큰 갱신이 끊은 뒤에 토큰을 되살리지 않게 그 호출이 끝난 뒤 지운다
    const row = await this.store.exclusive(preset.key, async () => {
      if (preset.protocol === 'OAUTH2') await this.drive.revoke();
      return this.repository.update(this.prisma, preset.key, {
        ...(preset.protocol === 'MCP' ? { oauthClientInformation: null } : {}),
        oauthTokens: null,
        oauthCodeVerifier: null,
        oauthState: null,
        oauthStateExpiresAt: null,
        connectedAt: null,
        connectedById: null,
        lastError: null,
      });
    });
    return this.view(preset, row);
  }

  /** MCP: 저장된 토큰으로 붙어 도구 목록을 받는다. Google Drive: 폴더와 그 안의 녹음·사진 수. 실패도 오류가 아니라 결과로 돌려준다 */
  async test(providerKey: string): Promise<IntegrationTestResult> {
    const preset = providerPreset(providerKey);
    if (preset.protocol === 'OAUTH2') return this.driveService.test();
    const started = Date.now();
    try {
      const tools = (await this.mcp.withSession(preset.key, (session) => session.listTools())).map((t) => t.name);
      return { ok: true, latencyMs: Date.now() - started, tools, missingTools: preset.requiredTools.filter((name) => !tools.includes(name)), error: null, driveFolder: null };
    } catch (error) {
      if (!(error instanceof AppException)) throw error;
      return { ok: false, latencyMs: null, tools: [], missingTools: [], error: messageOf(error), driveFolder: null };
    }
  }
}
