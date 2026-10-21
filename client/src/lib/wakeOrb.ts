// 철강맨 부르기 (이슈 #494): 말소리 크기에 따라 움직이는 원(오브)과 소리 크기 막대가 읽는 실시간 값.
// 소리 묶음(약 43ms)마다 스토어를 바꾸면 화면 전체가 다시 그려지므로, 마이크 쪽은 여기 값만 바꾸고
// 원·막대는 requestAnimationFrame으로 이 값을 읽어 CSS 변수만 바꾼다.

/** 마지막 소리 묶음의 크기(RMS)와 지금 말 시작 기준. 마이크를 닫으면 0 */
export const wakeLiveLevel = { rms: 0, threshold: 0 };

export function setWakeLiveLevel(rms: number, threshold: number): void {
  wakeLiveLevel.rms = rms;
  wakeLiveLevel.threshold = threshold;
}

/**
 * 원의 모양: idle 듣는 중(천천히 숨 쉼) · speaking 말소리 잡음(목소리 크기로 커지고 물결) · transcribing 받아쓰는 중(돌아감) ·
 * called "네? 말씀하세요"(밝게 반짝이며 남은 시간 테) · answering 철강맨이 답하는 중 · muted 오류·멈춤(회색)
 */
export type WakeOrbMode = 'idle' | 'speaking' | 'transcribing' | 'called' | 'answering' | 'muted';

export interface WakeOrbInput {
  status: 'off' | 'starting' | 'listening' | 'paused' | 'error';
  audioBlocked: boolean;
  hearing: boolean;
  transcribing: boolean;
  called: boolean;
  answering: boolean;
}

/** 띠 글자(wakeBarLine)와 같은 순서로 고른다: 막힘·오류가 먼저, 그다음 답하는 중 → "네?" → 받아쓰기 → 말소리 */
export function wakeOrbModeOf(input: WakeOrbInput): WakeOrbMode {
  if (input.status !== 'listening' || input.audioBlocked) return 'muted';
  if (input.answering) return 'answering';
  if (input.called) return 'called';
  if (input.transcribing) return 'transcribing';
  if (input.hearing) return 'speaking';
  return 'idle';
}

/** 원이 가장 크게 커지는 배수 */
export const ORB_MAX_SCALE = 1.6;

/**
 * 목소리 크기 → 원 크기 배수. 말 시작 기준이면 1.25배, 기준의 3배 이상이면 가장 크게. 기준을 모르면 1
 * (작은 소리도 조금 움직여 마이크가 듣고 있음을 보이게 제곱근으로 키운다)
 */
export function orbTargetScale(rms: number, threshold: number): number {
  if (!(threshold > 0) || !(rms > 0)) return 1;
  const ratio = Math.min(rms / threshold, 3);
  return 1 + (ORB_MAX_SCALE - 1) * Math.sqrt(ratio / 3);
}

/** 커질 때는 빨리, 작아질 때는 천천히 따라간다 (말이 끊길 때 원이 툭 꺼지지 않게) */
export function smoothOrbScale(current: number, target: number): number {
  const rate = target > current ? 0.45 : 0.12;
  return current + (target - current) * rate;
}
