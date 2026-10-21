// 철강맨 부르기 (이슈 #457)의 켜기·말로 승인 허용 설정. 마이크를 여는 일이라 사원별이 아니라 이 브라우저에만 저장하고 기본은 둘 다 꺼짐이다.
export const STEELMAN_WAKE_KEY = 'fantasteel.steelman-wake';
export const STEELMAN_VOICE_APPROVAL_KEY = 'fantasteel.steelman-voice-approval';

function read(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function write(key: string, on: boolean): void {
  try {
    window.localStorage.setItem(key, String(on));
  } catch {
    // localStorage를 쓸 수 없는 환경이면 이 화면을 열어 둔 동안만 유지한다
  }
}

export const readSteelmanWakePreference = (): boolean => read(STEELMAN_WAKE_KEY);
export const writeSteelmanWakePreference = (on: boolean): void => write(STEELMAN_WAKE_KEY, on);
export const readVoiceApprovalPreference = (): boolean => read(STEELMAN_VOICE_APPROVAL_KEY);
export const writeVoiceApprovalPreference = (on: boolean): void => write(STEELMAN_VOICE_APPROVAL_KEY, on);
