import { Injectable } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { LLM_DEFAULT_BASE_URL } from '@fantasteel/shared';
import type { LlmEndpoint } from './llm.client';

export interface LlmSettings {
  baseUrl: string;
  model: string | null;
  apiKey: string | null;
  /** 관리자가 정한 사진·생각 정도 지원 (LM Studio가 아닐 때만 쓴다, 이슈 #465). null이면 모름 */
  visionSupport: boolean | null;
  reasoningSupport: boolean | null;
}

/** LLM을 부를 때 넘기는 연결 정보. 관리자가 정한 지원 여부도 함께 간다 */
export function llmEndpointOf(settings: LlmSettings): LlmEndpoint {
  return { baseUrl: settings.baseUrl, apiKey: settings.apiKey, visionSupport: settings.visionSupport, reasoningSupport: settings.reasoningSupport };
}

/**
 * LLM 연결 설정 저장. ERD에 설정 테이블이 없어서 DB가 아니라 저장소 폴더(STORAGE_DIR)의 JSON 파일에 둔다.
 * 파일이 없으면 .env(LLM_BASE_URL·LLM_MODEL·LLM_API_KEY) 값, 그것도 없으면 LM Studio 기본 주소를 쓴다.
 * 설정 테이블이 생기면 이 파일만 바꾼다.
 */
@Injectable()
export class LlmSettingsStore {
  private readonly file = join(process.env.STORAGE_DIR ?? join(process.cwd(), 'storage'), 'settings', 'llm.json');

  async read(): Promise<LlmSettings> {
    const defaults: LlmSettings = {
      baseUrl: process.env.LLM_BASE_URL || LLM_DEFAULT_BASE_URL,
      model: process.env.LLM_MODEL || null,
      apiKey: process.env.LLM_API_KEY || null,
      visionSupport: null,
      reasoningSupport: null,
    };
    const raw = await readFile(this.file, 'utf8').catch(() => null);
    if (raw === null) return defaults;
    const saved = JSON.parse(raw) as Partial<LlmSettings>;
    return {
      baseUrl: saved.baseUrl ?? defaults.baseUrl,
      model: saved.model === undefined ? defaults.model : saved.model,
      apiKey: saved.apiKey === undefined ? defaults.apiKey : saved.apiKey,
      visionSupport: typeof saved.visionSupport === 'boolean' ? saved.visionSupport : null,
      reasoningSupport: typeof saved.reasoningSupport === 'boolean' ? saved.reasoningSupport : null,
    };
  }

  async write(settings: LlmSettings): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(settings, null, 2), 'utf8');
  }
}
