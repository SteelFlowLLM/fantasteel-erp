// 즐겨찾는 이모티콘 (23번, 문서에 없는 추가 기능): 고르기 창 '즐겨찾기' 탭. 사원별로 이 브라우저 localStorage에 둔다.
// 최근 이모티콘(emoticonRecent)과 같은 까닭으로 서버·가짜 DB에 두지 않는다 (ERD에 테이블이 없다). 읽거나 쓰지 못하면 빈 목록으로 둔다.
import { isMessageEmoticonKey, type MessageEmoticonKey } from '@fantasteel/shared';

/** 즐겨찾기에 둘 수 있는 최대 개수 (가정값, 4칸 × 6줄) */
export const EMOTICON_FAVORITE_MAX = 24;

export const emoticonFavoriteStorageKey = (employeeId: number): string => `fantasteel.emoticon-favorite.v1.${employeeId}`;

/** 저장값 확인: 문자열 배열에서 모르는 키(목록에서 뺀 것)·겹친 키를 버리고 최대 개수까지 */
function parseFavorites(raw: unknown): MessageEmoticonKey[] {
  if (!Array.isArray(raw)) return [];
  const out: MessageEmoticonKey[] = [];
  for (const entry of raw as unknown[]) {
    if (typeof entry !== 'string' || !isMessageEmoticonKey(entry) || out.includes(entry)) continue;
    out.push(entry);
    if (out.length >= EMOTICON_FAVORITE_MAX) break;
  }
  return out;
}

/** 즐겨찾는 이모티콘 (더한 순서) */
export function readFavoriteEmoticons(employeeId: number, storage: Storage | null = browserStorage()): MessageEmoticonKey[] {
  if (!storage) return [];
  try {
    const text = storage.getItem(emoticonFavoriteStorageKey(employeeId));
    return text === null ? [] : parseFavorites(JSON.parse(text));
  } catch {
    return [];
  }
}

export interface FavoriteToggleResult {
  /** 바꾼 뒤의 목록 (바꾸지 못했으면 그대로) */
  keys: MessageEmoticonKey[];
  /** added·removed = 저장함, full = 이미 최대 개수라 더하지 않음, failed = 저장소가 없거나 막힘 */
  result: 'added' | 'removed' | 'full' | 'failed';
}

/** 즐겨찾기에 있으면 빼고, 없으면 맨 뒤에 더한다 */
export function toggleFavoriteEmoticon(employeeId: number, key: MessageEmoticonKey, storage: Storage | null = browserStorage()): FavoriteToggleResult {
  if (!storage) return { keys: [], result: 'failed' };
  const current = readFavoriteEmoticons(employeeId, storage);
  const removing = current.includes(key);
  if (!removing && current.length >= EMOTICON_FAVORITE_MAX) return { keys: current, result: 'full' };
  const next = removing ? current.filter((k) => k !== key) : [...current, key];
  try {
    storage.setItem(emoticonFavoriteStorageKey(employeeId), JSON.stringify(next));
    return { keys: next, result: removing ? 'removed' : 'added' };
  } catch {
    return { keys: current, result: 'failed' };
  }
}

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
