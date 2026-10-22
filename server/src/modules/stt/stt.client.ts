import { Injectable } from '@nestjs/common';
import { FormData, type Agent } from 'undici';
import type { SttModelOption } from '@fantasteel/shared';
import { createMetadataGuardedAgent, isBlockedLookupError, netFetch } from '../../common/net/guarded-agent';
import { isBlockedServerHost, redactUrl } from '../../common/net/server-url';

/** 긴 회의 녹음은 느린 엔진(VibeVoice 화자 분리 등)으로 돌리면 실시간보다 오래 걸릴 수 있다 */
const SIDECAR_MODELS = new Set(['whisper-pyannote', 'vibevoice']);
/**
 * 진행(조각 n/m)을 한 줄 JSON으로 보내 주는 사이드카 엔진 (이슈 #522). 'whisper'는 사이드카에만 있는 이름이다
 * (OpenAI는 whisper-1, whisper.cpp는 모델 이름과 모르는 칸을 무시한다)
 */
const SIDECAR_STREAM_MODELS = new Set(['whisper-pyannote', 'whisper', 'vibevoice']);
const NDJSON_TYPE = 'application/x-ndjson';
/** 모델 목록은 바로 와야 한다. 무음 확인은 whisper가 모델을 처음 올리는 동안 오래 걸릴 수 있다 */
const MODEL_LIST_TIMEOUT_MS = 10_000;
const MAX_MODEL_OPTIONS = 50;
const TRANSCRIBE_TIMEOUT_MS = 60 * 60_000;
const CONNECTION_TEST_TIMEOUT_MS = 90_000;
const DEFAULT_MODEL = 'whisper-1';
/**
 * 전역 fetch(undici)는 응답 헤더를 5분(300초) 안에 못 받으면 끊는다. 긴 회의는 서버가 다 받아쓴 뒤에야 응답을 시작해 5분이 넘기 쉽다.
 * 그래서 받아쓰기 요청에만 전용 Agent로 헤더·본문 대기를 전사 제한 시간에 맞춘다 (이슈 #485).
 * 우리 쪽 제한(AbortSignal)이 먼저 걸려 "N초 안에 응답이 없어요"가 나오도록 여유를 조금 더한다.
 */
const AGENT_TIMEOUT_MARGIN_MS = 10_000;
export function sttAgentOptions(timeoutMs: number): { headersTimeout: number; bodyTimeout: number } {
  const wait = timeoutMs + AGENT_TIMEOUT_MARGIN_MS;
  return { headersTimeout: wait, bodyTimeout: wait };
}
/** 사이드카의 받아쓰기만 하는 엔진. 화자 분리는 몇 초짜리 부르는 말에 필요 없고 느리다 */
const SIDECAR_QUICK_MODEL = 'whisper';

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
  /**
   * 화자 분리 서버(tools/voice-sidecar)에만 보낸다(OpenAI는 모르는 칸을 거절할 수 있다). 참석자 수를 최대 화자 수로 넘겨
   * 말하지 않은 참석자가 있어도 한 사람을 둘로 쪼개지 않게 한다 (이슈 #522)
   */
  maxSpeakers?: number;
  /** 용어 힌트(whisper initial prompt). whisper.cpp·OpenAI·사이드카 모두 받는다 (이슈 #522) */
  prompt?: string;
  /** 주면 사이드카에 진행을 함께 보내 달라고 한다(stream=progress). 다른 서버는 무시하고 한 번에 답한다 */
  onProgress?: (progress: SttProgress) => void;
}

/** 사이드카가 알려 주는 진행: 화자 나누기(회의 전체 한 번) → 받아쓰기(조각마다) */
export interface SttProgress {
  stage: 'diarize' | 'transcribe';
  /** 1부터 */
  current: number;
  total: number;
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

/** 철강맨 부르기처럼 짧은 조각에 쓸 모델: 사이드카의 화자 분리 엔진이면 받아쓰기만 하는 엔진으로 바꾼다 */
export function quickModelOf(model: string | null): string | null {
  return model !== null && SIDECAR_MODELS.has(model) ? SIDECAR_QUICK_MODEL : model;
}

/** 서버 주소(사설망·Tailscale)를 모르는 사원에게도 보여도 되는 연결 실패 문구 */
export const STT_CONNECT_PUBLIC_MESSAGE = '음성 서버에 연결할 수 없어요. 관리자에게 알려 주세요';

/**
 * 연결 실패 이유. message에는 설정을 맡은 관리자가 고칠 수 있게 주소가 들어 있고(철강맨 부르기·설정 화면),
 * 회의록처럼 모든 사원이 읽는 곳에는 주소가 없는 publicMessage를 쓴다 (이슈 #497). 주소가 없는 이유는 둘이 같다.
 */
export class SttRequestError extends Error {
  constructor(
    message: string,
    readonly publicMessage: string = message,
  ) {
    super(message);
  }
}

/** 저장할 때 막지만, 그 전에 저장된 주소·.env 주소도 클라우드 메타데이터로는 요청을 보내지 않는다 (이슈 #497) */
function assertAllowedHost(url: string): void {
  if (isBlockedServerHost(url)) throw new SttRequestError('음성 서버 주소가 링크 로컬·클라우드 메타데이터라 쓸 수 없어요. 주소를 바꿔 주세요', '음성 서버 설정에 문제가 있어요. 관리자에게 알려 주세요');
}

/**
 * OpenAI 호환 음성 인식 API 호출 (whisper.cpp whisper-server, 나중에 OpenAI 등).
 * LLM과 마찬가지로 브라우저가 아니라 서버가 부른다.
 */
@Injectable()
export class SttClient {
  /** 모델 목록처럼 짧은 요청이 같이 쓰는 연결용 Agent(메타데이터 주소로 풀리는 이름은 연결하지 않는다, 대기 시간은 undici 기본). 처음 부를 때 만든다 */
  private guardedAgent: Agent | undefined;

  async transcribe(endpoint: SttEndpoint, input: SttTranscribeInput, timeoutMs = TRANSCRIBE_TIMEOUT_MS): Promise<SttTranscript> {
    const url = `${redactUrl(normalizeBaseUrl(endpoint.baseUrl))}/audio/transcriptions`;
    assertAllowedHost(url);
    const form = new FormData();
    // Buffer를 그대로 넘긴다: new Uint8Array(buffer)는 한 벌 더 복사해 500MB 녹음이면 메모리가 크게 늘어난다 (Blob은 어차피 자기 몫을 복사한다)
    form.append('file', new Blob([input.audio as Uint8Array<ArrayBuffer>], { type: input.mimeType }), input.fileName);
    form.append('model', input.model || DEFAULT_MODEL);
    form.append('language', input.language ?? 'ko');
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    if (input.maxSpeakers && SIDECAR_MODELS.has(input.model ?? '')) form.append('max_speakers', String(input.maxSpeakers));
    if (input.prompt) form.append('prompt', input.prompt);
    if (input.onProgress && SIDECAR_STREAM_MODELS.has(input.model ?? '')) form.append('stream', 'progress');

    let res: Response;
    // 이 요청 하나만 쓰는 Agent: 응답 본문을 다 읽은 뒤(또는 실패하면 바로) 닫는다. 이름이 메타데이터 주소로 풀리면 연결하지 않는다 (이슈 #497)
    const agent = createMetadataGuardedAgent(sttAgentOptions(timeoutMs));
    try {
      try {
        res = await netFetch.run(url, {
          method: 'POST',
          headers: endpoint.apiKey ? { authorization: `Bearer ${endpoint.apiKey}` } : {},
          body: form,
          // 리다이렉트로 메타데이터 같은 다른 곳에 키·음성이 가지 않게 한다
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
          dispatcher: agent,
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'TimeoutError') {
          throw new SttRequestError(`${Math.round(timeoutMs / 1000)}초 안에 응답이 없어요. 음성 서버 상태를 확인해 주세요`);
        }
        throw new SttRequestError(connectFailureMessage(url, error), STT_CONNECT_PUBLIC_MESSAGE);
      }
      return await this.readTranscribeResponse(res, url, input.onProgress, timeoutMs);
    } finally {
      void agent.close().catch(() => undefined);
    }
  }

  private async readTranscribeResponse(res: Response, url: string, onProgress: SttTranscribeInput['onProgress'], timeoutMs: number): Promise<SttTranscript> {
    if (res.status === 401 || res.status === 403) throw new SttRequestError('API 키가 맞지 않거나 권한이 없어요');
    if (res.status === 404) {
      // OpenAI는 모델 이름이 틀려도 404(model_not_found)를 주므로 서버가 준 이유를 함께 보인다
      const reason = await errorMessageOf(res);
      throw new SttRequestError(
        `서버는 응답했지만 ${url}을 찾지 못했어요${reason ? ` (${reason})` : ''}. 주소 끝이 …/v1인지, 모델 이름이 맞는지, 이 서버가 OpenAI 호환 음성 인식(/audio/transcriptions)을 여는지 확인해 주세요`,
        '음성 서버가 받아쓰기 주소를 찾지 못했어요. 관리자에게 알려 주세요',
      );
    }
    if (!res.ok) throw new SttRequestError(`음성 인식 서버 오류 (HTTP ${res.status}): ${await errorMessageOf(res)}`);
    if (res.headers.get('content-type')?.includes(NDJSON_TYPE)) return parseTranscript(await readProgressStream(res, onProgress, timeoutMs));
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new SttRequestError('음성 인식 서버 응답을 읽을 수 없어요. OpenAI 호환 주소(…/v1)가 맞는지 확인해 주세요');
    }
    return parseTranscript(body);
  }

  /**
   * GET {baseUrl}/models. 화자 분리 사이드카·OpenAI는 주고 whisper.cpp 단독은 없다(404 → 빈 목록).
   * 닿지 않거나 키가 틀리면 바로 실패로 끝내 무음 확인까지 한 번 더 기다리지 않게 한다.
   */
  async listModels(endpoint: SttEndpoint): Promise<SttModelOption[]> {
    const url = `${redactUrl(normalizeBaseUrl(endpoint.baseUrl))}/models`;
    assertAllowedHost(url);
    let res: Response;
    try {
      res = await netFetch.run(url, {
        headers: endpoint.apiKey ? { authorization: `Bearer ${endpoint.apiKey}` } : {},
        redirect: 'error',
        signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS),
        dispatcher: (this.guardedAgent ??= createMetadataGuardedAgent()),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') return [];
      throw new SttRequestError(connectFailureMessage(url, error), STT_CONNECT_PUBLIC_MESSAGE);
    }
    if (res.status === 401 || res.status === 403) {
      throw new SttRequestError(endpoint.apiKey ? 'API 키가 맞지 않거나 권한이 없어요' : '이 음성 서버는 API 키가 필요해요. 음성 서버를 켠 터미널에 보이는 키를 넣어 주세요');
    }
    if (!res.ok) return [];
    try {
      return parseModelList(await res.json());
    } catch {
      return [];
    }
  }

  /**
   * 모델 목록을 받아 본 뒤 1초짜리 무음 WAV를 실제로 보내 본다 (목록만으로는 받아쓰기 엔진이 켜졌는지 모른다).
   * HTTP 성공이면 연결된 것이고 인식된 글이 비어도 괜찮다.
   */
  async checkConnection(endpoint: SttEndpoint, model: string | null): Promise<SttModelOption[]> {
    const models = await this.listModels(endpoint);
    await this.transcribe(
      endpoint,
      { audio: silentWav(), fileName: 'silence.wav', mimeType: 'audio/wav', model },
      CONNECTION_TEST_TIMEOUT_MS,
    );
    return models;
  }
}

/**
 * OpenAI 형식 { data: [{ id, … }] }. 사이드카는 label·diarization·available·note를 더 준다.
 * OpenAI처럼 음성과 상관없는 모델까지 주는 곳은 이름에 whisper·transcribe·asr·stt가 든 것만 남긴다.
 */
export function parseModelList(body: unknown): SttModelOption[] {
  const root = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const rows = Array.isArray(root.data) ? root.data : [];
  const options: SttModelOption[] = [];
  for (const raw of rows) {
    if (typeof raw !== 'object' || raw === null) continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.id !== 'string' || !row.id.trim()) continue;
    const label = typeof row.label === 'string' && row.label.trim() ? row.label.trim().slice(0, 100) : null;
    if (label === null && !/whisper|transcribe|asr|stt/i.test(row.id)) continue;
    options.push({
      id: row.id.trim().slice(0, 100),
      label,
      diarization: typeof row.diarization === 'boolean' ? row.diarization : null,
      available: typeof row.available === 'boolean' ? row.available : null,
      note: typeof row.note === 'string' && row.note.trim() ? row.note.trim().slice(0, 200) : null,
    });
    if (options.length >= MAX_MODEL_OPTIONS) break;
  }
  return options;
}

/**
 * fetch 실패의 원인 코드(error.cause.code)로 이유를 나눈다. 같은 망·Tailscale 서버는 꺼짐·방화벽·주소 오타가 흔해서 한 문장으로 뭉뚱그리지 않는다.
 * 연결 시간 초과는 방화벽이 조용히 버리거나 PC가 꺼졌거나 Tailscale이 끊긴 경우다.
 */
export function connectFailureMessage(url: string, error: unknown): string {
  const code = causeCode(error);
  if (isBlockedLookupError(error)) return `${url}의 이름이 링크 로컬·클라우드 메타데이터 주소로 풀려 연결하지 않았어요. 주소를 바꿔 주세요`;
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

const STREAM_CUT_MESSAGE = '음성 서버와 연결이 받아쓰는 도중에 끊겼어요';
const STREAM_CUT_PUBLIC_MESSAGE = '음성 서버와 연결이 받아쓰는 도중에 끊겼어요. 녹음을 다시 올려 주세요';

/**
 * 사이드카의 진행 응답(이슈 #522): 한 줄에 JSON 하나 — {type:'progress', stage, current, total} … {type:'result', result}.
 * 머리글을 보낸 뒤의 실패는 {type:'error', status, message} 줄로 온다. 결과 줄의 result를 돌려준다
 */
export async function readProgressStream(res: Response, onProgress: SttTranscribeInput['onProgress'], timeoutMs: number): Promise<unknown> {
  if (!res.body) throw new SttRequestError('음성 인식 서버 응답이 비어 있어요');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: { value: unknown } | null = null;
  for (;;) {
    let chunk: Awaited<ReturnType<typeof reader.read>>;
    try {
      chunk = await reader.read();
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new SttRequestError(`${Math.round(timeoutMs / 1000)}초 안에 받아쓰기가 끝나지 않았어요. 음성 서버 상태를 확인해 주세요`);
      }
      throw new SttRequestError(STREAM_CUT_MESSAGE, STREAM_CUT_PUBLIC_MESSAGE);
    }
    buffer += decoder.decode(chunk.value, { stream: !chunk.done });
    // 마지막 줄은 줄바꿈 없이 끝날 수 있어 다 받은 뒤에는 남은 글도 한 줄로 읽는다
    const lines = buffer.split('\n');
    buffer = chunk.done ? '' : (lines.pop() ?? '');
    for (const line of lines) result = progressLine(line, onProgress) ?? result;
    if (chunk.done) break;
  }
  if (result === null) throw new SttRequestError(STREAM_CUT_MESSAGE, STREAM_CUT_PUBLIC_MESSAGE);
  return result.value;
}

/** 진행 줄은 onProgress로 넘기고, 결과 줄이면 { value }를, 오류 줄이면 던진다. 모르는 줄은 버린다 */
function progressLine(line: string, onProgress: SttTranscribeInput['onProgress']): { value: unknown } | null {
  const text = line.trim();
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SttRequestError('음성 인식 서버 응답을 읽을 수 없어요');
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const row = parsed as Record<string, unknown>;
  if (row.type === 'result') return { value: row.result };
  if (row.type === 'error') {
    const message = typeof row.message === 'string' ? row.message.slice(0, 200) : '알 수 없는 오류';
    throw new SttRequestError(`음성 인식 서버 오류 (HTTP ${typeof row.status === 'number' ? row.status : 500}): ${message}`);
  }
  const current = asNumber(row.current);
  const total = asNumber(row.total);
  if (row.type === 'progress' && (row.stage === 'diarize' || row.stage === 'transcribe') && current !== null && total !== null && total >= 1) {
    try {
      onProgress?.({ stage: row.stage, current: Math.min(Math.max(1, Math.round(current)), Math.round(total)), total: Math.round(total) });
    } catch {
      // 진행 표시는 덤이다: 받는 쪽이 실패해도 받아쓰기는 이어 간다
    }
  }
  return null;
}

/** 끝의 / 를 떼어 경로를 붙일 수 있게 한다 */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

/** JSON 오류 메시지({ error: '…' } 또는 { error: { message } })만 보인다. 그 밖의 본문(HTML·내부 응답)은 화면에 내보내지 않는다 */
async function errorMessageOf(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const json = JSON.parse(text) as { error?: string | { message?: string } };
    const message = typeof json.error === 'string' ? json.error : json.error?.message;
    if (typeof message === 'string' && message) return message.slice(0, 200);
  } catch {
    // JSON이 아니면 상태 문구만 보인다
  }
  return res.statusText;
}
