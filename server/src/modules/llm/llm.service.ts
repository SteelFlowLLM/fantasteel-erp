import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { LlmApiKeyInput, LlmApiKeyView, LlmBrowserSettingsInput, LlmBrowserSettingsView, LlmChatTestView, LlmConnectionTestInput, LlmConnectionView, LlmSettingsInput, LlmSettingsView } from '@fantasteel/shared';
import { effectiveStartSites } from '../ai-assistant/browser/browser-rules';
import { BrowserSettingsStore } from './browser-settings.store';
import { LlmClient, LlmRequestError, normalizeBaseUrl } from './llm.client';
import { LLM_PROFILE } from './llm-profiles';
import { cleanKeys, llmEndpointOf, llmKeyOrigin, LlmSettingsStore, type LlmSettings } from './llm-settings.store';

const CHAT_TEST_PROMPT = '연결 확인입니다. 한국어 한 문장으로 짧게 인사해 주세요.';

@Injectable()
export class LlmService {
  constructor(
    private readonly store: LlmSettingsStore,
    private readonly client: LlmClient,
    private readonly browserStore: BrowserSettingsStore,
  ) {}

  async getSettings(): Promise<LlmSettingsView> {
    return this.toView(await this.store.read());
  }

  async updateSettings(input: LlmSettingsInput): Promise<LlmSettingsView> {
    const current = await this.store.read();
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const apiKeys = resolveApiKeys(input.apiKeys, current, baseUrl);
    const next: LlmSettings = {
      baseUrl,
      model: input.model,
      apiKeys,
      apiKeysByOrigin: withOriginKeys(current.apiKeysByOrigin, baseUrl, apiKeys),
      visionSupport: input.visionSupport === undefined ? current.visionSupport : input.visionSupport,
      reasoningSupport: input.reasoningSupport === undefined ? current.reasoningSupport : input.reasoningSupport,
      contextLength: input.contextLength === undefined ? current.contextLength : input.contextLength,
    };
    await this.store.write(next);
    // 저장한 뒤 첫 요청이 Unsloth의 불러온 모델·생각 설정을 새로 읽게 한다 (모델을 바꾼 직후 다른 모델이 답하지 않게)
    this.client.forgetServerInfo();
    return this.toView(next);
  }

  async getBrowserSettings(): Promise<LlmBrowserSettingsView> {
    return toBrowserView(await this.browserStore.read());
  }

  async updateBrowserSettings(input: LlmBrowserSettingsInput): Promise<LlmBrowserSettingsView> {
    const next = { startSites: input.startSites === null ? null : [...new Set(input.startSites)], openAllSites: input.openAllSites };
    await this.browserStore.write(next);
    return toBrowserView(next);
  }

  /** 저장하기 전 주소로 연결을 확인하고 모델 목록을 받는다. 실패도 오류가 아니라 결과로 돌려준다 */
  async testConnection(input: LlmConnectionTestInput): Promise<LlmConnectionView> {
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const current = await this.store.read();
    const apiKeys = resolveApiKeys(input.apiKeys, current, baseUrl);
    const endpoint = { baseUrl, apiKey: apiKeys[0] ?? null, apiKeys };
    this.client.forgetServerInfo();
    const started = Date.now();
    try {
      const models = await this.client.listModels(endpoint);
      const latencyMs = Date.now() - started;
      const server = await this.client.serverSummary(endpoint);
      return { connected: true, baseUrl, latencyMs, models, error: null, serverKind: server.kind, autoSwitch: server.autoSwitch };
    } catch (error) {
      const message = messageOf(error);
      return { connected: false, baseUrl, latencyMs: null, models: [], error: message, serverKind: null, autoSwitch: null };
    }
  }

  /** 저장된 설정의 모델에 짧은 질문을 보내 실제로 답하는지 본다. Unsloth Studio에 고른 모델이 안 불러와져 있으면 부르기 전에 그 이유를 돌려준다 */
  async testChat(): Promise<LlmChatTestView> {
    const settings = await this.store.read();
    if (!settings.model) return { ok: false, model: null, reply: null, latencyMs: null, error: '모델을 먼저 골라 저장해 주세요' };
    const started = Date.now();
    try {
      const reply = await this.client.chat(llmEndpointOf(settings), settings.model, [{ role: 'user', content: CHAT_TEST_PROMPT }], LLM_PROFILE.CONNECTION_TEST);
      return { ok: true, model: settings.model, reply, latencyMs: Date.now() - started, error: null };
    } catch (error) {
      return { ok: false, model: settings.model, reply: null, latencyMs: null, error: messageOf(error) };
    }
  }

  private toView(settings: LlmSettings): LlmSettingsView {
    const keyView = (apiKey: string): LlmApiKeyView => {
      const usage = this.client.keyUsageOf(apiKey);
      return { id: apiKeyId(apiKey), hint: `…${apiKey.slice(-4)}`, state: usage?.state ?? null, usedAt: usage?.at.toISOString() ?? null };
    };
    return {
      baseUrl: settings.baseUrl,
      model: settings.model,
      hasApiKey: settings.apiKeys.length > 0,
      apiKeysByOrigin: Object.fromEntries(Object.entries(settings.apiKeysByOrigin).map(([origin, keys]) => [origin, keys.map(keyView)])),
      visionSupport: settings.visionSupport,
      reasoningSupport: settings.reasoningSupport,
      contextLength: settings.contextLength,
    };
  }
}

/**
 * 이 주소(출처)의 키 목록. 보내지 않으면 그 출처에 저장된 키를 그대로 쓴다.
 * 저장된 키는 같은 출처의 id로만 고를 수 있어, 한 서버에 넣은 키가 다른 서버로 가지 않는다
 */
function resolveApiKeys(input: LlmApiKeyInput[] | undefined, current: LlmSettings, baseUrl: string): string[] {
  const saved = current.apiKeysByOrigin[llmKeyOrigin(baseUrl)] ?? [];
  if (input === undefined) return saved;
  const byId = new Map(saved.map((key) => [apiKeyId(key), key]));
  return cleanKeys(input.map((k) => k.value ?? byId.get(k.id ?? '') ?? ''));
}

function withOriginKeys(byOrigin: Record<string, string[]>, baseUrl: string, apiKeys: string[]): Record<string, string[]> {
  const { [llmKeyOrigin(baseUrl)]: _old, ...rest } = byOrigin;
  return apiKeys.length ? { ...rest, [llmKeyOrigin(baseUrl)]: apiKeys } : rest;
}

/** 키 값 대신 화면과 주고받는 id. 해시 앞부분이라 키를 되살릴 수 없다 */
function apiKeyId(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
}

function toBrowserView(settings: { startSites: string[] | null; openAllSites: boolean }): LlmBrowserSettingsView {
  return { startSites: settings.startSites, effectiveStartSites: effectiveStartSites(settings.startSites), defaultStartSites: effectiveStartSites(null), openAllSites: settings.openAllSites };
}


function messageOf(error: unknown): string {
  if (error instanceof LlmRequestError) return error.message;
  throw error;
}
