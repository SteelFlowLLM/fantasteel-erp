// DB 없이 도는 철강맨 부르기 조각 받아쓰기 단위 테스트 (이슈 #457): 사원별 1분 횟수, 권한(로그인만), 짧은 조각 모델, 실패를 이유로 돌려주기.
import type { AuthUser } from '@fantasteel/shared';
import { IS_PUBLIC, REQUIRED_PERMISSION } from '../../common/auth/auth.decorators';
import { AppException } from '../../common/errors/app.exception';
import { SttClient, SttRequestError, quickModelOf } from './stt.client';
import { SttController } from './stt.controller';
import { SttService, type UploadedAudio } from './stt.service';
import type { SttSettingsStore } from './stt-settings.store';
import { SttWakeLimiter } from './stt-wake-limiter';

const user = (employeeId: number) => ({ employeeId }) as AuthUser;
const clip: UploadedAudio = { originalname: 'wake.wav', mimetype: 'audio/wav', buffer: Buffer.from('RIFF') };
const stored = { baseUrl: 'http://127.0.0.1:8001/v1', model: 'whisper-pyannote', apiKey: 'key' };

const setup = (transcribe: jest.Mock, limiter = new SttWakeLimiter()) => {
  const store = { read: jest.fn().mockResolvedValue(stored) } as unknown as SttSettingsStore;
  return new SttService(store, { transcribe } as unknown as SttClient, limiter);
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

  it('음성 서버에 닿지 않으면 오류가 아니라 이유를 돌려준다', async () => {
    const result = await setup(jest.fn().mockRejectedValue(new SttRequestError('연결할 수 없어요'))).transcribeWakeClip(user(1), clip);
    expect(result).toEqual({ text: null, error: '연결할 수 없어요' });
  });

  it('모르는 오류는 그대로 던진다 (500으로 남는다)', async () => {
    await expect(setup(jest.fn().mockRejectedValue(new Error('boom'))).transcribeWakeClip(user(1), clip)).rejects.toThrow('boom');
  });

  it('조각이 없거나 오디오가 아니면 COM-004', async () => {
    const service = setup(jest.fn());
    await expect(service.transcribeWakeClip(user(1), undefined)).rejects.toMatchObject({ code: 'COM-004' });
    await expect(service.transcribeWakeClip(user(1), { ...clip, mimetype: 'text/plain' })).rejects.toBeInstanceOf(AppException);
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

describe('POST stt/wake-clip 권한', () => {
  const handler = SttController.prototype.transcribeWakeClip;

  it('로그인만 본다: 공개 API가 아니고 설정 화면 권한(ORG_MANAGE)도 묻지 않는다', () => {
    expect(Reflect.getMetadata(IS_PUBLIC, handler)).toBeUndefined();
    expect(Reflect.getMetadata(REQUIRED_PERMISSION, handler)).toBeUndefined();
    expect(Reflect.getMetadata(REQUIRED_PERMISSION, SttController.prototype.testTranscribe)).toMatchObject({ permission: 'ORG_MANAGE' });
  });
});
