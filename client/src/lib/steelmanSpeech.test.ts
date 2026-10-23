// 철강맨 말하기 (이슈 #507): 브라우저 음성(speechSynthesis)을 가짜로 바꿔 읽기·멈춤·되먹임 막기(마이크 쉬기)를 본다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clampSpeechRate, koreanVoices, pickVoice, SPEECH_TAIL_MS, speak, speechMuted, speechSupport, stopSpeaking, useSteelmanSpeechStore, type SpeakOutcome } from '@/lib/steelmanSpeech';
import { FakeSpeech, voice } from '@/test/fakeSpeech';

let fake: FakeSpeech;
// 앞 시험이 남긴 '읽은 뒤 쉬는 시간'이 다음 시험으로 넘어오지 않게 시험마다 시계를 한참 뒤로 옮긴다
let clock = Date.now();

beforeEach(() => {
  vi.useFakeTimers();
  clock += 3_600_000;
  vi.setSystemTime(clock);
  fake = new FakeSpeech([voice('Yuna', 'ko-KR', { default: true }), voice('Google 한국어', 'ko_KR'), voice('Samantha', 'en-US')]);
  fake.install();
});

afterEach(() => {
  stopSpeaking('interrupted');
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const request = (text: string, onDone?: (outcome: SpeakOutcome) => void) => ({ key: 'e1', text, source: 'voice' as const, voiceUri: null, rate: 1, ...(onDone ? { onDone } : {}) });

describe('목소리 고르기', () => {
  it('한국어(ko-KR·ko_KR)만 목록에 넣고, 지원 상태를 알린다', () => {
    expect(koreanVoices().map((item) => item.name)).toEqual(['Yuna', 'Google 한국어']);
    expect(speechSupport()).toBe('ready');
    fake.voices = [voice('Samantha', 'en-US')];
    expect(speechSupport()).toBe('no-korean');
    vi.unstubAllGlobals();
    expect(speechSupport()).toBe('unsupported');
  });

  it('저장한 목소리가 있으면 그것, 없으면 이 기기 안 기본 한국어 목소리, 그것도 없으면 첫 한국어 목소리', () => {
    const voices = koreanVoices();
    expect(pickVoice(voices, 'Google 한국어')?.name).toBe('Google 한국어');
    expect(pickVoice(voices, '다른 기기의 목소리')?.name).toBe('Yuna');
    expect(pickVoice(voices, null)?.name).toBe('Yuna');
    expect(pickVoice([voices[1]], null)?.name).toBe('Google 한국어');
    expect(pickVoice([], null)).toBeNull();
  });

  it('온라인 목소리(Google 한국어)는 이 기기 안 목소리가 없을 때만 저절로 고른다: 기본 표시가 온라인에 붙어 있어도 안 쓴다', () => {
    const online = voice('Google 한국어', 'ko_KR', { default: true, local: false });
    const local = voice('Heami', 'ko-KR');
    expect(pickVoice([online, local], null)?.name).toBe('Heami');
    expect(pickVoice([online, local], '다른 기기의 목소리')?.name).toBe('Heami');
    expect(pickVoice([local, voice('Yuna', 'ko-KR', { default: true })], null)?.name).toBe('Yuna');
    expect(pickVoice([online], null)?.name).toBe('Google 한국어');
    // 사용자가 직접 고른 온라인 목소리는 그대로 쓴다
    expect(pickVoice([online, local], 'Google 한국어')?.name).toBe('Google 한국어');
  });

  it('읽기도 같은 규칙으로 이 기기 안 목소리를 쓴다', () => {
    fake.voices = [voice('Google 한국어', 'ko_KR', { default: true, local: false }), voice('Yuna', 'ko-KR')];
    speak(request('글이에요.'));
    expect(fake.spoken[0].voice?.name).toBe('Yuna');
  });

  it('빠르기는 브라우저가 받는 범위(0.5~2)로 맞춘다', () => {
    expect([clampSpeechRate(0.1), clampSpeechRate(1.25), clampSpeechRate(5), clampSpeechRate(Number.NaN)]).toEqual([0.5, 1.25, 2, 1]);
  });
});

describe('읽기', () => {
  it('고른 목소리·빠르기로 문장 단위로 이어 읽고, 다 읽으면 한 번 끝났다고 알린다', () => {
    const done = vi.fn();
    expect(speak({ ...request('첫 문장이에요. 둘째 문장이에요.\n셋째 줄이에요.', done), voiceUri: 'Google 한국어', rate: 1.25 })).toBe(true);
    expect(fake.spoken).toHaveLength(1);
    const first = fake.spoken[0];
    expect(first.voice?.name).toBe('Google 한국어');
    expect(first.lang).toBe('ko_KR');
    expect(first.rate).toBe(1.25);
    expect(first.text).toContain('첫 문장이에요.');
    fake.finishAll();
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith('ended');
    expect(useSteelmanSpeechStore.getState().speaking).toBeNull();
  });

  it('읽는 동안 마이크가 쉬고, 다 읽은 뒤 울림이 가라앉는 시간까지 더 쉬었다가 다시 듣는다', () => {
    expect(speechMuted()).toBe(false);
    speak(request('읽을 글이에요.'));
    expect(useSteelmanSpeechStore.getState().speaking).toEqual({ key: 'e1', source: 'voice' });
    expect(speechMuted()).toBe(true);
    fake.finishAll();
    expect(useSteelmanSpeechStore.getState().speaking).toBeNull();
    expect(speechMuted()).toBe(true);
    vi.advanceTimersByTime(SPEECH_TAIL_MS - 1);
    expect(speechMuted()).toBe(true);
    vi.advanceTimersByTime(2);
    expect(speechMuted()).toBe(false);
  });

  it('여러 문장은 앞 문장이 끝나야 다음 문장을 읽고, 마지막 문장이 끝나면 끝난다', () => {
    const long = Array.from({ length: 8 }, (_, i) => `${i + 1}번째 문장은 한 번에 맡기기엔 꽤 긴 한국어 문장이라서 나뉘어요.`).join(' ');
    const done = vi.fn();
    speak(request(long, done));
    expect(fake.spoken).toHaveLength(1);
    fake.finishCurrent();
    expect(fake.spoken).toHaveLength(2);
    expect(done).not.toHaveBeenCalled();
    fake.finishAll();
    expect(fake.spoken.length).toBeGreaterThan(2);
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith('ended');
  });

  it('한국어 목소리가 없거나 읽을 글이 없으면 아무것도 바꾸지 않고 false', () => {
    const done = vi.fn();
    fake.voices = [voice('Samantha', 'en-US')];
    expect(speak(request('글이에요.', done))).toBe(false);
    fake.voices = [voice('Yuna', 'ko-KR')];
    expect(speak(request('   ', done))).toBe(false);
    expect(fake.spoken).toHaveLength(0);
    expect(speechMuted()).toBe(false);
    expect(done).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    expect(speak(request('글이에요.'))).toBe(false);
  });
});

describe('멈춤', () => {
  it('멈추면 바로 취소하고 한 번만 알리며, 취소 때 브라우저가 보내는 error는 무시한다', () => {
    const done = vi.fn();
    speak(request('읽던 글이에요.', done));
    expect(stopSpeaking('stopped')).toBe(true);
    expect(fake.cancelCount).toBe(1);
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith('stopped');
    expect(useSteelmanSpeechStore.getState().speaking).toBeNull();
    expect(stopSpeaking('stopped')).toBe(false);
    // 멈춘 직후에도 울림이 가라앉을 때까지는 쉰다
    expect(speechMuted()).toBe(true);
  });

  it('다른 글을 읽으면 읽던 것은 끊긴다(interrupted)', () => {
    const first = vi.fn();
    const second = vi.fn();
    speak(request('앞 글이에요.', first));
    speak({ ...request('뒤 글이에요.', second), key: 'e2' });
    expect(first).toHaveBeenCalledWith('interrupted');
    expect(second).not.toHaveBeenCalled();
    expect(useSteelmanSpeechStore.getState().speaking?.key).toBe('e2');
    fake.finishAll();
    expect(second).toHaveBeenCalledWith('ended');
    expect(first).toHaveBeenCalledTimes(1);
  });
});

describe('브라우저가 읽지 못할 때', () => {
  it('첫 문장에서 막히면(autoplay 정책 등) failed로 끝내고 마이크를 풀어 준다', () => {
    const done = vi.fn();
    speak(request('글이에요.', done));
    fake.failCurrent();
    expect(done).toHaveBeenCalledWith('failed');
    expect(useSteelmanSpeechStore.getState().speaking).toBeNull();
  });

  it('시작 신호가 끝내 오지 않으면 그만둔다 (마이크가 계속 쉬지 않게)', () => {
    const done = vi.fn();
    speak(request('글이에요.', done));
    vi.advanceTimersByTime(7_999);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(done).toHaveBeenCalledWith('failed');
    expect(fake.cancelCount).toBe(1);
    vi.advanceTimersByTime(SPEECH_TAIL_MS + 1);
    expect(speechMuted()).toBe(false);
  });

  it('읽다가 끝 신호가 오지 않으면 한계 시간(10초 + 글자당 0.2초 ÷ 빠르기) 뒤 끝내 마이크를 풀어 준다', () => {
    const text = '가'.repeat(100);
    const done = vi.fn();
    speak({ ...request(text, done), rate: 2 });
    fake.startCurrent();
    vi.advanceTimersByTime(10_000 + 100 * 100 - 1);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(done).toHaveBeenCalledWith('ended');
    expect(fake.cancelCount).toBe(1);
    expect(useSteelmanSpeechStore.getState().speaking).toBeNull();
  });

  it('읽는 도중 error는 끝으로 본다', () => {
    const done = vi.fn();
    speak(request('글이에요.', done));
    fake.startCurrent();
    fake.failCurrent();
    expect(done).toHaveBeenCalledWith('ended');
  });
});
