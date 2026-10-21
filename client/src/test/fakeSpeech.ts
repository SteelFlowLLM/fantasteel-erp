// 테스트용: 브라우저 음성(speechSynthesis)을 가짜로 바꾼다 (이슈 #507). Vitest는 node 환경이라 원래 없다.
// 읽기는 시험이 끝났다고 알려 줘야 끝난다: finishCurrent() 한 문장, finishAll() 전부, failCurrent() 브라우저가 막음.
import { vi } from 'vitest';

export class FakeUtterance {
  voice: SpeechSynthesisVoice | null = null;
  lang = '';
  rate = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;

  constructor(readonly text: string) {}
}

/** local: 이 기기 안에서 읽는 목소리(기본). false면 Chrome의 'Google 한국어'처럼 온라인 목소리 */
export const voice = (name: string, lang: string, extra: { default?: boolean; local?: boolean } = {}): SpeechSynthesisVoice =>
  ({ name, lang, voiceURI: name, default: extra.default ?? false, localService: extra.local ?? true }) as SpeechSynthesisVoice;

export class FakeSpeech {
  /** 지금까지 읽으라고 맡긴 문장 전부 */
  spoken: FakeUtterance[] = [];
  /** 아직 끝나지 않은 문장 */
  queue: FakeUtterance[] = [];
  cancelCount = 0;

  constructor(public voices: SpeechSynthesisVoice[]) {}

  getVoices(): SpeechSynthesisVoice[] {
    return this.voices;
  }

  addEventListener(): void {}

  removeEventListener(): void {}

  speak(utterance: FakeUtterance): void {
    this.spoken.push(utterance);
    this.queue.push(utterance);
  }

  /** 실제 브라우저처럼 읽던 문장에 error('interrupted')를 보낸다 */
  cancel(): void {
    this.cancelCount += 1;
    const active = this.queue[0];
    this.queue = [];
    active?.onerror?.({ error: 'interrupted' });
  }

  install(): void {
    vi.stubGlobal('speechSynthesis', this);
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  }

  startCurrent(): void {
    this.queue[0]?.onstart?.();
  }

  finishCurrent(): void {
    const utterance = this.queue.shift();
    utterance?.onstart?.();
    utterance?.onend?.();
  }

  finishAll(): void {
    let guard = 0;
    while (this.queue.length && guard < 200) {
      this.finishCurrent();
      guard += 1;
    }
  }

  failCurrent(): void {
    this.queue.shift()?.onerror?.({ error: 'not-allowed' });
  }
}
