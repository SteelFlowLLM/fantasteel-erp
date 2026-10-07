import { Injectable } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { LLM_DEFAULT_BASE_URL } from '@fantasteel/shared';

export interface LlmSettings {
  baseUrl: string;
  model: string | null;
  apiKey: string | null;
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
    };
    const raw = await readFile(this.file, 'utf8').catch(() => null);
    if (raw === null) return defaults;
    const saved = JSON.parse(raw) as Partial<LlmSettings>;
    return {
      baseUrl: saved.baseUrl ?? defaults.baseUrl,
      model: saved.model === undefined ? defaults.model : saved.model,
      apiKey: saved.apiKey === undefined ? defaults.apiKey : saved.apiKey,
    };
  }

  async write(settings: LlmSettings): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(settings, null, 2), 'utf8');
  }
}
