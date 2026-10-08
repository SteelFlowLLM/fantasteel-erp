import { MESSAGE_EMOTICONS, MESSAGE_EMOTICON_SETS } from '@fantasteel/shared';
import { describe, expect, it } from 'vitest';
import { EMOTICON_RECENT_MAX, emoticonRecentStorageKey, pushRecentEmoticon, readRecentEmoticons } from '@/features/messenger/lib/emoticonRecent';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

/** 읽기·쓰기 모두 막힌 저장소 (사생활 보호 모드·용량 초과) */
class ThrowingStorage extends MemoryStorage {
  getItem(): string | null {
    throw new Error('blocked');
  }
  setItem(): void {
    throw new Error('blocked');
  }
}

describe('이모티콘 목록 (18번·19번)', () => {
  it('키는 겹치지 않고 32자 이하(message.emoticon_key varchar(32)), steelman-로 시작하며 묶음은 모두 있는 묶음이다', () => {
    const keys = MESSAGE_EMOTICONS.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    const setKeys: readonly string[] = MESSAGE_EMOTICON_SETS.map((s) => s.key);
    for (const { key, set } of MESSAGE_EMOTICONS) {
      expect(key.length).toBeLessThanOrEqual(32);
      expect(key.startsWith('steelman-')).toBe(true);
      expect(setKeys).toContain(set);
    }
    expect(MESSAGE_EMOTICON_SETS.map((s) => [s.label, MESSAGE_EMOTICONS.filter((e) => e.set === s.key).length])).toEqual([
      ['철강맨 업무', 18],
      ['철강맨 일상', 19],
    ]);
  });
});

describe('최근 보낸 이모티콘 (19번)', () => {
  it('최근 것이 앞이고, 다시 보내면 앞으로 옮긴다. 사원마다 따로 둔다', () => {
    const storage = new MemoryStorage();
    expect(readRecentEmoticons(7, storage)).toEqual([]);
    pushRecentEmoticon(7, 'steelman-ok', storage);
    pushRecentEmoticon(7, 'steelman-yummy', storage);
    expect(pushRecentEmoticon(7, 'steelman-ok', storage)).toEqual(['steelman-ok', 'steelman-yummy']);
    expect(readRecentEmoticons(7, storage)).toEqual(['steelman-ok', 'steelman-yummy']);
    expect(readRecentEmoticons(8, storage)).toEqual([]);
    expect(storage.getItem(emoticonRecentStorageKey(7))).toBe(JSON.stringify(['steelman-ok', 'steelman-yummy']));
  });

  it(`${EMOTICON_RECENT_MAX}개까지만 두고 오래된 것부터 빠진다`, () => {
    const storage = new MemoryStorage();
    for (const { key } of MESSAGE_EMOTICONS.slice(0, EMOTICON_RECENT_MAX + 2)) pushRecentEmoticon(7, key, storage);
    const recent = readRecentEmoticons(7, storage);
    expect(recent).toHaveLength(EMOTICON_RECENT_MAX);
    expect(recent[0]).toBe(MESSAGE_EMOTICONS[EMOTICON_RECENT_MAX + 1].key);
    expect(recent).not.toContain(MESSAGE_EMOTICONS[0].key);
    expect(recent).not.toContain(MESSAGE_EMOTICONS[1].key);
  });

  it('읽을 때 모르는 키·겹친 키·문자열이 아닌 값은 버린다', () => {
    const storage = new MemoryStorage();
    storage.setItem(emoticonRecentStorageKey(7), JSON.stringify(['steelman-none', 'steelman-wow', 3, 'steelman-wow', null, 'steelman-off']));
    expect(readRecentEmoticons(7, storage)).toEqual(['steelman-wow', 'steelman-off']);
    expect(pushRecentEmoticon(7, 'steelman-cry', storage)).toEqual(['steelman-cry', 'steelman-wow', 'steelman-off']);
  });

  it('망가진 값·배열이 아닌 값·저장소가 없거나 막히면 빈 목록', () => {
    const storage = new MemoryStorage();
    storage.setItem(emoticonRecentStorageKey(7), '{망가진 값');
    expect(readRecentEmoticons(7, storage)).toEqual([]);
    storage.setItem(emoticonRecentStorageKey(7), JSON.stringify({ key: 'steelman-ok' }));
    expect(readRecentEmoticons(7, storage)).toEqual([]);
    expect(readRecentEmoticons(7, null)).toEqual([]);
    expect(pushRecentEmoticon(7, 'steelman-ok', null)).toEqual([]);
    const blocked = new ThrowingStorage();
    expect(readRecentEmoticons(7, blocked)).toEqual([]);
    expect(pushRecentEmoticon(7, 'steelman-ok', blocked)).toEqual([]);
  });
});
