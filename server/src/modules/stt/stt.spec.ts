// DB 없이 도는 STT 단위 테스트: 응답 해석, WAV 머리글, 요청 형식, 오류 문구, 연결 확인, 주소 검증.
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SttClient, SttRequestError, connectFailureMessage, parseTranscript, silentWav } from './stt.client';
import { TestSttConnectionDto, UpdateSttSettingsDto } from './dto/stt-settings.dto';
import { SttService } from './stt.service';
import { isBlockedSttHost, redactUrl } from './stt-url';
import type { SttSettingsStore } from './stt-settings.store';

const endpoint = { baseUrl: 'http://127.0.0.1:8000/v1/', apiKey: null };
const input = { audio: Buffer.from('abc'), fileName: '회의.webm', mimeType: 'audio/webm', model: null };

describe('parseTranscript', () => {
  it('OpenAI verbose_json: 구간 시간·길이를 읽고 빈 구간은 버린다', () => {
    const result = parseTranscript({
      text: ' 안녕하세요 방문합시다 ',
      duration: 12.5,
      segments: [
        { start: 0, end: 2.4, text: ' 안녕하세요 ' },
        { start: 2.4, end: 3, text: '   ' },
        { start: 3, end: 12.5, text: '방문합시다' },
      ],
    });
    expect(result).toEqual({
      text: '안녕하세요 방문합시다',
      segments: [
        { start: 0, end: 2.4, text: '안녕하세요', speaker: null },
        { start: 3, end: 12.5, text: '방문합시다', speaker: null },
      ],
      durationSec: 12.5,
    });
  });

  it('whisper.cpp verbose_json: 추가 필드를 무시하고, 길이가 없으면 마지막 구간 끝을 쓴다', () => {
    const result = parseTranscript({
      task: 'transcribe',
      language: 'korean',
      text: '네',
      segments: [{ id: 0, seek: 0, start: 0.5, end: 1.5, text: '네', tokens: [1, 2], temperature: 0, avg_logprob: -0.1, no_speech_prob: 0.01 }],
    });
    expect(result.segments).toEqual([{ start: 0.5, end: 1.5, text: '네', speaker: null }]);
    expect(result.durationSec).toBe(1.5);
  });

  it('단순 json: 구간 하나(시간 없음)로 만든다', () => {
    expect(parseTranscript({ text: ' 안녕 ' })).toEqual({ text: '안녕', segments: [{ start: null, end: null, text: '안녕', speaker: null }], durationSec: null });
  });

  it('화자 분리 서버(사이드카): speaker 문자열은 남기고 비었거나 문자열이 아니면 null', () => {
    const result = parseTranscript({
      text: '네 알겠습니다',
      duration: 6,
      segments: [
        { start: 0, end: 2, text: '네', speaker: 'SPEAKER_1' },
        { start: 2, end: 4, text: '알겠습니다', speaker: ' ' },
        { start: 4, end: 6, text: '좋아요', speaker: 3 },
      ],
    });
    expect(result.segments.map((s) => s.speaker)).toEqual(['SPEAKER_1', null, null]);
  });

  it('빈 응답: 글도 구간도 없다', () => {
    expect(parseTranscript({ text: '' })).toEqual({ text: '', segments: [], durationSec: null });
    expect(parseTranscript(null).segments).toEqual([]);
  });
});

describe('silentWav', () => {
  it('44바이트 머리글 + 1초(16kHz·16비트) 무음', () => {
    const wav = silentWav();
    expect(wav.length).toBe(44 + 32_000);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
    expect(wav.toString('ascii', 8, 16)).toBe('WAVEfmt ');
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readUInt32LE(28)).toBe(32_000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.toString('ascii', 36, 40)).toBe('data');
    expect(wav.readUInt32LE(40)).toBe(32_000);
    expect(wav.subarray(44).every((b) => b === 0)).toBe(true);
  });
});

describe('SttClient.transcribe', () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch');
  afterEach(() => fetchMock.mockReset());
  afterAll(() => fetchMock.mockRestore());

  it('multipart 필드·Bearer 헤더·주소를 맞게 만든다', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ text: '네' }), { status: 200 }));
    await new SttClient().transcribe({ ...endpoint, apiKey: 'sk-test' }, { ...input, model: 'whisper-1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8000/v1/audio/transcriptions');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ authorization: 'Bearer sk-test' });
    const form = init.body as FormData;
    expect(form.get('model')).toBe('whisper-1');
    expect(form.get('language')).toBe('ko');
    expect(form.get('response_format')).toBe('verbose_json');
    expect(form.get('temperature')).toBe('0');
    const file = form.get('file') as File;
    expect(file.name).toBe('회의.webm');
    expect(file.type).toBe('audio/webm');
    expect(file.size).toBe(3);
  });

  it('모델이 없으면 whisper-1을 보내고 키가 없으면 인증 헤더를 보내지 않는다', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ text: '' }), { status: 200 }));
    await new SttClient().transcribe(endpoint, input);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.body as FormData).get('model')).toBe('whisper-1');
    expect(init.headers).toEqual({});
  });

  it('화자 수는 화자 분리 서버 모델일 때만 보낸다 (OpenAI는 모르는 칸을 거절할 수 있다)', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ text: '' }), { status: 200 }));
    await new SttClient().transcribe(endpoint, { ...input, model: 'whisper-pyannote', speakerCount: 6 });
    await new SttClient().transcribe(endpoint, { ...input, model: 'whisper-1', speakerCount: 6 });
    const bodyOf = (call: number) => (fetchMock.mock.calls[call][1] as RequestInit).body as FormData;
    expect(bodyOf(0).get('num_speakers')).toBe('6');
    expect(bodyOf(1).get('num_speakers')).toBeNull();
  });

  it('401은 API 키 안내, 네트워크 실패는 서버 켜짐 안내', async () => {
    fetchMock.mockResolvedValueOnce(new Response('no', { status: 401 }));
    await expect(new SttClient().transcribe(endpoint, input)).rejects.toThrow('API 키가 맞지 않거나');
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const error = await new SttClient().transcribe(endpoint, input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SttRequestError);
    expect((error as Error).message).toContain('음성 서버가 켜져 있는지');
  });

  it('서버 오류는 상태와 서버 메시지를 보이고, JSON이 아닌 본문은 읽을 수 없다고 한다', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'bad audio' } }), { status: 400 }));
    await expect(new SttClient().transcribe(endpoint, input)).rejects.toThrow('HTTP 400): bad audio');
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }));
    await expect(new SttClient().transcribe(endpoint, input)).rejects.toThrow('응답을 읽을 수 없어요');
  });
});

/** 실패해야 하는 호출의 오류를 돌려준다 */
const failureOf = (promise: Promise<unknown>): Promise<Error> =>
  promise.then(
    () => {
      throw new Error('실패해야 하는 호출이 성공했어요');
    },
    (error: Error) => error,
  );

describe('연결 실패 이유', () => {
  const url = 'http://192.168.0.20:8000/v1/audio/transcriptions';
  const failure = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) });

  it('원인 코드별로 다른 안내를 준다', () => {
    expect(connectFailureMessage(url, failure('ECONNREFUSED'))).toContain('0.0.0.0');
    expect(connectFailureMessage('http://127.0.0.1:8000/v1/audio/transcriptions', failure('ECONNREFUSED'))).not.toContain('0.0.0.0');
    expect(connectFailureMessage(url, failure('ENOTFOUND'))).toContain('ts.net');
    expect(connectFailureMessage(url, failure('UND_ERR_CONNECT_TIMEOUT'))).toContain('방화벽');
    expect(connectFailureMessage(url, failure('EHOSTUNREACH'))).toContain('같은 망');
    expect(connectFailureMessage(url, failure('CERT_HAS_EXPIRED'))).toContain('인증서');
    expect(connectFailureMessage(url, new TypeError('fetch failed'))).toContain('주소가 맞는지');
  });

  it('404는 주소 끝 /v1 확인을 안내하고, 서버가 준 이유(모델 없음 포함)를 함께 보인다', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(new Response('<html>not found</html>', { status: 404, statusText: 'Not Found' }));
    const plain = await failureOf(new SttClient().checkConnection(endpoint, null));
    expect(plain.message).toContain('…/v1');
    expect(plain.message).not.toContain('<html>');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "The model 'whisper-9' does not exist", code: 'model_not_found' } }), { status: 404 }));
    const missing = await failureOf(new SttClient().checkConnection(endpoint, 'whisper-9'));
    expect(missing.message).toContain("The model 'whisper-9' does not exist");
    expect(missing.message).toContain('모델 이름이 맞는지');
    fetchMock.mockRestore();
  });

  it('리다이렉트는 따라가지 않고, 오류 문구에는 주소의 아이디·비밀번호가 없다', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const error = await failureOf(new SttClient().transcribe({ baseUrl: 'http://user:secret@192.168.0.20:8000/v1', apiKey: null }, input));
    expect((fetchMock.mock.calls[0][1] as RequestInit).redirect).toBe('error');
    expect(error.message).toContain('192.168.0.20');
    expect(error.message).not.toContain('secret');
    fetchMock.mockRestore();
  });
});

describe('SttService.testConnection', () => {
  const stored = { baseUrl: 'http://127.0.0.1:8000/v1', model: 'saved-model', apiKey: 'saved-key' };
  const setup = (check: jest.Mock) => {
    const store = { read: jest.fn().mockResolvedValue(stored) } as unknown as SttSettingsStore;
    return new SttService(store, { checkConnection: check } as unknown as SttClient);
  };

  it('화면에서 입력한 모델·키로 확인하고, 없으면 저장된 값을 쓴다', async () => {
    const check = jest.fn().mockResolvedValue(undefined);
    const service = setup(check);
    await service.testConnection({ baseUrl: 'http://100.101.102.103:8001/v1/', model: 'whisper-pyannote', apiKey: 'typed' });
    expect(check).toHaveBeenLastCalledWith({ baseUrl: 'http://100.101.102.103:8001/v1', apiKey: 'typed' }, 'whisper-pyannote');
    await service.testConnection({ baseUrl: 'http://127.0.0.1:8000/v1' });
    expect(check).toHaveBeenLastCalledWith({ baseUrl: 'http://127.0.0.1:8000/v1', apiKey: 'saved-key' }, 'saved-model');
    await service.testConnection({ baseUrl: 'http://127.0.0.1:8000/v1', model: null });
    expect(check).toHaveBeenLastCalledWith({ baseUrl: 'http://127.0.0.1:8000/v1', apiKey: 'saved-key' }, null);
  });

  it('저장된 키는 저장된 주소와 같은 출처로만 보낸다', async () => {
    const check = jest.fn().mockResolvedValue(undefined);
    const service = setup(check);
    await service.testConnection({ baseUrl: 'http://127.0.0.1:8000/v1/' });
    expect(check).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: 'saved-key' }), 'saved-model');
    await service.testConnection({ baseUrl: 'http://100.101.102.103:8001/v1' });
    expect(check).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: null }), 'saved-model');
    await service.testConnection({ baseUrl: 'http://100.101.102.103:8001/v1', apiKey: 'typed' });
    expect(check).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: 'typed' }), 'saved-model');
  });

  it('저장도 같다: 다른 출처로 바꾸며 키를 비워 두면 저장된 키를 버린다', async () => {
    const write = jest.fn().mockResolvedValue(undefined);
    const store = { read: jest.fn().mockResolvedValue(stored), write } as unknown as SttSettingsStore;
    const service = new SttService(store, {} as unknown as SttClient);
    await service.updateSettings({ baseUrl: 'http://127.0.0.1:8000/v1', model: null });
    expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: 'saved-key' }));
    await service.updateSettings({ baseUrl: 'http://192.168.0.20:8000/v1', model: null });
    expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: null }));
    const view = await service.updateSettings({ baseUrl: 'http://192.168.0.20:8000/v1', model: null, apiKey: 'new' });
    expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: 'new' }));
    expect(view.hasApiKey).toBe(true);
  });

  it('실패는 오류가 아니라 이유가 담긴 결과로 돌려준다', async () => {
    const result = await setup(jest.fn().mockRejectedValue(new SttRequestError('꺼져 있어요'))).testConnection({ baseUrl: 'http://127.0.0.1:8000/v1' });
    expect(result).toMatchObject({ connected: false, latencyMs: null, error: '꺼져 있어요' });
  });
});

describe('음성 서버 주소 검증', () => {
  const addressErrors = async (baseUrl: string) => (await validate(plainToInstance(UpdateSttSettingsDto, { baseUrl, model: null }))).filter((e) => e.property === 'baseUrl');

  it.each([
    'http://localhost:8000/v1',
    'http://127.0.0.1:8000/v1',
    'http://192.168.0.20:8000/v1',
    'http://10.1.2.3:8000/v1',
    'http://172.16.5.9:8001/v1',
    'http://100.64.0.1:8000/v1',
    'http://100.101.102.103:8001/v1',
    'http://my-pc.tail1234.ts.net:8000/v1',
    'https://api.openai.com/v1',
  ])('%s 은 받는다', async (url) => {
    expect(await addressErrors(url)).toEqual([]);
  });

  it.each([
    '192.168.0.20:8000/v1',
    'ftp://192.168.0.20/v1',
    'file:///etc/passwd',
    '',
    'http://user:pw@192.168.0.20:8000/v1',
    'http://169.254.169.254/latest/meta-data',
    'http://169.254.0.5:8000/v1',
    'http://2852039166/v1',
    'http://[::ffff:169.254.169.254]/v1',
    'http://[fe80::1]:8000/v1',
    'http://metadata.google.internal/v1',
  ])('%s 은 받지 않는다', async (url) => {
    expect(await addressErrors(url)).not.toEqual([]);
  });

  it('연결 확인 요청의 모델은 비어도 되고 100자를 넘으면 안 된다', async () => {
    const check = async (model: unknown) => (await validate(plainToInstance(TestSttConnectionDto, { baseUrl: 'http://127.0.0.1:8000/v1', model }))).length;
    expect(await check(undefined)).toBe(0);
    expect(await check('')).toBe(0);
    expect(await check(null)).toBe(0);
    expect(await check('x'.repeat(101))).toBeGreaterThan(0);
  });
});

describe('stt-url', () => {
  it('링크 로컬·메타데이터만 막고 사설망·Tailscale은 막지 않는다', () => {
    expect(isBlockedSttHost('http://169.254.169.254/')).toBe(true);
    expect(isBlockedSttHost('http://192.168.0.20:8000/v1')).toBe(false);
    expect(isBlockedSttHost('http://100.101.102.103:8001/v1')).toBe(false);
    expect(isBlockedSttHost('http://127.0.0.1:8000/v1')).toBe(false);
  });

  it('redactUrl은 아이디·비밀번호를 뺀다', () => {
    expect(redactUrl('http://user:pw@192.168.0.20:8000/v1')).toBe('http://192.168.0.20:8000/v1');
    expect(redactUrl('http://192.168.0.20:8000/v1')).toBe('http://192.168.0.20:8000/v1');
  });
});
