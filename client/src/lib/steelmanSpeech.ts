// 철강맨 말하기 1단계 (이슈 #507, 문서에 없는 기능): 브라우저 음성(speechSynthesis)으로 철강맨AI 답을 읽는다.
// 로컬 TTS·전용 목소리는 나중 단계라, 목소리를 붙이는 자리(lib/steelmanVoice.ts의 setSteelmanSpeaker)에 이 파일의 speakVoiceReply를 꽂는다.
// 읽는 동안은 마이크가 이 소리를 말로 잡지 않게 speechMuted()가 true라서 부르기 듣기가 쉰다(되먹임 막기): 스토어에는 '지금 읽는 답'만 둔다.
// 읽을 글은 lib/steelmanSpeechText.ts가 만든다. 한국어 목소리가 없거나 브라우저가 지원하지 않으면 읽지 않는다(speak가 false).
import { create } from 'zustand';
import { splitForSpeech } from '@/lib/steelmanSpeechText';

/** 읽기가 끝난 뒤에도 마이크가 이만큼 더 쉰다: 스피커 소리의 끝(울림)을 말로 잡지 않게 (가정값) */
export const SPEECH_TAIL_MS = 500;
/** 읽기 시작 신호(start)가 이 시간 안에 안 오면 브라우저가 막은 것으로 보고 그만둔다 (가정값) */
const START_TIMEOUT_MS = 8_000;
/** 문장 하나가 끝나지 않을 때 기다리는 한계: 기본 20초 + 글자당 0.3초를 빠르기로 나눈 시간 (가정값) */
const chunkLimitMs = (chars: number, rate: number): number => 20_000 + (chars * 300) / rate;

export const SPEECH_RATES = [
  { value: 0.8, label: '느리게' },
  { value: 1, label: '보통' },
  { value: 1.25, label: '빠르게' },
  { value: 1.5, label: '아주 빠르게' },
] as const;
export const DEFAULT_SPEECH_RATE = 1;

/** 읽기를 어떻게 끝냈나: ended 끝까지 읽음 · stopped 멈춤 단추·멈춰 말 · interrupted 새 질문·끄기·다른 읽기로 끊김 · failed 브라우저가 막음·멈춤 */
export type SpeakOutcome = 'ended' | 'stopped' | 'interrupted' | 'failed';
/** voice: 철강맨 부르기로 물은 답의 자동 읽기, button: 답의 읽기 단추·설정의 들어 보기 */
export type SpeakSource = 'voice' | 'button';

export interface SpeakingNow {
  key: string;
  source: SpeakSource;
}

/** 설정의 [들어 보기]가 읽는 짧은 글의 열쇠 (대화 줄이 아니라서 답이 사라졌는지 볼 때 빼야 한다) */
export const SPEECH_SAMPLE_KEY = 'speech-sample';

export const useSteelmanSpeechStore = create<{ speaking: SpeakingNow | null }>(() => ({ speaking: null }));

export type SpeechSupport = 'unsupported' | 'no-korean' | 'ready';

const synthesis = (): SpeechSynthesis | null => (typeof speechSynthesis === 'undefined' ? null : speechSynthesis);

const isKorean = (voice: SpeechSynthesisVoice): boolean => /^ko(?:[-_]|$)/i.test(voice.lang);

/** 브라우저가 주는 한국어(ko-KR 등) 목소리. 목록은 브라우저가 늦게 채울 수 있다(voiceschanged) */
export function koreanVoices(): SpeechSynthesisVoice[] {
  return synthesis()?.getVoices().filter(isKorean) ?? [];
}

export function speechSupport(): SpeechSupport {
  if (!synthesis() || typeof SpeechSynthesisUtterance === 'undefined') return 'unsupported';
  return koreanVoices().length ? 'ready' : 'no-korean';
}

/** 저장한 목소리가 이 브라우저에 있으면 그것, 없으면(다른 기기에서 고른 값) 브라우저 기본 한국어 목소리, 그것도 없으면 첫 한국어 목소리 */
export function pickVoice(voices: readonly SpeechSynthesisVoice[], voiceUri: string | null): SpeechSynthesisVoice | null {
  return (voiceUri ? voices.find((voice) => voice.voiceURI === voiceUri) : undefined) ?? voices.find((voice) => voice.default) ?? voices[0] ?? null;
}

export const clampSpeechRate = (rate: number): number => (Number.isFinite(rate) ? Math.min(2, Math.max(0.5, rate)) : DEFAULT_SPEECH_RATE);

export interface SpeakRequest {
  /** 읽는 답(대화 줄 id). 같은 답의 읽기 단추가 '멈춤'으로 바뀌는 열쇠 */
  key: string;
  text: string;
  source: SpeakSource;
  voiceUri: string | null;
  rate: number;
  /** 읽기가 끝나면 한 번 부른다 (읽지 못하고 false를 돌려준 때는 부르지 않는다) */
  onDone?: (outcome: SpeakOutcome) => void;
}

interface Session {
  onDone?: (outcome: SpeakOutcome) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

let current: Session | null = null;
let tailUntil = 0;

/** 지금 읽는 중이거나 막 끝나 울림이 남은 때. 마이크(부르기 듣기)는 이때 소리를 말로 잡지 않는다 */
export const speechMuted = (now = Date.now()): boolean => current !== null || now < tailUntil;

export const isSpeaking = (): boolean => current !== null;

function clearTimer(session: Session): void {
  if (session.timer) clearTimeout(session.timer);
  session.timer = null;
}

function finish(session: Session, outcome: SpeakOutcome): void {
  if (current !== session) return;
  clearTimer(session);
  current = null;
  tailUntil = Date.now() + SPEECH_TAIL_MS;
  useSteelmanSpeechStore.setState({ speaking: null });
  session.onDone?.(outcome);
}

/**
 * 지금 읽는 것을 바로 멈춘다. 읽는 게 없으면 false.
 * outcome: 사용자가 멈췄으면 'stopped', 새 질문·끄기처럼 다른 일이 가로챘으면 'interrupted'
 */
export function stopSpeaking(outcome: Extract<SpeakOutcome, 'stopped' | 'interrupted'> = 'stopped'): boolean {
  const session = current;
  if (!session) return false;
  // 취소하면 브라우저가 읽던 문장에 error 이벤트를 보내므로, 그 전에 이 읽기를 끝낸 것으로 해 둔다
  finish(session, outcome);
  synthesis()?.cancel();
  return true;
}

/**
 * 글을 문장 단위로 이어서 읽는다. 읽을 수 없으면(브라우저 미지원·한국어 목소리 없음·읽을 글 없음) 아무것도 바꾸지 않고 false.
 * 읽고 있던 다른 답은 끊고(interrupted) 이것을 읽는다
 */
export function speak(request: SpeakRequest): boolean {
  const synth = synthesis();
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return false;
  const voice = pickVoice(koreanVoices(), request.voiceUri);
  const chunks = splitForSpeech(request.text);
  if (!voice || !chunks.length) return false;
  stopSpeaking('interrupted');
  const rate = clampSpeechRate(request.rate);
  const session: Session = { ...(request.onDone ? { onDone: request.onDone } : {}), timer: null };
  current = session;
  useSteelmanSpeechStore.setState({ speaking: { key: request.key, source: request.source } });

  const speakChunk = (index: number): void => {
    if (current !== session) return;
    const text = chunks[index];
    if (text === undefined) {
      finish(session, 'ended');
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = rate;
    let started = false;
    const arm = (ms: number, outcome: SpeakOutcome): void => {
      clearTimer(session);
      session.timer = setTimeout(() => {
        if (current !== session) return;
        finish(session, outcome);
        synth.cancel();
      }, ms);
    };
    utterance.onstart = () => {
      if (current !== session) return;
      started = true;
      arm(chunkLimitMs(text.length, rate), 'ended');
    };
    utterance.onend = () => {
      if (current !== session) return;
      clearTimer(session);
      speakChunk(index + 1);
    };
    utterance.onerror = () => {
      // 멈추거나 다른 읽기가 가로채서 생긴 error는 위에서 이미 끝냈으므로 current가 달라 여기까지 오지 않는다. 여기 온 것은 브라우저가 막은 것
      if (current !== session) return;
      finish(session, started || index > 0 ? 'ended' : 'failed');
    };
    arm(START_TIMEOUT_MS, 'failed');
    synth.speak(utterance);
  };
  speakChunk(0);
  return true;
}
