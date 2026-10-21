import { Injectable, Logger } from '@nestjs/common';
import { PERMISSION, STT_WAKE_CLIP_LIMITS, wakeClipLimitOf, type AuthUser, type SttWakeClipMode, type SteelmanWakeSettingsInput, type SteelmanWakeSettingsView, type SttConnectionTestInput, type SttConnectionView, type SttSettingsInput, type SttSettingsView, type SttTranscribeTestView, type SttWakeClipView } from '@fantasteel/shared';
import { hasPermission } from '../../common/auth/auth.guard';
import { AppException } from '../../common/errors/app.exception';
import { STT_CONNECT_PUBLIC_MESSAGE, SttClient, SttRequestError, normalizeBaseUrl, quickModelOf } from './stt.client';
import { SttSettingsStore, type SttSettings } from './stt-settings.store';
import { wakeClipProblem } from './stt-wake-clip';
import { SttWakeLimiter } from './stt-wake-limiter';
import { SteelmanWakeSettingsStore } from './steelman-wake-settings.store';
import { redactUrl, sameOrigin } from '../../common/net/server-url';

/** 음성 서버 주소·Tailscale 이름·서버가 준 오류는 설정을 맡은 사람에게만 보인다 */
const WAKE_SERVER_DOWN = STT_CONNECT_PUBLIC_MESSAGE;

/** 부르는 말 조각은 몇 초라 이보다 오래 걸리면 음성 서버가 바쁘거나 막힌 것이다 */
const WAKE_CLIP_TIMEOUT_MS = 20_000;

/** 음성 서버가 다른 받아쓰기로 바쁠 때(사이드카 503·시간 초과). 꺼진 것이 아니라 잠시 뒤 다시 부르면 된다 (#519) */
const WAKE_SERVER_BUSY = '음성 서버가 바빠 이번 말은 받아쓰지 못했어요(다른 녹음을 받아쓰는 중일 수 있어요). 잠시 뒤 다시 불러 주세요';
/** SttClient가 상태 코드를 따로 주지 않아 그 오류 문구로 가린다 (stt-wake.spec이 실제 SttClient 오류로 확인한다) */
const BUSY_FAILURE = /\(HTTP (?:429|503)\)|초 안에 응답이 없어요/;
const BUSY_REPLY = /\(HTTP (?:429|503)\)/;
/**
 * 명령·부르는 말 조각은 놓치면 말한 명령이 사라진다. 사이드카는 받아쓰기를 하나씩만 받아, 같은 사람의 중간 글이 끝나기 전에 온
 * 짧은 명령("첫 번째 카드 실행")이 늘 503으로 거절됐다 (#519). 바쁘다고 답하면 짧게 몇 번(합계 4초 안) 다시 보낸다.
 * 중간 글은 보이기만 하고 다시 보내면 더 겹치므로 다시 보내지 않는다
 */
const BUSY_RETRY_DELAYS_MS = [400, 600, 800, 800, 800];
/** 같은 사원의 중간 글이 받아쓰는 중이면 명령·부르는 말 조각은 그것이 끝날 때까지(이만큼까지) 기다렸다 보낸다 */
const PARTIAL_WAIT_MAX_MS = 4_000;

/** multer가 넘기는 업로드 파일 중 쓰는 값 */
export interface UploadedAudio {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

@Injectable()
export class SttService {
  private readonly logger = new Logger(SttService.name);
  /** 중간 글(partial) 횟수. 명령 덩어리·부르는 말 조각과 따로 센다 (이슈 #494) */
  private readonly partialLimiter = Object.assign(new SttWakeLimiter(), { perMinute: STT_WAKE_CLIP_LIMITS.partialPerMinute });
  /** 사원별로 받아쓰는 중인 중간 글 (서버는 한 프로세스라 메모리로 충분하다, SERVER-GUIDE 9장) */
  private readonly partialsInFlight = new Map<number, Promise<unknown>>();

  constructor(
    private readonly store: SttSettingsStore,
    private readonly client: SttClient,
    private readonly wakeLimiter: SttWakeLimiter = new SttWakeLimiter(),
    private readonly wakeSettings: SteelmanWakeSettingsStore = new SteelmanWakeSettingsStore(),
  ) {}

  getWakeSettings(): Promise<SteelmanWakeSettingsView> {
    return this.wakeSettings.read();
  }

  updateWakeSettings(input: SteelmanWakeSettingsInput): Promise<SteelmanWakeSettingsView> {
    return this.wakeSettings.write(input);
  }

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
   * 음성 서버가 바쁘면(503·시간 초과) 꺼짐으로 남기지 않게 VOC-009(잠시 뒤 다시)로 알린다: 화면은 띠에 문제로 두지 않고 잠깐 안내한다.
   * 명령·부르는 말 조각은 같은 사원의 중간 글이 끝난 뒤 보내고, 그래도 503이면 짧게 몇 번 다시 보낸다 (#519)
   */
  /**
   * mode(이슈 #494): wake는 부르는 말을 찾는 8초 조각, command는 "철강맨" 뒤 명령 한 덩어리(30초), partial은 명령을 말하는 동안 보이기만 할 중간 글.
   * partial은 따로 세어(1분 40번) 명령 덩어리의 횟수를 깎지 않는다. 어느 쪽도 소리·글을 저장하지 않는다
   */
  async transcribeWakeClip(user: AuthUser, file: UploadedAudio | undefined, mode: SttWakeClipMode = 'wake'): Promise<SttWakeClipView> {
    // 관리자가 회사 전체로 끈 뒤에도 켜 둔 화면이 보내는 조각은 세지도 받아쓰지도 않는다
    if (!(await this.wakeSettings.read()).enabled) throw new AppException('VOC-011');
    const limiter = mode === 'partial' ? this.partialLimiter : this.wakeLimiter;
    if (!limiter.take(user.employeeId)) throw new AppException('VOC-009');
    if (!file) throw new AppException('COM-004', '말소리 조각이 없어요 (file 필드)');
    const limit = wakeClipLimitOf(mode);
    if (file.buffer.length > limit.maxBytes) throw new AppException('COM-004', `말소리 조각이 너무 커요 (${Math.round(limit.maxBytes / 1024)}KB까지)`);
    const problem = wakeClipProblem(file.buffer, limit.maxSeconds);
    if (problem) throw new AppException('COM-004', problem);
    const settings = await this.store.read();
    const input = { audio: file.buffer, fileName: 'wake.wav', mimeType: 'audio/wav', model: quickModelOf(settings.model) };
    const retryDelays = mode === 'partial' ? [] : BUSY_RETRY_DELAYS_MS;
    if (mode !== 'partial') await this.partialDone(user.employeeId);
    for (let attempt = 0; ; attempt += 1) {
      try {
        const pending = this.client.transcribe(settings, input, WAKE_CLIP_TIMEOUT_MS);
        if (mode === 'partial') this.trackPartial(user.employeeId, pending);
        const result = await pending;
        return { text: result.text, error: null };
      } catch (error) {
        const detail = messageOf(error);
        const retryDelay = BUSY_REPLY.test(detail) ? retryDelays[attempt] : undefined;
        if (retryDelay !== undefined) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          continue;
        }
        this.logger.warn(`철강맨 부르기 받아쓰기 실패 (사원 ${user.employeeId}): ${detail}`);
        if (BUSY_FAILURE.test(detail)) throw new AppException('VOC-009', WAKE_SERVER_BUSY);
        return { text: null, error: hasPermission(user, { permission: PERMISSION.ORG_MANAGE, level: 'USE' }) ? detail : WAKE_SERVER_DOWN };
      }
    }
  }

  private trackPartial(employeeId: number, pending: Promise<unknown>): void {
    this.partialsInFlight.set(employeeId, pending);
    const forget = () => {
      if (this.partialsInFlight.get(employeeId) === pending) this.partialsInFlight.delete(employeeId);
    };
    pending.then(forget, forget);
  }

  /** 같은 사원의 중간 글 받아쓰기가 끝나길 기다린다 (실패해도, 너무 오래면 그냥 보낸다) */
  private async partialDone(employeeId: number): Promise<void> {
    const pending = this.partialsInFlight.get(employeeId);
    if (!pending) return;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([pending.then(() => undefined, () => undefined), new Promise<void>((resolve) => (timer = setTimeout(resolve, PARTIAL_WAIT_MAX_MS)))]);
    clearTimeout(timer);
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
