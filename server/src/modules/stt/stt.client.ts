import { Injectable } from '@nestjs/common';

/** 긴 회의 녹음은 느린 엔진(VibeVoice 화자 분리 등)으로 돌리면 실시간보다 오래 걸릴 수 있다 */
const SIDECAR_MODELS = new Set(['whisper-pyannote', 'vibevoice']);
const TRANSCRIBE_TIMEOUT_MS = 60 * 60_000;
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
  /** 화자 분리 서버(tools/voice-sidecar)에만 보낸다. OpenAI는 모르는 칸을 거절할 수 있다 */
  speakerCount?: number;
}

export interface SttSegment {
  /** 초. 서버가 구간 시간을 주지 않으면 null */
  start: number | null;
  end: number | null;
  text: string;
  /** 화자 분리를 하는 서버(tools/voice-sidecar)만 준다. 없으면 null */
  speaker?: string | null;
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
    // Buffer를 그대로 넘긴다: new Uint8Array(buffer)는 한 벌 더 복사해 500MB 녹음이면 메모리가 크게 늘어난다 (Blob은 어차피 자기 몫을 복사한다)
    form.append('file', new Blob([input.audio as Uint8Array<ArrayBuffer>], { type: input.mimeType }), input.fileName);
    form.append('model', input.model || DEFAULT_MODEL);
    form.append('language', input.language ?? 'ko');
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    if (input.speakerCount && SIDECAR_MODELS.has(input.model ?? '')) form.append('num_speakers', String(input.speakerCount));

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
      throw new SttRequestError(connectFailureMessage(url, error));
    }
    if (res.status === 401 || res.status === 403) throw new SttRequestError('API 키가 맞지 않거나 권한이 없어요');
    if (res.status === 404) {
      throw new SttRequestError(`서버는 응답했지만 ${url} 경로가 없어요. 주소 끝이 …/v1인지, 이 서버가 OpenAI 호환 음성 인식(/audio/transcriptions)을 여는지 확인해 주세요`);
    }
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

/**
 * fetch 실패의 원인 코드(error.cause.code)로 이유를 나눈다. 같은 망·Tailscale 서버는 꺼짐·방화벽·주소 오타가 흔해서 한 문장으로 뭉뚱그리지 않는다.
 * 연결 시간 초과는 방화벽이 조용히 버리거나 PC가 꺼졌거나 Tailscale이 끊긴 경우다.
 */
export function connectFailureMessage(url: string, error: unknown): string {
  const code = causeCode(error);
  switch (code) {
    case 'ECONNREFUSED':
      return `${url}에서 연결을 거절했어요. 그 컴퓨터에서 음성 서버가 켜져 있는지, 포트가 맞는지 확인해 주세요${isLoopback(url) ? '' : '. 다른 PC라면 서버를 127.0.0.1이 아니라 0.0.0.0으로 띄워야 해요'}`;
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `${url}의 주소를 찾을 수 없어요. 주소 철자를 확인해 주세요. Tailscale 이름(…ts.net)이면 이 서버에서도 Tailscale이 켜져 있어야 해요`;
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
      return `${url}까지 길이 닿지 않아요. 그 컴퓨터가 켜져 있고 같은 망(또는 Tailscale)에 있는지, 방화벽이 포트를 막지 않는지 확인해 주세요`;
    case 'ERR_INVALID_URL':
      return `${url}은 올바른 주소가 아니에요`;
    default:
      if (code?.startsWith('ERR_TLS') || code?.startsWith('CERT_') || code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
        return `${url}의 보안(https) 인증서를 믿을 수 없어요. 사내 서버라면 http://로 시작하는 주소를 쓰거나 인증서를 확인해 주세요`;
      }
      return `${url}에 연결할 수 없어요. 음성 서버가 켜져 있는지, 주소가 맞는지 확인해 주세요`;
  }
}

function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '[::1]' || host.startsWith('127.');
  } catch {
    return false;
  }
}

function causeCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const cause = (error as { cause?: unknown }).cause;
  const source = typeof cause === 'object' && cause !== null ? cause : error;
  const code = (source as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
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
    if (!segmentText) continue;
    const speaker = typeof segment.speaker === 'string' && segment.speaker.trim() !== '' ? segment.speaker.trim() : null;
    segments.push({ start: asNumber(segment.start), end: asNumber(segment.end), text: segmentText, speaker });
  }
  if (segments.length === 0 && text) segments.push({ start: null, end: null, text, speaker: null });
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
