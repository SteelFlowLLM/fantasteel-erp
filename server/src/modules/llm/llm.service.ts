import { Injectable } from '@nestjs/common';
import type { LlmChatTestView, LlmConnectionTestInput, LlmConnectionView, LlmSettingsInput, LlmSettingsView } from '@fantasteel/shared';
import { LlmClient, LlmRequestError, normalizeBaseUrl } from './llm.client';
import { LlmSettingsStore, type LlmSettings } from './llm-settings.store';

const CHAT_TEST_PROMPT = '연결 확인입니다. 한국어 한 문장으로 짧게 인사해 주세요.';

@Injectable()
export class LlmService {
  constructor(
    private readonly store: LlmSettingsStore,
    private readonly client: LlmClient,
  ) {}

  async getSettings(): Promise<LlmSettingsView> {
    return toView(await this.store.read());
  }

  async updateSettings(input: LlmSettingsInput): Promise<LlmSettingsView> {
    const current = await this.store.read();
    const next: LlmSettings = {
      baseUrl: normalizeBaseUrl(input.baseUrl),
      model: input.model,
      apiKey: input.apiKey === undefined ? current.apiKey : input.apiKey || null,
    };
    await this.store.write(next);
    return toView(next);
  }

  /** 저장하기 전 주소로 연결을 확인하고 모델 목록을 받는다. 실패도 오류가 아니라 결과로 돌려준다 */
  async testConnection(input: LlmConnectionTestInput): Promise<LlmConnectionView> {
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const apiKey = input.apiKey === undefined ? (await this.store.read()).apiKey : input.apiKey || null;
    const started = Date.now();
    try {
      const models = await this.client.listModels({ baseUrl, apiKey });
      return { connected: true, baseUrl, latencyMs: Date.now() - started, models, error: null };
    } catch (error) {
      return { connected: false, baseUrl, latencyMs: null, models: [], error: messageOf(error) };
    }
  }

  /** 저장된 설정의 모델에 짧은 질문을 보내 실제로 답하는지 본다 */
  async testChat(): Promise<LlmChatTestView> {
    const settings = await this.store.read();
    if (!settings.model) return { ok: false, model: null, reply: null, latencyMs: null, error: '모델을 먼저 골라 저장해 주세요' };
    const started = Date.now();
    try {
      const reply = await this.client.chat(settings, settings.model, [{ role: 'user', content: CHAT_TEST_PROMPT }]);
      return { ok: true, model: settings.model, reply, latencyMs: Date.now() - started, error: null };
    } catch (error) {
      return { ok: false, model: settings.model, reply: null, latencyMs: null, error: messageOf(error) };
    }
  }
}

function toView(settings: LlmSettings): LlmSettingsView {
  return { baseUrl: settings.baseUrl, model: settings.model, hasApiKey: Boolean(settings.apiKey) };
}

function messageOf(error: unknown): string {
  if (error instanceof LlmRequestError) return error.message;
  throw error;
}
