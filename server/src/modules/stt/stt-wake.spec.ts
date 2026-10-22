// DB 없이 도는 철강맨 부르기 조각 받아쓰기 단위 테스트 (이슈 #457): 사원별 1분 횟수, 권한(로그인만), 짧은 조각 모델, 실패를 이유로 돌려주기.
import type { AuthUser } from '@fantasteel/shared';
import { IS_PUBLIC, REQUIRED_PERMISSION } from '../../common/auth/auth.decorators';
import { AppException } from '../../common/errors/app.exception';
import { netFetch } from '../../common/net/guarded-agent';
import { SttClient, SttRequestError, quickModelOf, silentWav } from './stt.client';
import { SttController } from './stt.controller';
import { SttService, type UploadedAudio } from './stt.service';
import type { SttSettingsStore } from './stt-settings.store';
import { SttWakeLimiter } from './stt-wake-limiter';
import type { SteelmanWakeSettingsStore } from './steelman-wake-settings.store';

const user = (employeeId: number, permissions: AuthUser['permissions'] = {}) => ({ employeeId, permissions }) as AuthUser;
const clip: UploadedAudio = { originalname: 'wake.wav', mimetype: 'audio/wav', buffer: silentWav(2) };
const stored = { baseUrl: 'http://127.0.0.1:8001/v1', model: 'whisper-pyannote', apiKey: 'key' };

const wakeOn = { read: async () => ({ enabled: true, voiceApproval: false }) } as unknown as SteelmanWakeSettingsStore;

const setup = (transcribe: jest.Mock, limiter = new SttWakeLimiter(), wakeSettings = wakeOn) => {
  const store = { read: jest.fn().mockResolvedValue(stored) } as unknown as SttSettingsStore;
  return new SttService(store, { transcribe } as unknown as SttClient, limiter, wakeSettings);
};

describe('SttWakeLimiter', () => {
  it('사원마다 1분에 정한 횟수까지, 넘은 요청은 세지 않고 1분이 지나면 다시 된다', () => {
    const limiter = new SttWakeLimiter();
    limiter.perMinute = 2;
    expect(limiter.take(1, 0)).toBe(true);
    expect(limiter.take(1, 10_000)).toBe(true);
    expect(limiter.take(1, 20_000)).toBe(false);
    expect(limiter.take(2, 20_000)).toBe(true);
    expect(limiter.take(1, 59_999)).toBe(false);
    expect(limiter.take(1, 60_000)).toBe(true);
    expect(limiter.take(1, 65_000)).toBe(false);
    expect(limiter.take(1, 70_000)).toBe(true);
  });

  it('기본 한도는 1분 30번', () => {
    const limiter = new SttWakeLimiter();
    for (let i = 0; i < 30; i += 1) expect(limiter.take(7, 1000 + i)).toBe(true);
    expect(limiter.take(7, 2000)).toBe(false);
  });
});

describe('quickModelOf', () => {
  it('사이드카 화자 분리 엔진은 받아쓰기만 하는 엔진으로, 나머지는 그대로', () => {
    expect(quickModelOf('whisper-pyannote')).toBe('whisper');
    expect(quickModelOf('vibevoice')).toBe('whisper');
    expect(quickModelOf('whisper-1')).toBe('whisper-1');
    expect(quickModelOf(null)).toBeNull();
  });
});

describe('SttService.transcribeWakeClip', () => {
  it('저장된 주소·키로 짧은 시간 제한을 두고 보내고 글만 돌려준다', async () => {
    const transcribe = jest.fn().mockResolvedValue({ text: '철강맨 재고 알려줘', segments: [], durationSec: 2 });
    const result = await setup(transcribe).transcribeWakeClip(user(1), clip);
    expect(result).toEqual({ text: '철강맨 재고 알려줘', error: null });
    expect(transcribe).toHaveBeenCalledWith(stored, { audio: clip.buffer, fileName: 'wake.wav', mimeType: 'audio/wav', model: 'whisper' }, 20_000);
  });

  it('음성 서버에 닿지 않으면 오류가 아니라 이유를 돌려준다: 주소가 든 자세한 이유는 설정 권한(ORG_MANAGE USE)이 있는 사원에게만', async () => {
    const failing = () => setup(jest.fn().mockRejectedValue(new SttRequestError('http://100.87.40.116:8001/v1/audio/transcriptions에 연결할 수 없어요')));
    expect(await failing().transcribeWakeClip(user(1, { ORG_MANAGE: 'USE' }), clip)).toEqual({ text: null, error: 'http://100.87.40.116:8001/v1/audio/transcriptions에 연결할 수 없어요' });
    const plain = await failing().transcribeWakeClip(user(2, { ORG_MANAGE: 'VIEW' }), clip);
    expect(plain).toEqual({ text: null, error: '음성 서버에 연결할 수 없어요. 관리자에게 알려 주세요' });
  });

  it('음성 서버가 바쁘면(503·시간 초과) 꺼짐이 아니다: 명령 덩어리는 VOC-009(잠시 뒤 다시), 부르는 말 조각은 빈 글로 넘긴다 (#519)', async () => {
    // 바쁨은 SttClient가 만드는 오류 문구로 가리므로, 실제 SttClient가 만든 오류로 확인한다
    // SttClient는 전역 fetch가 아니라 netFetch.run(undici)으로 부른다
    const fetchMock = jest.spyOn(netFetch, 'run');
    const errorOf = async (): Promise<unknown> =>
      new SttClient().transcribe(stored, { audio: clip.buffer, fileName: 'wake.wav', mimeType: 'audio/wav', model: 'whisper' }, 20_000).then(
        () => null,
        (error: unknown) => error,
      );
    try {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: '지금 다른 녹음을 받아쓰는 중이에요' }), { status: 503 }));
      const busy = await errorOf();
      fetchMock.mockRejectedValueOnce(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
      const slow = await errorOf();
      for (const error of [busy, slow]) {
        expect(await setup(jest.fn().mockRejectedValue(error)).transcribeWakeClip(user(1), clip, 'wake')).toEqual({ text: null, error: null });
        for (const asker of [user(1), user(2, { ORG_MANAGE: 'USE' })]) {
          // 503이면 다시 보내므로 가짜 시계로 기다림을 건너뛴다
          jest.useFakeTimers();
          try {
            const settled = expect(setup(jest.fn().mockRejectedValue(error)).transcribeWakeClip(asker, clip, 'command')).rejects.toMatchObject({ code: 'VOC-009', message: expect.stringContaining('잠시 뒤 다시 불러 주세요') });
            await jest.advanceTimersByTimeAsync(4_000);
            await settled;
          } finally {
            jest.useRealTimers();
          }
        }
      }
      // 연결이 안 되는 것은 그대로 꺼짐(연결할 수 없어요)이다
      fetchMock.mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }) }));
      const down = await errorOf();
      expect(await setup(jest.fn().mockRejectedValue(down)).transcribeWakeClip(user(1), clip)).toEqual({ text: null, error: '음성 서버에 연결할 수 없어요. 관리자에게 알려 주세요' });
    } finally {
      fetchMock.mockRestore();
    }
  });

  describe('음성 서버가 다른 받아쓰기로 바쁠 때 (#519)', () => {
    const busy = new SttRequestError('음성 인식 서버 오류 (HTTP 503): 지금 다른 녹음을 받아쓰는 중이에요');
    const heard = (text: string) => ({ text, segments: [], durationSec: 1 });
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    it('명령 덩어리는 503이면 짧게 다시 보내 받아쓴다', async () => {
      const transcribe = jest.fn().mockRejectedValueOnce(busy).mockResolvedValueOnce(heard('첫 번째 카드 실행'));
      expect(await setup(transcribe).transcribeWakeClip(user(1), clip, 'command')).toEqual({ text: '첫 번째 카드 실행', error: null });
      expect(transcribe).toHaveBeenCalledTimes(2);
    });

    it('합계 4초 안에 다섯 번까지 다시 보내고, 그래도 바쁘면 VOC-009(잠시 뒤 다시)', async () => {
      jest.useFakeTimers();
      try {
        const transcribe = jest.fn().mockRejectedValue(busy);
        const settled = expect(setup(transcribe).transcribeWakeClip(user(1), clip, 'command')).rejects.toMatchObject({ code: 'VOC-009' });
        await jest.advanceTimersByTimeAsync(4_000);
        await settled;
        expect(transcribe).toHaveBeenCalledTimes(6);
      } finally {
        jest.useRealTimers();
      }
    });

    it('429(외부 서버 할당량 소진일 수 있음)는 바쁨이 아니라 다시 보내지 않고 이유로 돌려준다', async () => {
      const quota = jest.fn().mockRejectedValue(new SttRequestError('음성 인식 서버 오류 (HTTP 429): You exceeded your current quota'));
      expect(await setup(quota).transcribeWakeClip(user(1), clip, 'command')).toEqual({ text: null, error: '음성 서버에 연결할 수 없어요. 관리자에게 알려 주세요' });
      expect(quota).toHaveBeenCalledTimes(1);
      expect(await setup(quota).transcribeWakeClip(user(2, { ORG_MANAGE: 'USE' }), clip, 'command')).toEqual({ text: null, error: expect.stringContaining('HTTP 429') });
    });

    it('부르는 말 조각·중간 글은 다시 보내지 않고 빈 글로 조용히 넘긴다 (회의 전사 중 주변 말마다 안내가 되풀이되지 않게)', async () => {
      for (const mode of ['wake', 'partial'] as const) {
        const transcribe = jest.fn().mockRejectedValue(busy);
        expect(await setup(transcribe).transcribeWakeClip(user(1), clip, mode)).toEqual({ text: null, error: null });
        expect(transcribe).toHaveBeenCalledTimes(1);
      }
    });

    it('같은 사원의 중간 글을 받아쓰는 중이면 명령 조각은 그것이 끝난 뒤 보낸다', async () => {
      let finishPartial: (value: unknown) => void = () => undefined;
      const transcribe = jest
        .fn()
        .mockImplementationOnce(() => new Promise((resolve) => (finishPartial = resolve)))
        .mockResolvedValueOnce(heard('첫 번째 카드 실행'));
      const service = setup(transcribe);
      const partial = service.transcribeWakeClip(user(1), clip, 'partial');
      while (transcribe.mock.calls.length === 0) await flush();
      const command = service.transcribeWakeClip(user(1), clip, 'command');
      for (let i = 0; i < 5; i += 1) await flush();
      expect(transcribe).toHaveBeenCalledTimes(1);
      finishPartial(heard('첫 번째'));
      expect(await partial).toEqual({ text: '첫 번째', error: null });
      expect(await command).toEqual({ text: '첫 번째 카드 실행', error: null });
      expect(transcribe).toHaveBeenCalledTimes(2);
    });

    it('중간 글이 멈춰 있으면 명령 덩어리는 4초까지만 기다리고 보낸다', async () => {
      jest.useFakeTimers();
      try {
        const transcribe = jest
          .fn()
          .mockImplementationOnce(() => new Promise(() => undefined))
          .mockResolvedValueOnce(heard('첫 번째 카드 실행'));
        const service = setup(transcribe);
        void service.transcribeWakeClip(user(1), clip, 'partial');
        await jest.advanceTimersByTimeAsync(0);
        expect(transcribe).toHaveBeenCalledTimes(1);
        const command = service.transcribeWakeClip(user(1), clip, 'command');
        await jest.advanceTimersByTimeAsync(3_900);
        expect(transcribe).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(200);
        expect(await command).toEqual({ text: '첫 번째 카드 실행', error: null });
        expect(transcribe).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  it('모르는 오류는 그대로 던진다 (500으로 남는다)', async () => {
    await expect(setup(jest.fn().mockRejectedValue(new Error('boom'))).transcribeWakeClip(user(1), clip)).rejects.toThrow('boom');
  });

  it('조각이 없거나 PCM WAV가 아니거나 8초를 넘으면 음성 서버에 보내지 않고 COM-004', async () => {
    const transcribe = jest.fn();
    const service = setup(transcribe);
    await expect(service.transcribeWakeClip(user(1), undefined)).rejects.toMatchObject({ code: 'COM-004' });
    // 이름표는 audio/wav여도 바이트가 WAV가 아니면 거절한다
    await expect(service.transcribeWakeClip(user(1), { ...clip, buffer: Buffer.from('OggS'.padEnd(64, 'x')) })).rejects.toBeInstanceOf(AppException);
    await expect(service.transcribeWakeClip(user(1), { ...clip, buffer: silentWav(9) })).rejects.toMatchObject({ code: 'COM-004' });
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('한도를 넘으면 음성 서버에 보내지 않고 VOC-009(429)', async () => {
    const transcribe = jest.fn().mockResolvedValue({ text: '', segments: [], durationSec: null });
    const limiter = new SttWakeLimiter();
    limiter.perMinute = 1;
    const service = setup(transcribe, limiter);
    await service.transcribeWakeClip(user(1), clip);
    await expect(service.transcribeWakeClip(user(1), clip)).rejects.toMatchObject({ code: 'VOC-009' });
    expect(transcribe).toHaveBeenCalledTimes(1);
  });
});

describe('명령 덩어리·중간 글 (이슈 #494)', () => {
  const ok = () => jest.fn().mockResolvedValue({ text: '재고 알려줘', segments: [], durationSec: null });

  it('command는 30초까지 받고, wake는 그대로 8초까지', async () => {
    const transcribe = ok();
    const service = setup(transcribe);
    await expect(service.transcribeWakeClip(user(1), { ...clip, buffer: silentWav(20) }, 'command')).resolves.toEqual({ text: '재고 알려줘', error: null });
    await expect(service.transcribeWakeClip(user(1), { ...clip, buffer: silentWav(20) })).rejects.toMatchObject({ code: 'COM-004' });
    await expect(service.transcribeWakeClip(user(1), { ...clip, buffer: silentWav(31) }, 'command')).rejects.toMatchObject({ code: 'COM-004' });
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it('wake 조각은 크기도 512KB까지만 받는다 (multer는 가장 큰 종류에 맞춰 받는다)', async () => {
    await expect(setup(ok()).transcribeWakeClip(user(1), { ...clip, buffer: Buffer.concat([silentWav(1), Buffer.alloc(600 * 1024)]) })).rejects.toMatchObject({ code: 'COM-004' });
  });

  it('중간 글(partial)은 따로 세어 명령·부르는 말 횟수를 깎지 않는다', async () => {
    const limiter = new SttWakeLimiter();
    limiter.perMinute = 1;
    const service = setup(ok(), limiter);
    for (let i = 0; i < 5; i += 1) await service.transcribeWakeClip(user(1), clip, 'partial');
    await expect(service.transcribeWakeClip(user(1), clip, 'command')).resolves.toMatchObject({ error: null });
    await expect(service.transcribeWakeClip(user(1), clip)).rejects.toMatchObject({ code: 'VOC-009' });
  });
});

describe('철강맨 부르기 회사 설정', () => {
  it('관리자가 끄면 조각을 받지 않고(VOC-011) 한도도 세지 않는다', async () => {
    const transcribe = jest.fn();
    const limiter = new SttWakeLimiter();
    const off = { read: async () => ({ enabled: false, voiceApproval: false }) } as unknown as SteelmanWakeSettingsStore;
    await expect(setup(transcribe, limiter, off).transcribeWakeClip(user(1), clip)).rejects.toMatchObject({ code: 'VOC-011' });
    expect(transcribe).not.toHaveBeenCalled();
    limiter.perMinute = 1;
    expect(limiter.take(1)).toBe(true);
  });

  it('GET·PUT stt/wake-settings는 음성 설정과 같은 권한(ORG_MANAGE VIEW·USE)', () => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSION, SttController.prototype.getWakeSettings)).toEqual({ permission: 'ORG_MANAGE', level: 'VIEW' });
    expect(Reflect.getMetadata(REQUIRED_PERMISSION, SttController.prototype.updateWakeSettings)).toEqual({ permission: 'ORG_MANAGE', level: 'USE' });
  });
});

describe('POST stt/wake-clip 권한', () => {
  const handler = SttController.prototype.transcribeWakeClip;

  it('로그인만 본다: 공개 API가 아니고 설정 화면 권한(ORG_MANAGE)도 묻지 않는다', () => {
    expect(Reflect.getMetadata(IS_PUBLIC, handler)).toBeUndefined();
    expect(Reflect.getMetadata(REQUIRED_PERMISSION, handler)).toBeUndefined();
    expect(Reflect.getMetadata(REQUIRED_PERMISSION, SttController.prototype.testTranscribe)).toMatchObject({ permission: 'ORG_MANAGE' });
  });
});
