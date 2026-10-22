import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_CHIP_PREFERENCE_KEYS, clearAiChipPreferences } from '@/lib/aiChipPreferences';
import { AI_DRIVE_KEY, readAiDrivePreference, writeAiDrivePreference } from '@/lib/aiDrive';
import { STEELMAN_WAKE_KEY } from '@/lib/steelmanWakePreference';

/** 브라우저 localStorage 흉내 (화면 테스트는 node 환경이라 window가 없다) */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('철강맨AI 칩 설정 지우기 (이슈 #532)', () => {
  it('Drive·웹 검색·브라우저·화면 조작·Notion·생각 정도 키가 모두 들어 있다', () => {
    expect([...AI_CHIP_PREFERENCE_KEYS].sort()).toEqual(
      ['fantasteel.ai-browser', 'fantasteel.ai-drive', 'fantasteel.ai-notion', 'fantasteel.ai-reasoning', 'fantasteel.ai-screen-control', 'fantasteel.ai-web-search'].sort(),
    );
  });

  it('칩 설정만 지우고 사원별로 저장하는 철강맨 부르기 설정과 다른 키는 남긴다', () => {
    const storage = fakeStorage({ ...Object.fromEntries(AI_CHIP_PREFERENCE_KEYS.map((key) => [key, 'true'])), [`${STEELMAN_WAKE_KEY}.7`]: '{"wake":true}', 'fantasteel.font-size': 'large' });
    clearAiChipPreferences(storage);
    expect([...storage.data.keys()].sort()).toEqual(['fantasteel.font-size', `${STEELMAN_WAKE_KEY}.7`]);
  });

  it('앞 사원이 켠 Drive 칩은 지운 뒤 다음 사원에게 꺼진 채로 읽힌다', () => {
    const storage = fakeStorage();
    vi.stubGlobal('window', { localStorage: storage });
    writeAiDrivePreference(true);
    expect(storage.getItem(AI_DRIVE_KEY)).toBe('true');
    expect(readAiDrivePreference()).toBe(true);
    clearAiChipPreferences();
    expect(readAiDrivePreference()).toBe(false);
  });

  it('localStorage를 쓸 수 없거나 지우다 던져도 오류 없이 넘어간다', () => {
    expect(() => clearAiChipPreferences(undefined)).not.toThrow();
    expect(() => clearAiChipPreferences({ removeItem: () => { throw new Error('막힘'); } })).not.toThrow();
    vi.stubGlobal('window', { get localStorage(): never { throw new Error('접근 막힘'); } });
    expect(() => clearAiChipPreferences()).not.toThrow();
  });
});
