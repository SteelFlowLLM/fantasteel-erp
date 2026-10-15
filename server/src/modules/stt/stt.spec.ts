// DB 없이 도는 STT 단위 테스트: 응답 해석, WAV 머리글, 요청 형식, 오류 문구.
import { SttClient, SttRequestError, parseTranscript, silentWav } from './stt.client';

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
    expect((error as Error).message).toContain('Whisper 서버가 켜져 있는지');
  });

  it('서버 오류는 상태와 서버 메시지를 보이고, JSON이 아닌 본문은 읽을 수 없다고 한다', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'bad audio' } }), { status: 400 }));
    await expect(new SttClient().transcribe(endpoint, input)).rejects.toThrow('HTTP 400): bad audio');
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }));
    await expect(new SttClient().transcribe(endpoint, input)).rejects.toThrow('응답을 읽을 수 없어요');
  });
});
