import { Injectable, Logger } from '@nestjs/common';
import { PERMISSION, type AuthUser, type SttConnectionTestInput, type SttConnectionView, type SttSettingsInput, type SttSettingsView, type SttTranscribeTestView, type SttWakeClipView } from '@fantasteel/shared';
import { hasPermission } from '../../common/auth/auth.guard';
import { AppException } from '../../common/errors/app.exception';
import { SttClient, SttRequestError, normalizeBaseUrl, quickModelOf } from './stt.client';
import { SttSettingsStore, type SttSettings } from './stt-settings.store';
import { wakeClipProblem } from './stt-wake-clip';
import { SttWakeLimiter } from './stt-wake-limiter';
import { redactUrl, sameOrigin } from './stt-url';

/** 음성 서버 주소·Tailscale 이름·서버가 준 오류는 설정을 맡은 사람에게만 보인다 */
const WAKE_SERVER_DOWN = '음성 서버에 연결할 수 없어요. 관리자에게 알려 주세요';

/** 부르는 말 조각은 몇 초라 이보다 오래 걸리면 음성 서버가 바쁘거나 막힌 것이다 */
const WAKE_CLIP_TIMEOUT_MS = 20_000;

/** multer가 넘기는 업로드 파일 중 쓰는 값 */
export interface UploadedAudio {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

@Injectable()
export class SttService {
  private readonly logger = new Logger(SttService.name);

  constructor(
    private readonly store: SttSettingsStore,
    private readonly client: SttClient,
    private readonly wakeLimiter: SttWakeLimiter = new SttWakeLimiter(),
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
      const models = await this.client.checkConnection({ baseUrl, apiKey }, model);
      return { connected: true, baseUrl: redactUrl(baseUrl), latencyMs: Date.now() - started, error: null, models };
    } catch (error) {
      return { connected: false, baseUrl: redactUrl(baseUrl), latencyMs: null, error: messageOf(error), models: [] };
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

  /**
   * 철강맨 부르기 (이슈 #457): 말소리 조각(PCM WAV, 8초까지) 하나를 글로 바꿔 돌려준다. 소리도 글도 저장·로그하지 않는다
   * (부르는 말이 없는 글은 화면이 바로 버린다). 음성 서버에 닿지 않으면 오류가 아니라 이유를 돌려줘 화면이 스위치에 알린다.
   * 자세한 이유(주소 등)는 설정 권한(ORG_MANAGE USE)이 있는 사원에게만, 나머지는 서버 기록으로 남긴다.
   */
  async transcribeWakeClip(user: AuthUser, file: UploadedAudio | undefined): Promise<SttWakeClipView> {
    if (!this.wakeLimiter.take(user.employeeId)) throw new AppException('VOC-009');
    if (!file) throw new AppException('COM-004', '말소리 조각이 없어요 (file 필드)');
    const problem = wakeClipProblem(file.buffer);
    if (problem) throw new AppException('COM-004', problem);
    const settings = await this.store.read();
    try {
      const result = await this.client.transcribe(
        settings,
        { audio: file.buffer, fileName: 'wake.wav', mimeType: 'audio/wav', model: quickModelOf(settings.model) },
        WAKE_CLIP_TIMEOUT_MS,
      );
      return { text: result.text, error: null };
    } catch (error) {
      const detail = messageOf(error);
      this.logger.warn(`철강맨 부르기 받아쓰기 실패 (사원 ${user.employeeId}): ${detail}`);
      return { text: null, error: hasPermission(user, { permission: PERMISSION.ORG_MANAGE, level: 'USE' }) ? detail : WAKE_SERVER_DOWN };
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
