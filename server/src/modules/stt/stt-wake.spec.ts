// DB 없이 도는 철강맨 부르기 조각 받아쓰기 단위 테스트 (이슈 #457): 사원별 1분 횟수, 권한(로그인만), 짧은 조각 모델, 실패를 이유로 돌려주기.
import type { AuthUser } from '@fantasteel/shared';
import { IS_PUBLIC, REQUIRED_PERMISSION } from '../../common/auth/auth.decorators';
import { AppException } from '../../common/errors/app.exception';
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
