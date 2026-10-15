import { Injectable } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { STT_DEFAULT_BASE_URL } from '@fantasteel/shared';

export interface SttSettings {
  baseUrl: string;
  model: string | null;
  apiKey: string | null;
}

/**
 * STT 연결 설정 저장. LLM 설정과 같은 이유로 DB가 아니라 저장소 폴더(STORAGE_DIR)의 JSON 파일에 둔다.
 * 파일이 없으면 .env(STT_BASE_URL·STT_MODEL·STT_API_KEY) 값, 그것도 없으면 whisper.cpp 기본 주소를 쓴다.
 */
@Injectable()
export class SttSettingsStore {
  private readonly file = join(process.env.STORAGE_DIR ?? join(process.cwd(), 'storage'), 'settings', 'stt.json');

  async read(): Promise<SttSettings> {
    const defaults: SttSettings = {
      baseUrl: process.env.STT_BASE_URL || STT_DEFAULT_BASE_URL,
      model: process.env.STT_MODEL || null,
      apiKey: process.env.STT_API_KEY || null,
    };
    const raw = await readFile(this.file, 'utf8').catch(() => null);
    if (raw === null) return defaults;
    const saved = JSON.parse(raw) as Partial<SttSettings>;
    return {
      baseUrl: saved.baseUrl ?? defaults.baseUrl,
      model: saved.model === undefined ? defaults.model : saved.model,
      apiKey: saved.apiKey === undefined ? defaults.apiKey : saved.apiKey,
    };
  }

  async write(settings: SttSettings): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(settings, null, 2), 'utf8');
  }
}
