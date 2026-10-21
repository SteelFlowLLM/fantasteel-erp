import { Injectable } from '@nestjs/common';
import type { LlmBrowserSettingsInput, LlmBrowserSettingsView, LlmChatTestView, LlmConnectionTestInput, LlmConnectionView, LlmSettingsInput, LlmSettingsView } from '@fantasteel/shared';
import { effectiveStartSites } from '../ai-assistant/browser/browser-rules';
import { BrowserSettingsStore } from './browser-settings.store';
import { sameOrigin } from '../stt/stt-url';
import { LlmClient, LlmRequestError, normalizeBaseUrl } from './llm.client';
import { LLM_PROFILE } from './llm-profiles';
import { llmEndpointOf, LlmSettingsStore, type LlmSettings } from './llm-settings.store';

const CHAT_TEST_PROMPT = '연결 확인입니다. 한국어 한 문장으로 짧게 인사해 주세요.';
/** 주소의 출처(scheme·호스트·포트)가 바뀌면 저장된 키를 새 주소로 보내지 않는다 (STT 설정과 같은 규칙) */
const KEY_NOT_SENT = '주소가 바뀌어 저장된 API 키를 보내지 않았어요. 새 주소의 API 키를 다시 넣어 주세요';

@Injectable()
export class LlmService {
  constructor(
    private readonly store: LlmSettingsStore,
    private readonly client: LlmClient,
    private readonly browserStore: BrowserSettingsStore,
  ) {}

  async getSettings(): Promise<LlmSettingsView> {
    return toView(await this.store.read());
  }

  async updateSettings(input: LlmSettingsInput): Promise<LlmSettingsView> {
    const current = await this.store.read();
    const next: LlmSettings = {
      baseUrl: normalizeBaseUrl(input.baseUrl),
      model: input.model,
      apiKey: resolveApiKey(input.apiKey, current, input.baseUrl),
      visionSupport: input.visionSupport === undefined ? current.visionSupport : input.visionSupport,
      reasoningSupport: input.reasoningSupport === undefined ? current.reasoningSupport : input.reasoningSupport,
      contextLength: input.contextLength === undefined ? current.contextLength : input.contextLength,
    };
    await this.store.write(next);
    // 저장한 뒤 첫 요청이 Unsloth의 불러온 모델·생각 설정을 새로 읽게 한다 (모델을 바꾼 직후 다른 모델이 답하지 않게)
    this.client.forgetServerInfo();
    return toView(next);
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
    const apiKey = resolveApiKey(input.apiKey, current, baseUrl);
    const keyWithheld = input.apiKey === undefined && Boolean(current.apiKey) && apiKey === null;
    this.client.forgetServerInfo();
    const started = Date.now();
    try {
      const models = await this.client.listModels({ baseUrl, apiKey });
      const latencyMs = Date.now() - started;
      const server = await this.client.serverSummary({ baseUrl, apiKey });
      return { connected: true, baseUrl, latencyMs, models, error: null, serverKind: server.kind, autoSwitch: server.autoSwitch };
    } catch (error) {
      const message = messageOf(error);
      return { connected: false, baseUrl, latencyMs: null, models: [], error: keyWithheld ? `${message}. ${KEY_NOT_SENT}` : message, serverKind: null, autoSwitch: null };
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
}

/** 키를 보내지 않으면 저장된 키를 쓰되, 주소의 출처가 바뀌었으면 쓰지 않는다. 빈 문자열이면 지운다 */
function resolveApiKey(inputKey: string | undefined, current: LlmSettings, baseUrl: string): string | null {
  if (inputKey !== undefined) return inputKey || null;
  return sameOrigin(normalizeBaseUrl(baseUrl), current.baseUrl) ? current.apiKey : null;
}

function toBrowserView(settings: { startSites: string[] | null; openAllSites: boolean }): LlmBrowserSettingsView {
  return { startSites: settings.startSites, effectiveStartSites: effectiveStartSites(settings.startSites), defaultStartSites: effectiveStartSites(null), openAllSites: settings.openAllSites };
}

function toView(settings: LlmSettings): LlmSettingsView {
  return { baseUrl: settings.baseUrl, model: settings.model, hasApiKey: Boolean(settings.apiKey), visionSupport: settings.visionSupport, reasoningSupport: settings.reasoningSupport, contextLength: settings.contextLength };
}

function messageOf(error: unknown): string {
  if (error instanceof LlmRequestError) return error.message;
  throw error;
}
