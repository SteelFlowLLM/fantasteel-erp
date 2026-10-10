import { MESSAGE_EMOTICONS } from '@fantasteel/shared';
import { describe, expect, it } from 'vitest';
import { EMOTICON_FAVORITE_MAX, emoticonFavoriteStorageKey, readFavoriteEmoticons, toggleFavoriteEmoticon } from '@/features/messenger/lib/emoticonFavorite';

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

/** 쓰기만 막힌 저장소 (용량 초과) */
class FullStorage extends MemoryStorage {
  setItem(): void {
    throw new Error('quota');
  }
}

describe('즐겨찾는 이모티콘 (23번)', () => {
  it('누르면 맨 뒤에 더하고 다시 누르면 뺀다. 사원마다 따로 둔다', () => {
    const storage = new MemoryStorage();
    expect(readFavoriteEmoticons(7, storage)).toEqual([]);
    expect(toggleFavoriteEmoticon(7, 'steelman-ok', storage)).toEqual({ keys: ['steelman-ok'], result: 'added' });
    expect(toggleFavoriteEmoticon(7, 'steelman-lol', storage)).toEqual({ keys: ['steelman-ok', 'steelman-lol'], result: 'added' });
    expect(toggleFavoriteEmoticon(7, 'steelman-ok', storage)).toEqual({ keys: ['steelman-lol'], result: 'removed' });
    expect(readFavoriteEmoticons(7, storage)).toEqual(['steelman-lol']);
    expect(readFavoriteEmoticons(8, storage)).toEqual([]);
    expect(storage.getItem(emoticonFavoriteStorageKey(7))).toBe(JSON.stringify(['steelman-lol']));
    expect(emoticonFavoriteStorageKey(7)).toBe('fantasteel.emoticon-favorite.v1.7');
  });

  it(`${EMOTICON_FAVORITE_MAX}개가 차면 더하지 않고(full) 빼기는 된다`, () => {
    const storage = new MemoryStorage();
    const keys = MESSAGE_EMOTICONS.slice(0, EMOTICON_FAVORITE_MAX + 1).map((e) => e.key);
    for (const key of keys.slice(0, EMOTICON_FAVORITE_MAX)) toggleFavoriteEmoticon(7, key, storage);
    const full = toggleFavoriteEmoticon(7, keys[EMOTICON_FAVORITE_MAX], storage);
    expect(full.result).toBe('full');
    expect(full.keys).toHaveLength(EMOTICON_FAVORITE_MAX);
    expect(readFavoriteEmoticons(7, storage)).not.toContain(keys[EMOTICON_FAVORITE_MAX]);
    expect(toggleFavoriteEmoticon(7, keys[0], storage).result).toBe('removed');
    expect(toggleFavoriteEmoticon(7, keys[EMOTICON_FAVORITE_MAX], storage).result).toBe('added');
  });

  it('읽을 때 모르는 키·겹친 키·문자열이 아닌 값은 버리고 최대 개수까지만 읽는다', () => {
    const storage = new MemoryStorage();
    storage.setItem(emoticonFavoriteStorageKey(7), JSON.stringify(['steelman-none', 'steelman-wow', 3, 'steelman-wow', null, 'steelman-off']));
    expect(readFavoriteEmoticons(7, storage)).toEqual(['steelman-wow', 'steelman-off']);
    storage.setItem(emoticonFavoriteStorageKey(7), JSON.stringify(MESSAGE_EMOTICONS.map((e) => e.key)));
    expect(readFavoriteEmoticons(7, storage)).toHaveLength(EMOTICON_FAVORITE_MAX);
  });

  it('망가진 값·배열이 아닌 값은 빈 목록, 저장소가 없거나 쓰기가 막히면 failed', () => {
    const storage = new MemoryStorage();
    storage.setItem(emoticonFavoriteStorageKey(7), '{망가진 값');
    expect(readFavoriteEmoticons(7, storage)).toEqual([]);
    storage.setItem(emoticonFavoriteStorageKey(7), JSON.stringify({ key: 'steelman-ok' }));
    expect(readFavoriteEmoticons(7, storage)).toEqual([]);
    expect(readFavoriteEmoticons(7, null)).toEqual([]);
    expect(toggleFavoriteEmoticon(7, 'steelman-ok', null)).toEqual({ keys: [], result: 'failed' });
    expect(toggleFavoriteEmoticon(7, 'steelman-ok', new FullStorage())).toEqual({ keys: [], result: 'failed' });
  });
});
