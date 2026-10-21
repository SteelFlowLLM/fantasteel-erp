// 철강맨 부르기의 소리: 불렀을 때 띠링(Web Audio로 만든 소리, 파일 없음)과 답을 읽어 줄 자리 (이슈 #457).

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

/** 2단계에서 붙일 목소리 (브라우저 음성 → 로컬 TTS → 전용 목소리). 1단계는 없어 답을 글로만 보인다 */
let speaker: ((text: string) => void) | null = null;

export function setSteelmanSpeaker(next: ((text: string) => void) | null): void {
  speaker = next;
}

/** 말로 물은 질문의 답이 끝나면 부른다. 목소리가 붙어 있을 때만 읽는다 */
export function speakSteelmanReply(text: string): void {
  speaker?.(text);
}
