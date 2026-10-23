// 철강맨 아침 브리핑 창 상태. 로그인할 때마다 한 번 뜨고, 철강맨AI 채팅·철강맨 펫 대화창의 /브리핑이 다시 연다.
// "방금 로그인했다"는 새로고침해도 이어지도록 이 탭의 sessionStorage에 둔다 (업무 데이터가 아니라 화면 상태).
import { create } from 'zustand';

const AFTER_LOGIN_KEY = 'fantasteel.briefing.after-login';

function readFlag(key: string): boolean {
  try {
    return typeof window !== 'undefined' && window.sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    if (typeof window === 'undefined') return;
    if (on) window.sessionStorage.setItem(key, '1');
    else window.sessionStorage.removeItem(key);
  } catch {
    // 저장소를 못 쓰는 브라우저(사생활 보호 모드 등)에서는 이번 화면에서만 기억한다
  }
}

/** 로그인 직후 표시. 셸이 뜨면 이 표시를 보고 브리핑을 연다 (새 탭 자동 로그인·새로고침은 남기지 않는다) */
export function markBriefingAfterLogin(): void {
  writeFlag(AFTER_LOGIN_KEY, true);
}

/** 로그인 직후 표시를 읽고 지운다. 한 번 로그인에 한 번만 true */
export function takeBriefingAfterLogin(): boolean {
  const on = readFlag(AFTER_LOGIN_KEY);
  if (on) writeFlag(AFTER_LOGIN_KEY, false);
  return on;
}

interface BriefingState {
  open: boolean;
  /** 브리핑을 처음부터 다시 들려줄 때마다 늘린다 (로그인·/브리핑·다시 듣기) */
  playId: number;
  /** 처음부터 다시 들려주며 연다 */
  openBriefing: () => void;
  closeBriefing: () => void;
  /** 로그아웃·사원 전환 때 비운다 */
  reset: () => void;
}

export const useBriefingStore = create<BriefingState>((set) => ({
  open: false,
  playId: 0,
  openBriefing: () => set((state) => ({ open: true, playId: state.playId + 1 })),
  closeBriefing: () => set({ open: false }),
  reset: () => {
    writeFlag(AFTER_LOGIN_KEY, false);
    set({ open: false, playId: 0 });
  },
}));
