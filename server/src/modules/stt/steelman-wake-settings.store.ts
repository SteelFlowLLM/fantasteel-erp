import { Injectable } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { STEELMAN_WAKE_SETTINGS_DEFAULT, type SteelmanWakeSettingsView } from '@fantasteel/shared';

/**
 * 철강맨 부르기 회사 설정 (이슈 #457). 음성·LLM 연결 설정과 같이 ERD에 설정 테이블이 없어 저장소 폴더(STORAGE_DIR)의 JSON 파일에 둔다.
 * 파일이 없거나 깨졌으면 기본값(부르기 켬, 말로 승인 끔). 말로 승인은 부르기가 꺼져 있으면 늘 꺼진 것으로 읽는다
 */
@Injectable()
export class SteelmanWakeSettingsStore {
  private readonly file = join(process.env.STORAGE_DIR ?? join(process.cwd(), 'storage'), 'settings', 'steelman-wake.json');

  async read(): Promise<SteelmanWakeSettingsView> {
    const raw = await readFile(this.file, 'utf8').catch(() => null);
    if (raw === null) return STEELMAN_WAKE_SETTINGS_DEFAULT;
    try {
      const saved = JSON.parse(raw) as Partial<SteelmanWakeSettingsView>;
      const enabled = typeof saved.enabled === 'boolean' ? saved.enabled : STEELMAN_WAKE_SETTINGS_DEFAULT.enabled;
      return { enabled, voiceApproval: enabled && saved.voiceApproval === true };
    } catch {
      return STEELMAN_WAKE_SETTINGS_DEFAULT;
    }
  }

  async write(settings: SteelmanWakeSettingsView): Promise<SteelmanWakeSettingsView> {
    const next = { enabled: settings.enabled, voiceApproval: settings.enabled && settings.voiceApproval };
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(next, null, 2), 'utf8');
    return next;
  }
}
