import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
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

  /**
   * 임시 파일에 다 쓴 뒤 이름을 바꿔 끼운다. 같은 파일에 바로 쓰면 쓰는 도중 읽은 요청이 반쪽 JSON을 받아 오류가 난다 (#487).
   * 같은 폴더 안 rename은 한 번에 바뀐다
   */
  async write(settings: SttSettings): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    // 동시에 두 번 써도 임시 파일이 겹치지 않게 무작위 이름을 쓴다
    const temp = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(settings, null, 2), 'utf8');
    await rename(temp, this.file);
  }
}
