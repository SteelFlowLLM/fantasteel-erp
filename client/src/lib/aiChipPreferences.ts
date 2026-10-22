// 철강맨AI 입력창 켜기 설정(웹 검색·브라우저·화면 조작·Notion·Drive·생각 정도)은 사원별이 아니라 이 브라우저에 저장한다 (계정에 저장할 컬럼이 ERD에 없다).
// 그래서 로그아웃하거나 다른 사원이 들어오면 지워서, 앞 사람이 켠 Drive·브라우저 같은 칩이 다음 사람에게 켜진 채 시작하지 않게 한다 (이슈 #532).
// 철강맨 부르기 설정(steelmanWakePreference)은 키에 사원 id가 들어 있어 사원마다 따로라 여기에 없다.
import { AI_BROWSER_KEY } from '@/lib/aiBrowser';
import { AI_DRIVE_KEY } from '@/lib/aiDrive';
import { AI_NOTION_KEY } from '@/lib/aiNotion';
import { AI_REASONING_KEY } from '@/lib/aiReasoning';
import { AI_SCREEN_CONTROL_KEY } from '@/lib/aiScreenControl';
import { AI_WEB_SEARCH_KEY } from '@/lib/aiWebSearch';

export const AI_CHIP_PREFERENCE_KEYS: readonly string[] = [AI_WEB_SEARCH_KEY, AI_BROWSER_KEY, AI_SCREEN_CONTROL_KEY, AI_NOTION_KEY, AI_DRIVE_KEY, AI_REASONING_KEY];

/** 저장된 칩 설정을 모두 지운다. localStorage를 쓸 수 없는 환경이면 조용히 넘어간다 */
export function clearAiChipPreferences(storage: Pick<Storage, 'removeItem'> | undefined = typeof window === 'undefined' ? undefined : safeLocalStorage()): void {
  if (!storage) return;
  for (const key of AI_CHIP_PREFERENCE_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      // 쓸 수 없는 저장소는 건너뛴다
    }
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
