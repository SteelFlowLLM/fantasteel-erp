// 철강맨AI ERP 화면 조작 (이슈 #382, 문서에 없는 기능·시험 중). 모델이 고른 화면 동작을 서버가 스트림 ui_action으로 보내면
// 사용자의 브라우저가 지금 화면에서 실행하고 결과를 POST /ai-assistant/ui-actions/:actionId로 돌려준다.
// 데이터를 바꾸는 버튼은 화면과 서버가 함께 막는다(같은 낱말 목록).

export const AI_SCREEN_TOOLS = ['ui_snapshot', 'ui_navigate', 'ui_click', 'ui_fill', 'ui_select'] as const;
export type AiScreenTool = (typeof AI_SCREEN_TOOLS)[number];
export const isAiScreenTool = (name: string): name is AiScreenTool => (AI_SCREEN_TOOLS as readonly string[]).includes(name);

/** 한 답에서 하는 화면 동작 수, 화면이 답하기를 기다리는 시간 (이슈 #382 결정값) */
export const AI_SCREEN_MAX_ACTIONS = 12;
export const AI_SCREEN_ACTION_TIMEOUT_MS = 30_000;
/** 화면이 돌려주는 결과 글·오류 글 길이 상한 */
export const AI_SCREEN_RESULT_MAX = 8000;
export const AI_SCREEN_ERROR_MAX = 500;
/** 요청에 담는 열 수 있는 화면 수 상한 */
export const AI_SCREEN_MAP_MAX = 80;

/** 열 수 있는 화면 한 개 (레일 메뉴에서 이 사원이 여는 화면) */
export interface AiScreenMapEntry {
  /** 예: /sales-orders/new */
  path: string;
  /** 예: 수주 등록 */
  title: string;
}

/** POST /ai-assistant/ui-actions/:actionId 본문 */
export interface AiScreenActionResultInput {
  ok: boolean;
  /** 성공했을 때 모델에 넘길 글 (화면 글 등) */
  result?: string;
  /** 실패했을 때 이유 */
  error?: string;
}

/**
 * 누르지 않는 버튼 낱말: 데이터를 바꾸는 동작. 다듬은(소문자·공백 없앰) 이름에 들어 있으면 막는다.
 * 사람이 직접 눌러야 한다 (AI는 조회·초안만, 기획안 AI 사용 원칙)
 */
export const AI_SCREEN_BLOCKED_WORDS = ['저장', '등록', '확정', '승인', '반려', '삭제', '취소처리', '출고', '배정', '실행', '제출', '보내기', 'save', 'submit', 'confirm', 'delete', 'approve'] as const;

/** 낱말 검사 전 다듬기: 호환 글자 펼치기, 보이지 않는 글자·공백 지우기, 소문자 */
export function normalizeAiScreenLabel(label: string): string {
  return label
    .normalize('NFKC')
    .replace(/[­ᅟᅠㅤﾠ​-‏⁠-⁤﻿\s]/g, '')
    .toLowerCase();
}

/** 이 이름의 요소를 누르면 안 되면 걸린 낱말, 아니면 null */
export function aiScreenBlockedWord(label: string): string | null {
  const normalized = normalizeAiScreenLabel(label);
  return AI_SCREEN_BLOCKED_WORDS.find((word) => normalized.includes(word)) ?? null;
}

/** 열어도 되는 주소인지: 열 수 있는 화면의 주소 그대로이거나 그 뒤에 ?쿼리만 붙은 것 */
export function aiScreenPathAllowed(path: string, screens: readonly AiScreenMapEntry[]): boolean {
  if (path.length > 300 || !path.startsWith('/') || path.startsWith('//')) return false;
  const [pathname, ...rest] = path.split('?');
  if (pathname.includes('#') || rest.join('?').includes('#')) return false;
  return screens.some((screen) => screen.path === pathname);
}
