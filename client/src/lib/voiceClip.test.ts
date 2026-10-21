// 철강맨 부르기 (이슈 #457): 소리 크기로 말 조각 자르기, 16kHz로 줄이기, WAV 머리글.
import { describe, expect, it } from 'vitest';
import { downsample, encodeWav, rmsOf, VoiceSegmenter } from '@/lib/voiceClip';

const RATE = 16_000;
/** 10ms 조각 하나 (크기 amp인 사각파) */
const frame = (amp: number) => Float32Array.from({ length: RATE / 100 }, (_, i) => (i % 2 ? amp : -amp));
const feed = (segmenter: VoiceSegmenter, amp: number, ms: number) => {
  const clips: Float32Array[] = [];
  for (let t = 0; t < ms; t += 10) {
    const clip = segmenter.feed(frame(amp));
    if (clip) clips.push(clip);
  }
  return clips;
};

describe('VoiceSegmenter', () => {
  it('조용하면 아무것도 내지 않는다', () => {
    const segmenter = new VoiceSegmenter({ sampleRate: RATE });
    expect(feed(segmenter, 0.002, 5000)).toEqual([]);
  });

  it('말 → 0.7초 조용하면 앞 0.3초를 붙여 한 조각을 낸다', () => {
    const segmenter = new VoiceSegmenter({ sampleRate: RATE });
    feed(segmenter, 0.002, 1000);
    expect(feed(segmenter, 0.2, 1500)).toEqual([]);
    expect(segmenter.speaking).toBe(true);
    const clips = feed(segmenter, 0.002, 1000);
    expect(clips).toHaveLength(1);
    // 앞 0.3초 + 말 1.5초 + 끝 조용함 0.7초
    expect(clips[0].length / RATE).toBeCloseTo(2.5, 1);
    expect(segmenter.speaking).toBe(false);
  });

  it('짧은 소리(0.3초 미만)는 버린다', () => {
    const segmenter = new VoiceSegmenter({ sampleRate: RATE });
    feed(segmenter, 0.002, 500);
    feed(segmenter, 0.3, 100);
    expect(feed(segmenter, 0.002, 1000)).toEqual([]);
  });

  it('쉬지 않고 말하면 8초에서 자르고, 그 크기를 배경으로 삼아 같은 소리가 이어지면 더 보내지 않는다', () => {
    const segmenter = new VoiceSegmenter({ sampleRate: RATE });
    feed(segmenter, 0.002, 600);
    const clips = feed(segmenter, 0.2, 20_000);
    expect(clips).toHaveLength(1);
    expect(clips[0].length).toBe(8 * RATE);
  });

  it('켠 직후 0.5초는 배경을 배우기만 한다', () => {
    const segmenter = new VoiceSegmenter({ sampleRate: RATE });
    feed(segmenter, 0.2, 400);
    expect(segmenter.speaking).toBe(false);
  });

  it('배경이 시끄러우면 그보다 커야 말로 본다', () => {
    const segmenter = new VoiceSegmenter({ sampleRate: RATE });
    feed(segmenter, 0.03, 3000);
    expect(segmenter.speaking).toBe(false);
    feed(segmenter, 0.2, 500);
    expect(segmenter.speaking).toBe(true);
  });
});

describe('WAV', () => {
  it('48kHz를 16kHz로 줄인다 (묶음 평균)', () => {
    const out = downsample(Float32Array.from([0.3, 0.3, 0.3, 0.6, 0.6, 0.6]), 48_000);
    expect(Array.from(out).map((v) => Number(v.toFixed(3)))).toEqual([0.3, 0.6]);
    expect(rmsOf(Float32Array.from([0.5, -0.5]))).toBeCloseTo(0.5);
  });

  it('16kHz·모노·16비트 머리글과 샘플', () => {
    const view = new DataView(encodeWav(Float32Array.from([0, 1, -1, 2])));
    const text = (at: number, n: number) => String.fromCharCode(...Array.from({ length: n }, (_, i) => view.getUint8(at + i)));
    expect(text(0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + 8);
    expect(text(8, 8)).toBe('WAVEfmt ');
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767]);
  });
});
