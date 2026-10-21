import { Injectable } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { LLM_START_SITE_PATTERN } from '@fantasteel/shared';

export interface BrowserSettings {
  /** 관리자가 저장한 시작 사이트. 없으면 null (env·기본 목록) */
  startSites: string[] | null;
  openAllSites: boolean;
}

/**
 * 철강맨AI 브라우저의 시작 사이트·'모든 사이트 열기' 저장 (이슈 #430). LLM 연결 설정과 같이 ERD에 설정 테이블이 없어
 * 저장소 폴더(STORAGE_DIR)의 JSON 파일에 둔다.
 */
@Injectable()
export class BrowserSettingsStore {
  private readonly file = join(process.env.STORAGE_DIR ?? join(process.cwd(), 'storage'), 'settings', 'browser.json');

  async read(): Promise<BrowserSettings> {
    const raw = await readFile(this.file, 'utf8').catch(() => null);
    if (raw === null) return { startSites: null, openAllSites: false };
    try {
      const saved = JSON.parse(raw) as Partial<BrowserSettings>;
      // 손으로 고친 파일이 모양을 해쳐도 열 수 있는 주소를 넓히지 않게 검사에 맞는 호스트만 남긴다
      const startSites = Array.isArray(saved.startSites) ? saved.startSites.filter((host): host is string => typeof host === 'string' && LLM_START_SITE_PATTERN.test(host)) : null;
      return { startSites, openAllSites: saved.openAllSites === true };
    } catch {
      return { startSites: null, openAllSites: false };
    }
  }

  async write(settings: BrowserSettings): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(settings, null, 2), 'utf8');
  }
}
