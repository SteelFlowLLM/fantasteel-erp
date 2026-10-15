import { Injectable } from '@nestjs/common';

/** 긴 회의 녹음은 CPU로 돌리면 실시간보다 오래 걸릴 수 있다 */
const TRANSCRIBE_TIMEOUT_MS = 15 * 60_000;
const CONNECTION_TEST_TIMEOUT_MS = 30_000;
const DEFAULT_MODEL = 'whisper-1';

export interface SttEndpoint {
  baseUrl: string;
  apiKey: string | null;
}

export interface SttTranscribeInput {
  audio: Buffer;
  fileName: string;
  mimeType: string;
  /** whisper.cpp는 무시한다. 비우면 OpenAI 호환 기본 이름을 보낸다 */
  model: string | null;
  language?: string;
}

export interface SttSegment {
  /** 초. 서버가 구간 시간을 주지 않으면 null */
  start: number | null;
  end: number | null;
  text: string;
}

export interface SttTranscript {
  text: string;
  segments: SttSegment[];
  durationSec: number | null;
}

/** 화면에 그대로 보일 연결 실패 이유 */
export class SttRequestError extends Error {}

/**
 * OpenAI 호환 음성 인식 API 호출 (whisper.cpp whisper-server, 나중에 OpenAI 등).
 * LLM과 마찬가지로 브라우저가 아니라 서버가 부른다.
 */
@Injectable()
export class SttClient {
  async transcribe(endpoint: SttEndpoint, input: SttTranscribeInput, timeoutMs = TRANSCRIBE_TIMEOUT_MS): Promise<SttTranscript> {
    const url = `${normalizeBaseUrl(endpoint.baseUrl)}/audio/transcriptions`;
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(input.audio)], { type: input.mimeType }), input.fileName);
    form.append('model', input.model || DEFAULT_MODEL);
    form.append('language', input.language ?? 'ko');
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: endpoint.apiKey ? { authorization: `Bearer ${endpoint.apiKey}` } : {},
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new SttRequestError(`${Math.round(timeoutMs / 1000)}초 안에 응답이 없어요. Whisper 서버 상태를 확인해 주세요`);
      }
      throw new SttRequestError(`${url}에 연결할 수 없어요. Whisper 서버가 켜져 있는지, 주소가 맞는지 확인해 주세요`);
    }
    if (res.status === 401 || res.status === 403) throw new SttRequestError('API 키가 맞지 않거나 권한이 없어요');
    if (!res.ok) throw new SttRequestError(`음성 인식 서버 오류 (HTTP ${res.status}): ${await errorMessageOf(res)}`);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new SttRequestError('음성 인식 서버 응답을 읽을 수 없어요. OpenAI 호환 주소(…/v1)가 맞는지 확인해 주세요');
    }
    return parseTranscript(body);
  }

  /**
   * /models 같은 확인용 경로가 없는 서버가 많아서, 1초짜리 무음 WAV를 실제로 보내 본다.
   * HTTP 성공이면 연결된 것이고 인식된 글이 비어도 괜찮다.
   */
  async checkConnection(endpoint: SttEndpoint, model: string | null): Promise<void> {
    await this.transcribe(
      endpoint,
      { audio: silentWav(), fileName: 'silence.wav', mimeType: 'audio/wav', model },
      CONNECTION_TEST_TIMEOUT_MS,
    );
  }
}

/** 무음 PCM WAV (16kHz·모노·16비트). 44바이트 RIFF 머리글 + 0으로 채운 샘플 */
export function silentWav(seconds = 1, sampleRate = 16_000): Buffer {
  const dataBytes = seconds * sampleRate * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // 모노
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

const asNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** OpenAI·whisper.cpp verbose_json과 단순 json({ text })을 모두 받아들인다. 모르는 필드는 무시한다 */
export function parseTranscript(body: unknown): SttTranscript {
  const root = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const text = typeof root.text === 'string' ? root.text.trim() : '';
  const rawSegments = Array.isArray(root.segments) ? root.segments : [];
  const segments: SttSegment[] = [];
  for (const raw of rawSegments) {
    if (typeof raw !== 'object' || raw === null) continue;
    const segment = raw as Record<string, unknown>;
    const segmentText = typeof segment.text === 'string' ? segment.text.trim() : '';
    if (segmentText) segments.push({ start: asNumber(segment.start), end: asNumber(segment.end), text: segmentText });
  }
  if (segments.length === 0 && text) segments.push({ start: null, end: null, text });
  const lastEnd = segments.length ? segments[segments.length - 1].end : null;
  return {
    text: text || segments.map((s) => s.text).join(' '),
    segments,
    durationSec: asNumber(root.duration) ?? lastEnd,
  };
}

/** 끝의 / 를 떼어 경로를 붙일 수 있게 한다 */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

async function errorMessageOf(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const json = JSON.parse(text) as { error?: string | { message?: string } };
    if (typeof json.error === 'string') return json.error;
    if (json.error?.message) return json.error.message;
  } catch {
    // JSON이 아니면 본문 앞부분을 그대로 보인다
  }
  return text.slice(0, 200) || res.statusText;
}
