import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LLM_DEFAULT_BASE_URL } from '@fantasteel/shared';
import { writeFileAtomic } from '../../common/storage/write-file-atomic';
import type { LlmEndpoint } from './llm.client';

export interface LlmSettings {
  baseUrl: string;
  model: string | null;
  /** 지금 주소(출처)의 API 키. 앞의 키부터 쓰고 막히면 다음 키 (읽을 때 apiKeysByOrigin에서 꺼낸다) */
  apiKeys: string[];
  /** 서버(주소의 출처)마다 저장한 API 키. 주소를 바꿔도 그 서버의 키를 다시 쓰고, 다른 서버로는 보내지 않는다 */
  apiKeysByOrigin: Record<string, string[]>;
  /** 관리자가 정한 사진·생각 정도 지원 (LM Studio가 아닐 때만 쓴다, 이슈 #465). null이면 모름 */
  visionSupport: boolean | null;
  reasoningSupport: boolean | null;
  /** 관리자가 넣은 문맥 길이(토큰). 모델 정보가 없을 때만 쓴다. null이면 모름 */
  contextLength: number | null;
}

/** LLM을 부를 때 넘기는 연결 정보. 관리자가 정한 지원 여부도 함께 간다 */
export function llmEndpointOf(settings: LlmSettings): LlmEndpoint {
  const apiKeys = settings.apiKeys ?? [];
  return { baseUrl: settings.baseUrl, apiKey: apiKeys[0] ?? null, apiKeys, visionSupport: settings.visionSupport, reasoningSupport: settings.reasoningSupport, contextLength: settings.contextLength };
}

/** 키를 묶는 서버 단위. 주소가 잘못돼 출처를 못 구하면 주소 그대로 */
export function llmKeyOrigin(baseUrl: string): string {
  try {
    return new URL(baseUrl.trim()).origin;
  } catch {
    return baseUrl.trim();
  }
}

/** 파일에 쓰는 모양. 지금 주소의 키(apiKeys)는 apiKeysByOrigin에서 꺼내므로 따로 쓰지 않는다 */
type StoredLlmSettings = Omit<LlmSettings, 'apiKeys'> & { apiKey?: string | null };

/**
 * LLM 연결 설정 저장. ERD에 설정 테이블이 없어서 DB가 아니라 저장소 폴더(STORAGE_DIR)의 JSON 파일에 둔다.
 * 파일이 없으면 .env(LLM_BASE_URL·LLM_MODEL·LLM_API_KEY, 키는 쉼표로 여러 개) 값, 그것도 없으면 LM Studio 기본 주소를 쓴다.
 * 설정 테이블이 생기면 이 파일만 바꾼다.
 */
@Injectable()
export class LlmSettingsStore {
  private readonly file = join(process.env.STORAGE_DIR ?? join(process.cwd(), 'storage'), 'settings', 'llm.json');

  async read(): Promise<LlmSettings> {
    const envBaseUrl = process.env.LLM_BASE_URL || LLM_DEFAULT_BASE_URL;
    const envKeys = cleanKeys((process.env.LLM_API_KEY ?? '').split(','));
    const defaults: LlmSettings = {
      baseUrl: envBaseUrl,
      model: process.env.LLM_MODEL || null,
      apiKeys: envKeys,
      apiKeysByOrigin: envKeys.length ? { [llmKeyOrigin(envBaseUrl)]: envKeys } : {},
      visionSupport: null,
      reasoningSupport: null,
      contextLength: null,
    };
    const raw = await readFile(this.file, 'utf8').catch(() => null);
    if (raw === null) return defaults;
    const saved = JSON.parse(raw) as Partial<StoredLlmSettings>;
    const baseUrl = saved.baseUrl ?? defaults.baseUrl;
    const apiKeysByOrigin = keysByOriginOf(saved, baseUrl) ?? defaults.apiKeysByOrigin;
    return {
      baseUrl,
      model: saved.model === undefined ? defaults.model : saved.model,
      apiKeys: apiKeysByOrigin[llmKeyOrigin(baseUrl)] ?? [],
      apiKeysByOrigin,
      visionSupport: typeof saved.visionSupport === 'boolean' ? saved.visionSupport : null,
      reasoningSupport: typeof saved.reasoningSupport === 'boolean' ? saved.reasoningSupport : null,
      contextLength: typeof saved.contextLength === 'number' && Number.isInteger(saved.contextLength) && saved.contextLength > 0 ? saved.contextLength : null,
    };
  }

  /** 쓰는 도중 읽는 요청이 반쪽 JSON을 읽지 않게 통째로 바꿔 쓴다. API 키가 들어 있어 0600이다 (#497) */
  async write(settings: LlmSettings): Promise<void> {
    const { apiKeys: _active, ...stored } = settings;
    await writeFileAtomic(this.file, JSON.stringify(stored satisfies StoredLlmSettings, null, 2));
  }
}

/** 빈 칸·겹친 키를 뺀다 */
export function cleanKeys(keys: readonly string[]): string[] {
  return [...new Set(keys.map((k) => k.trim()).filter(Boolean))];
}

/** 저장된 서버별 키. 서버별 키가 없던 옛 파일은 apiKey 하나를 그 주소의 키로 읽는다. 둘 다 없으면 undefined(.env 값을 쓴다) */
function keysByOriginOf(saved: Partial<StoredLlmSettings>, baseUrl: string): Record<string, string[]> | undefined {
  if (saved.apiKeysByOrigin && typeof saved.apiKeysByOrigin === 'object') {
    const entries = Object.entries(saved.apiKeysByOrigin).map(([origin, keys]) => [origin, Array.isArray(keys) ? cleanKeys(keys.filter((k): k is string => typeof k === 'string')) : []] as const);
    return Object.fromEntries(entries.filter(([, keys]) => keys.length > 0));
  }
  if (saved.apiKey === undefined) return undefined;
  return saved.apiKey ? { [llmKeyOrigin(baseUrl)]: [saved.apiKey] } : {};
}
