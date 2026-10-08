// 최근 보낸 이모티콘 (19번, 문서에 없는 추가 기능): 고르기 창 '최근' 탭. 사원별로 이 브라우저 localStorage에 둔다.
// 화면 편의 기능이라 서버·가짜 DB에 두지 않는다 (ERD에 테이블이 없다). 읽거나 쓰지 못하면 빈 목록으로 둔다.
import { isMessageEmoticonKey, type MessageEmoticonKey } from '@fantasteel/shared';

/** 최근 탭에 두는 최대 개수 (4칸 × 4줄) */
export const EMOTICON_RECENT_MAX = 16;

export const emoticonRecentStorageKey = (employeeId: number): string => `fantasteel.emoticon-recent.v1.${employeeId}`;

/** 저장값 확인: 문자열 배열에서 모르는 키(목록에서 뺀 것)·겹친 키를 버리고 최대 개수까지 */
function parseRecent(raw: unknown): MessageEmoticonKey[] {
  if (!Array.isArray(raw)) return [];
  const out: MessageEmoticonKey[] = [];
  for (const entry of raw as unknown[]) {
    if (typeof entry !== 'string' || !isMessageEmoticonKey(entry) || out.includes(entry)) continue;
    out.push(entry);
    if (out.length >= EMOTICON_RECENT_MAX) break;
  }
  return out;
}

/** 최근 보낸 이모티콘 (최근 것이 앞) */
export function readRecentEmoticons(employeeId: number, storage: Storage | null = browserStorage()): MessageEmoticonKey[] {
  if (!storage) return [];
  try {
    const text = storage.getItem(emoticonRecentStorageKey(employeeId));
    return text === null ? [] : parseRecent(JSON.parse(text));
  } catch {
    return [];
  }
}

/** 보낸 이모티콘을 맨 앞에 둔다 (이미 있으면 앞으로 옮김). 저장한 뒤의 목록, 저장하지 못하면 빈 목록 */
export function pushRecentEmoticon(employeeId: number, key: MessageEmoticonKey, storage: Storage | null = browserStorage()): MessageEmoticonKey[] {
  if (!storage) return [];
  try {
    const next = [key, ...readRecentEmoticons(employeeId, storage).filter((k) => k !== key)].slice(0, EMOTICON_RECENT_MAX);
    storage.setItem(emoticonRecentStorageKey(employeeId), JSON.stringify(next));
    return next;
  } catch {
    return [];
  }
}

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
