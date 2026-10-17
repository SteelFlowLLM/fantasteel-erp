// 철강맨AI ERP 화면 조작 (이슈 #382, 문서에 없는 기능·시험 중)의 켜기 설정. 사원별이 아니라 이 브라우저에 저장한다 (계정에 저장할 컬럼이 ERD에 없다).
export const AI_SCREEN_CONTROL_KEY = 'fantasteel.ai-screen-control';

export const AI_SCREEN_CONTROL_TITLE = '켜면 철강맨AI가 지금 화면을 읽고, 화면을 옮기고, 칸을 채워 줘요. 저장·등록·확정 버튼은 누르지 않아요.';

/** 저장된 글에서 켜기 설정을 읽는다. 깨졌거나 없으면 꺼짐 */
export function parseAiScreenControlPreference(raw: string | null): boolean {
  return raw === 'true';
}

export function readAiScreenControlPreference(): boolean {
  try {
    return parseAiScreenControlPreference(window.localStorage.getItem(AI_SCREEN_CONTROL_KEY));
  } catch {
    return false;
  }
}

export function writeAiScreenControlPreference(on: boolean): void {
  try {
    window.localStorage.setItem(AI_SCREEN_CONTROL_KEY, String(on));
  } catch {
    // localStorage를 쓸 수 없는 환경이면 이 화면을 열어 둔 동안만 유지한다
  }
}
