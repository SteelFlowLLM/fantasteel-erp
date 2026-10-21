// 철강맨 부르기 (이슈 #457): 마이크 소리에서 말소리 조각만 잘라 16kHz WAV로 만든다.
// 소리 크기(RMS)로 말 시작·끝을 잡는다. 조용할 때는 아무것도 서버로 보내지 않으려는 것이고, 말인지 소음인지는 음성 서버가 가린다.
import { STT_WAKE_CLIP_LIMITS } from '@fantasteel/shared';

export const WAV_SAMPLE_RATE = 16_000;

export interface VoiceSegmenterOptions {
  sampleRate: number;
  /** 한 조각의 최대 길이. 넘으면 거기서 자른다 */
  maxMs?: number;
  /** 이만큼 조용하면 말이 끝난 것으로 본다 (가정값) */
  endSilenceMs?: number;
  /** 이보다 짧은 소리(문 닫는 소리·기침)는 버린다 (가정값) */
  minSpeechMs?: number;
  /** 말 시작을 알아채기 전의 소리도 조금 붙인다: 첫 글자가 잘리지 않게 */
  preRollMs?: number;
}

/** 시끄러운 공장 사무실에서도 배경 소리를 말로 잡지 않게 배경 크기의 몇 배를 넘어야 말로 본다 (가정값) */
const START_RATIO = 3;
const KEEP_RATIO = 2;
const MIN_START_RMS = 0.015;
const MIN_KEEP_RMS = 0.008;
/** 배경 크기를 따라가는 빠르기. 켠 직후에는 배경을 빨리 배운다 (그동안은 말로 보지 않는다) */
const FLOOR_ALPHA = 0.05;
const WARM_UP_ALPHA = 0.2;
const WARM_UP_MS = 500;

export function rmsOf(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) sum += frame[i] * frame[i];
  return frame.length ? Math.sqrt(sum / frame.length) : 0;
}

/**
 * 소리 조각(frame)을 차례로 넣으면 말 한 덩이가 끝날 때 그 소리를 돌려준다 (아니면 null).
 * 상태만 들고 있어 시험에서 소리 크기를 지어 넣어 볼 수 있다.
 */
export class VoiceSegmenter {
  private readonly maxSamples: number;
  private readonly endSilenceSamples: number;
  private readonly minSpeechSamples: number;
  private readonly preRollSamples: number;
  private readonly warmUpSamples: number;
  private floor = 0.005;
  private heard = 0;
  private preRoll: Float32Array[] = [];
  private preRollLength = 0;
  private speech: Float32Array[] = [];
  private speechLength = 0;
  private silentSamples = 0;
  private voicedSamples = 0;
  private rmsSum = 0;
  private frames = 0;

  constructor(options: VoiceSegmenterOptions) {
    this.maxSamples = Math.round(((options.maxMs ?? STT_WAKE_CLIP_LIMITS.maxSeconds * 1000) * options.sampleRate) / 1000);
    this.endSilenceSamples = Math.round(((options.endSilenceMs ?? 700) * options.sampleRate) / 1000);
    this.minSpeechSamples = Math.round(((options.minSpeechMs ?? 300) * options.sampleRate) / 1000);
    this.preRollSamples = Math.round(((options.preRollMs ?? 300) * options.sampleRate) / 1000);
    this.warmUpSamples = Math.round((WARM_UP_MS * options.sampleRate) / 1000);
  }

  get speaking(): boolean {
    return this.speechLength > 0;
  }

  feed(frame: Float32Array): Float32Array | null {
    const rms = rmsOf(frame);
    if (!this.speaking) {
      const warmingUp = this.heard < this.warmUpSamples;
      this.heard += frame.length;
      if (!warmingUp && rms >= Math.max(MIN_START_RMS, this.floor * START_RATIO)) {
        this.speech = [...this.preRoll, frame];
        this.speechLength = this.preRollLength + frame.length;
        this.preRoll = [];
        this.preRollLength = 0;
        this.silentSamples = 0;
        this.voicedSamples = frame.length;
        this.rmsSum = rms;
        this.frames = 1;
        return null;
      }
      this.floor += (rms - this.floor) * (warmingUp ? WARM_UP_ALPHA : FLOOR_ALPHA);
      this.preRoll.push(frame);
      this.preRollLength += frame.length;
      while (this.preRoll.length > 1 && this.preRollLength - this.preRoll[0].length >= this.preRollSamples) this.preRollLength -= this.preRoll.shift()?.length ?? 0;
      return null;
    }
    this.speech.push(frame);
    this.speechLength += frame.length;
    this.rmsSum += rms;
    this.frames += 1;
    const quiet = rms < Math.max(MIN_KEEP_RMS, this.floor * KEEP_RATIO);
    this.silentSamples = quiet ? this.silentSamples + frame.length : 0;
    if (!quiet) this.voicedSamples += frame.length;
    const full = this.speechLength >= this.maxSamples;
    if (this.silentSamples < this.endSilenceSamples && !full) return null;
    // 8초 내내 쉬지 않은 소리는 대개 기계 소리라 그 크기를 배경으로 삼는다: 다음부터는 그보다 커야 말로 본다
    if (full) this.floor = Math.max(this.floor, this.rmsSum / this.frames);
    const voiced = this.voicedSamples;
    const clip = concat(this.speech, Math.min(this.speechLength, this.maxSamples));
    this.reset();
    return voiced >= this.minSpeechSamples ? clip : null;
  }

  /** 듣기를 멈출 때 하던 말은 버린다 */
  reset(): void {
    this.speech = [];
    this.speechLength = 0;
    this.silentSamples = 0;
    this.voicedSamples = 0;
    this.rmsSum = 0;
    this.frames = 0;
    this.preRoll = [];
    this.preRollLength = 0;
  }
}

function concat(parts: readonly Float32Array[], length: number): Float32Array {
  const out = new Float32Array(length);
  let at = 0;
  for (const part of parts) {
    if (at >= length) break;
    const take = part.subarray(0, Math.min(part.length, length - at));
    out.set(take, at);
    at += take.length;
  }
  return out;
}

/** 마이크 소리(보통 48kHz)를 16kHz로 줄인다. 묶음 평균이라 높은 소리가 접혀 들어오는 것도 줄어든다 */
export function downsample(samples: Float32Array, fromRate: number, toRate = WAV_SAMPLE_RATE): Float32Array {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end && j < samples.length; j += 1) sum += samples[j];
    out[i] = sum / (end - start);
  }
  return out;
}

/** 16비트 PCM WAV (모노). 44바이트 머리글 + 샘플 */
export function encodeWav(samples: Float32Array, sampleRate = WAV_SAMPLE_RATE): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(at + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

/** 잘라 낸 말소리를 서버에 보낼 WAV로 */
export function clipToWav(clip: Float32Array, sampleRate: number): Blob {
  return new Blob([encodeWav(downsample(clip, sampleRate))], { type: 'audio/wav' });
}

/** 음성 서버가 느릴 때 쌓아 둘 조각 수 (가정값). 넘으면 오래된 것부터 버린다: 늦게 올라간 옛 말이 질문이 되지 않게 */
export const MAX_WAITING_CLIPS = 3;

/**
 * 조각을 하나씩 차례로 올린다 (말 순서가 바뀌면 "철강맨" 뒤의 질문을 놓친다).
 * 끄거나 탭을 숨긴 뒤(stopped)에는 기다리던 조각을 올리지 않고 버린다
 */
export class ClipUploadQueue<T> {
  private waiting: T[] = [];
  private running = false;

  constructor(
    private readonly send: (item: T) => Promise<void>,
    private readonly stopped: () => boolean,
    private readonly max = MAX_WAITING_CLIPS,
  ) {}

  get size(): number {
    return this.waiting.length;
  }

  push(item: T): void {
    if (this.stopped()) return;
    this.waiting.push(item);
    while (this.waiting.length > this.max) this.waiting.shift();
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (!this.stopped()) {
        const next = this.waiting.shift();
        if (next === undefined) break;
        await this.send(next).catch(() => undefined);
      }
    } finally {
      this.running = false;
      if (this.stopped()) this.waiting = [];
    }
  }
}
