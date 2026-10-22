// 철강맨 부르기의 소리: 불렀을 때 띠링(Web Audio로 만든 소리, 파일 없음)과 답을 읽어 줄 자리 (이슈 #457). 1단계 목소리는 브라우저 음성 (이슈 #507).
import type { SpeakOutcome } from '@/lib/steelmanSpeech';

/** 두 음을 짧게 올려 부른다 (도→솔). 마이크가 이 소리를 말로 잡지 않게 부른 쪽이 그동안 듣기를 쉰다 */
export const WAKE_CHIME_MS = 320;

export function playWakeChime(context: AudioContext): void {
  const start = context.currentTime;
  [523.25, 783.99].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    const at = start + index * 0.12;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.2);
  });
}

/** 목소리가 읽어 달라는 부탁. key는 읽는 답(대화 줄 id), onDone은 읽기가 끝나면 한 번 부른다 */
export interface SteelmanSpeakRequest {
  key: string;
  text: string;
  onDone: (outcome: SpeakOutcome) => void;
}

/**
 * 붙어 있는 목소리. 읽기 시작하면 true, 읽지 못하면(꺼짐·지원 안 함·한국어 목소리 없음) false를 돌려준다.
 * 1단계는 브라우저 음성(lib/steelmanSpeech.ts의 speakVoiceReply)이고, 로컬 TTS → 전용 목소리는 같은 자리에 바꿔 꽂는다 (이슈 #507)
 */
let speaker: ((request: SteelmanSpeakRequest) => boolean) | null = null;

export function setSteelmanSpeaker(next: ((request: SteelmanSpeakRequest) => boolean) | null): void {
  speaker = next;
}

/** 말로 물은 질문의 답이 끝나면 부른다. 읽기 시작했으면 true (끝나면 onDone), 아니면 false라서 부른 쪽이 바로 다음 일을 한다 */
export function speakSteelmanReply(request: SteelmanSpeakRequest): boolean {
  return speaker?.(request) ?? false;
}
