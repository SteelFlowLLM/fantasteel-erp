import { Injectable } from '@nestjs/common';
import type { SttConnectionTestInput, SttConnectionView, SttSettingsInput, SttSettingsView, SttTranscribeTestView } from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { SttClient, SttRequestError, normalizeBaseUrl } from './stt.client';
import { SttSettingsStore, type SttSettings } from './stt-settings.store';
import { redactUrl, sameOrigin } from './stt-url';

/** multer가 넘기는 업로드 파일 중 쓰는 값 */
export interface UploadedAudio {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

@Injectable()
export class SttService {
  constructor(
    private readonly store: SttSettingsStore,
    private readonly client: SttClient,
  ) {}

  async getSettings(): Promise<SttSettingsView> {
    return toView(await this.store.read());
  }

  async updateSettings(input: SttSettingsInput): Promise<SttSettingsView> {
    const current = await this.store.read();
    const next: SttSettings = {
      baseUrl: normalizeBaseUrl(input.baseUrl),
      model: input.model,
      apiKey: resolveApiKey(input.apiKey, current, input.baseUrl),
    };
    await this.store.write(next);
    return toView(next);
  }

  /** 저장하기 전 주소·모델로 무음 파일을 보내 연결을 확인한다. 실패도 오류가 아니라 결과로 돌려준다 */
  async testConnection(input: SttConnectionTestInput): Promise<SttConnectionView> {
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const current = await this.store.read();
    const apiKey = resolveApiKey(input.apiKey, current, baseUrl);
    const model = input.model === undefined ? current.model : input.model;
    const started = Date.now();
    try {
      await this.client.checkConnection({ baseUrl, apiKey }, model);
      return { connected: true, baseUrl: redactUrl(baseUrl), latencyMs: Date.now() - started, error: null };
    } catch (error) {
      return { connected: false, baseUrl: redactUrl(baseUrl), latencyMs: null, error: messageOf(error) };
    }
  }

  /** 저장된 설정으로 올린 오디오 파일을 글로 바꿔 본다 */
  async testTranscribe(file: UploadedAudio | undefined): Promise<SttTranscribeTestView> {
    if (!file) throw new AppException('COM-004', '시험할 오디오 파일을 골라 주세요 (file 필드)');
    if (!isAudio(file.mimetype)) throw new AppException('COM-004', '오디오 파일만 올릴 수 있어요');
    const settings = await this.store.read();
    const started = Date.now();
    try {
      const result = await this.client.transcribe(settings, {
        audio: file.buffer,
        fileName: decodeFileName(file.originalname),
        mimeType: file.mimetype,
        model: settings.model,
      });
      return { ok: true, text: result.text, segmentCount: result.segments.length, durationSec: result.durationSec, latencyMs: Date.now() - started, error: null };
    } catch (error) {
      return { ok: false, text: null, segmentCount: null, durationSec: null, latencyMs: null, error: messageOf(error) };
    }
  }
}

/** 브라우저 녹음은 video/webm으로 오는 경우가 있다 */
function isAudio(mimeType: string): boolean {
  return mimeType.startsWith('audio/') || mimeType === 'video/webm';
}

/** multer는 파일 이름을 latin1로 읽어서 한글이 깨진다 */
function decodeFileName(name: string): string {
  return Buffer.from(name, 'latin1').toString('utf8') || 'audio';
}

/**
 * 보내지 않은 키(undefined)는 저장된 키를 쓰되 저장된 주소와 출처가 같을 때만이다.
 * 주소를 다른 곳(OpenAI 키를 LAN·Tailscale 주소로 등)으로 바꾸면서 키를 비워 두면 저장된 키가 새 주소로 새어 나간다.
 */
function resolveApiKey(inputKey: string | undefined, current: SttSettings, baseUrl: string): string | null {
  if (inputKey !== undefined) return inputKey || null;
  return sameOrigin(normalizeBaseUrl(baseUrl), current.baseUrl) ? current.apiKey : null;
}

function toView(settings: SttSettings): SttSettingsView {
  return { baseUrl: settings.baseUrl, model: settings.model, hasApiKey: Boolean(settings.apiKey) };
}

function messageOf(error: unknown): string {
  if (error instanceof SttRequestError) return error.message;
  throw error;
}
