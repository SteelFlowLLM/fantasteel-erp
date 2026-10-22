// DB 없이 도는 STT 단위 테스트: 응답 해석, WAV 머리글, 요청 형식, 오류 문구, 연결 확인, 주소 검증.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Agent } from 'undici';
import * as guardedAgent from '../../common/net/guarded-agent';
import { netFetch } from '../../common/net/guarded-agent';
import { SttClient, SttRequestError, connectFailureMessage, parseModelList, parseTranscript, silentWav, sttAgentOptions } from './stt.client';
import { TestSttConnectionDto, UpdateSttSettingsDto } from './dto/stt-settings.dto';
import { SttService } from './stt.service';
import type { SttSettingsStore } from './stt-settings.store';

/** 아래 describe들이 fetch를 가로채기 전의 실제 fetch (실제 서버로 부르는 시험용) */
const realFetch = netFetch.run;
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
  const fetchMock = jest.spyOn(netFetch, 'run');
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

  it('화자 수는 화자 분리 서버 모델일 때만 최대 화자 수로 보낸다 (OpenAI는 모르는 칸을 거절할 수 있다, 이슈 #522)', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ text: '' }), { status: 200 }));
    await new SttClient().transcribe(endpoint, { ...input, model: 'whisper-pyannote', maxSpeakers: 6 });
    await new SttClient().transcribe(endpoint, { ...input, model: 'whisper-1', maxSpeakers: 6 });
    const bodyOf = (call: number) => (fetchMock.mock.calls[call][1] as RequestInit).body as FormData;
    expect(bodyOf(0).get('max_speakers')).toBe('6');
    expect(bodyOf(0).get('num_speakers')).toBeNull();
    expect(bodyOf(1).get('max_speakers')).toBeNull();
  });

  it('용어 힌트는 prompt로 어느 서버에나 보내고, 진행은 사이드카 모델에만 stream=progress로 청한다 (이슈 #522)', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ text: '' }), { status: 200 }));
    const onProgress = jest.fn();
    await new SttClient().transcribe(endpoint, { ...input, model: 'whisper-1', prompt: '강종 SM355B', onProgress });
    await new SttClient().transcribe(endpoint, { ...input, model: 'whisper', prompt: '강종 SM355B', onProgress });
    await new SttClient().transcribe(endpoint, { ...input, model: 'whisper-pyannote' });
    const bodyOf = (call: number) => (fetchMock.mock.calls[call][1] as RequestInit).body as FormData;
    expect(bodyOf(0).get('prompt')).toBe('강종 SM355B');
    expect(bodyOf(0).get('stream')).toBeNull();
    expect(bodyOf(1).get('stream')).toBe('progress');
    // 진행을 받을 곳이 없으면 청하지 않는다
    expect(bodyOf(2).get('stream')).toBeNull();
    expect(bodyOf(2).get('prompt')).toBeNull();
  });

  describe('사이드카 진행 응답 (NDJSON, 이슈 #522)', () => {
    const ndjson = (lines: string[], chunkAt?: number) => {
      const text = lines.join('\n');
      const encoder = new TextEncoder();
      // 줄 가운데에서 끊어 보내도 이어 읽는지 본다
      const parts = chunkAt === undefined ? [text] : [text.slice(0, chunkAt), text.slice(chunkAt)];
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const part of parts) controller.enqueue(encoder.encode(part));
          controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson; charset=utf-8' } });
    };
    const result = { text: '안녕하세요', duration: 12.5, segments: [{ id: 0, start: 0, end: 2, text: '안녕하세요', speaker: 'SPEAKER_1' }] };

    it('진행 줄을 차례로 알리고 결과 줄을 전사로 바꾼다', async () => {
      const lines = [
        JSON.stringify({ type: 'progress', stage: 'diarize', current: 1, total: 1 }),
        JSON.stringify({ type: 'progress', stage: 'transcribe', current: 1, total: 3 }),
        JSON.stringify({ type: 'progress', stage: 'transcribe', current: 2, total: 3 }),
        JSON.stringify({ type: 'result', result }),
      ];
      fetchMock.mockResolvedValueOnce(ndjson(lines, 37));
      const onProgress = jest.fn();
      const transcript = await new SttClient().transcribe(endpoint, { ...input, model: 'whisper-pyannote', onProgress });
      expect(onProgress.mock.calls.map(([p]) => p)).toEqual([
        { stage: 'diarize', current: 1, total: 1 },
        { stage: 'transcribe', current: 1, total: 3 },
        { stage: 'transcribe', current: 2, total: 3 },
      ]);
      expect(transcript).toEqual({ text: '안녕하세요', durationSec: 12.5, segments: [{ start: 0, end: 2, text: '안녕하세요', speaker: 'SPEAKER_1' }] });
    });

    it('오류 줄은 서버 오류로, 결과 없이 끝나면 끊겼다고 알린다', async () => {
      fetchMock.mockResolvedValueOnce(ndjson([JSON.stringify({ type: 'progress', stage: 'transcribe', current: 1, total: 2 }), JSON.stringify({ type: 'error', status: 502, message: 'whisper 서버 오류' })]));
      await expect(new SttClient().transcribe(endpoint, { ...input, model: 'whisper', onProgress: jest.fn() })).rejects.toThrow('HTTP 502): whisper 서버 오류');
      fetchMock.mockResolvedValueOnce(ndjson([JSON.stringify({ type: 'progress', stage: 'transcribe', current: 1, total: 2 })]));
      const error = await new SttClient().transcribe(endpoint, { ...input, model: 'whisper', onProgress: jest.fn() }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SttRequestError);
      expect((error as SttRequestError).publicMessage).toContain('녹음을 다시 올려 주세요');
    });

    it('진행을 받는 쪽이 실패해도 받아쓰기는 끝까지 읽는다', async () => {
      fetchMock.mockResolvedValueOnce(ndjson([JSON.stringify({ type: 'progress', stage: 'transcribe', current: 1, total: 1 }), JSON.stringify({ type: 'result', result })]));
      const transcript = await new SttClient().transcribe(endpoint, {
        ...input,
        model: 'whisper',
        onProgress: () => {
          throw new Error('DB 끊김');
        },
      });
      expect(transcript.text).toBe('안녕하세요');
    });
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

describe('SttClient.transcribe 긴 전사의 대기 시간 (이슈 #485)', () => {
  // 앞 describe의 afterAll(mockRestore)가 먼저 가로채기를 풀어서 이 describe는 실행 직전에 새로 가로챈다
  let fetchMock: jest.SpyInstance;
  beforeAll(() => {
    fetchMock = jest.spyOn(netFetch, 'run');
  });
  afterEach(() => fetchMock.mockReset());
  afterAll(() => fetchMock.mockRestore());

  it('전역 fetch의 기본 헤더 대기(300초)에 걸리지 않게 전사 제한 시간에 맞춘 Agent를 이 요청에만 넘긴다', async () => {
    const created = jest.spyOn(guardedAgent, 'createMetadataGuardedAgent');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ text: '네' }), { status: 200 }));
    await new SttClient().transcribe({ baseUrl: 'http://stt.test/v1', apiKey: null }, input);
    const init = fetchMock.mock.calls[0][1] as RequestInit & { dispatcher?: unknown };
    expect(init.dispatcher).toBeInstanceOf(Agent);
    // 일반 Agent가 아니라 메타데이터 막는 Agent를, 전사 제한 시간(60분)에 맞춘 대기 시간으로 이 요청에만 만든다
    expect(created).toHaveBeenCalledTimes(1);
    expect(created).toHaveBeenCalledWith(sttAgentOptions(60 * 60_000));
    expect(init.dispatcher).toBe(created.mock.results[0].value);
    created.mockRestore();
    // 한 시간 제한이면 헤더·본문 모두 한 시간보다 조금 더 기다린다 (우리 제한이 먼저 걸려 안내 문구가 나온다)
    expect(sttAgentOptions(60 * 60_000)).toEqual({ headersTimeout: 60 * 60_000 + 10_000, bodyTimeout: 60 * 60_000 + 10_000 });
    expect(sttAgentOptions(60 * 60_000).headersTimeout).toBeGreaterThan(300_000);
  });

  it('모델 목록 같은 짧은 요청은 전사용이 아닌, 메타데이터 주소로 풀리는 이름만 막는 Agent를 한 번 만들어 같이 쓴다 (이슈 #497)', async () => {
    const created = jest.spyOn(guardedAgent, 'createMetadataGuardedAgent');
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const client = new SttClient();
    await client.listModels({ baseUrl: 'http://stt.test/v1', apiKey: null });
    await client.listModels({ baseUrl: 'http://stt.test/v1', apiKey: null });
    const [first, second] = fetchMock.mock.calls.map((call) => (call[1] as { dispatcher?: unknown }).dispatcher);
    expect(created).toHaveBeenCalledTimes(1);
    expect(first).toBe(created.mock.results[0].value);
    expect(second).toBe(first);
    created.mockRestore();
  });

  it('받아쓰기 본문은 멀티파트(multipart/form-data)로 간다: 전역 FormData를 undici fetch에 넘기면 글 [object FormData]가 간다 (실제 서버, 이슈 #510)', async () => {
    fetchMock.mockImplementation(realFetch);
    let received: { contentType: string | undefined; body: string } | null = null;
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        received = { contentType: req.headers['content-type'], body: Buffer.concat(chunks).toString('utf8') };
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ text: '받음' }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const transcript = await new SttClient().transcribe({ baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: null }, input, 5_000);
      expect(transcript.text).toBe('받음');
      expect(received).not.toBeNull();
      const { contentType, body } = received as unknown as { contentType: string | undefined; body: string };
      expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
      expect(body).toContain('name="file"; filename="');
      expect(body).toContain('name="model"');
      expect(body).not.toContain('[object FormData]');
    } finally {
      server.close();
    }
  });

  it('응답 헤더가 한참 늦게 와도(실제 서버, 1.2초) Agent가 끊지 않고 받는다', async () => {
    // 이 시험만 실제 fetch로 부른다 (afterEach의 mockReset이 다음 시험을 위해 되돌린다)
    fetchMock.mockImplementation(realFetch);
    const server = createServer((_req, res) => {
      setTimeout(() => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ text: '늦은 답' })), 1200);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const transcript = await new SttClient().transcribe({ baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: null }, input, 5_000);
      expect(transcript.text).toBe('늦은 답');
    } finally {
      server.close();
    }
  });
});

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
    const fetchMock = jest.spyOn(netFetch, 'run');
    const noModels = () => new Response('', { status: 404 });
    fetchMock.mockResolvedValueOnce(noModels());
    fetchMock.mockResolvedValueOnce(new Response('<html>not found</html>', { status: 404, statusText: 'Not Found' }));
    const plain = await failureOf(new SttClient().checkConnection(endpoint, null));
    expect(plain.message).toContain('…/v1');
    expect(plain.message).not.toContain('<html>');
    fetchMock.mockResolvedValueOnce(noModels());
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "The model 'whisper-9' does not exist", code: 'model_not_found' } }), { status: 404 }));
    const missing = await failureOf(new SttClient().checkConnection(endpoint, 'whisper-9'));
    expect(missing.message).toContain("The model 'whisper-9' does not exist");
    expect(missing.message).toContain('모델 이름이 맞는지');
    fetchMock.mockRestore();
  });

  it('리다이렉트는 따라가지 않고, 오류 문구에는 주소의 아이디·비밀번호가 없다', async () => {
    const fetchMock = jest.spyOn(netFetch, 'run').mockRejectedValue(new TypeError('fetch failed'));
    const error = await failureOf(new SttClient().transcribe({ baseUrl: 'http://user:secret@192.168.0.20:8000/v1', apiKey: null }, input));
    expect((fetchMock.mock.calls[0][1] as RequestInit).redirect).toBe('error');
    expect(error.message).toContain('192.168.0.20');
    expect(error.message).not.toContain('secret');
    fetchMock.mockRestore();
  });
});

describe('연결 실패의 공개 문구와 주소 막기 (이슈 #497)', () => {
  it('관리자용 message에는 주소가 있고, 모든 사원이 읽는 publicMessage에는 주소가 없다', async () => {
    const fetchMock = jest.spyOn(netFetch, 'run').mockRejectedValue(new TypeError('fetch failed'));
    const error = (await failureOf(new SttClient().transcribe({ baseUrl: 'http://100.87.40.116:8001/v1', apiKey: null }, input))) as SttRequestError;
    expect(error.message).toContain('100.87.40.116');
    expect(error.publicMessage).toBe('음성 서버에 연결할 수 없어요. 관리자에게 알려 주세요');
    // 주소 없는 이유는 둘이 같다
    const plain = new SttRequestError('API 키가 맞지 않거나 권한이 없어요');
    expect(plain.publicMessage).toBe(plain.message);
    fetchMock.mockRestore();
  });

  it('이름이 메타데이터 주소로 풀려 막힌 연결은 그렇게 알리고 publicMessage에는 주소가 없다 (이슈 #497)', async () => {
    const blocked = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('사내망·내부 주소는 읽을 수 없어요 (my-stt.example)'), { code: 'EBLOCKED' }) });
    const fetchMock = jest.spyOn(netFetch, 'run').mockRejectedValue(blocked);
    const error = (await failureOf(new SttClient().transcribe({ baseUrl: 'http://my-stt.example:8001/v1', apiKey: null }, input))) as SttRequestError;
    expect(error.message).toContain('메타데이터 주소로 풀려');
    expect(error.publicMessage).toBe('음성 서버에 연결할 수 없어요. 관리자에게 알려 주세요');
    fetchMock.mockRestore();
  });

  it('404의 publicMessage에도 주소가 없다', async () => {
    const fetchMock = jest.spyOn(netFetch, 'run').mockResolvedValue(new Response('', { status: 404 }));
    const error = (await failureOf(new SttClient().transcribe({ baseUrl: 'http://100.87.40.116:8001/v1', apiKey: null }, input))) as SttRequestError;
    expect(error.message).toContain('100.87.40.116');
    expect(error.publicMessage).not.toMatch(/100\.87|http/);
    fetchMock.mockRestore();
  });

  it.each(['http://169.254.169.254/v1', 'http://[fd00:ec2::254]/v1', 'http://metadata.google.internal/v1'])('저장돼 있던 주소 %s 로도 요청을 보내지 않는다', async (baseUrl) => {
    const fetchMock = jest.spyOn(netFetch, 'run');
    const client = new SttClient();
    expect(await failureOf(client.transcribe({ baseUrl, apiKey: 'k' }, input))).toBeInstanceOf(SttRequestError);
    expect(await failureOf(client.listModels({ baseUrl, apiKey: 'k' }))).toBeInstanceOf(SttRequestError);
    expect(await failureOf(client.checkConnection({ baseUrl, apiKey: 'k' }, null))).toBeInstanceOf(SttRequestError);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});

describe('모델 목록 (GET /models)', () => {
  const sidecarList = {
    object: 'list',
    data: [
      { id: 'whisper-pyannote', object: 'model', label: '받아쓰기 + 화자 분리 (whisper + pyannote)', diarization: true, available: true, note: null },
      { id: 'vibevoice', object: 'model', label: 'VibeVoice', diarization: true, available: false, note: '모델 폴더가 없어요' },
    ],
  };

  it('사이드카의 이름·화자 분리·준비 상태를 읽고, OpenAI 목록은 음성 모델만 남긴다', () => {
    expect(parseModelList(sidecarList)).toEqual([
      { id: 'whisper-pyannote', label: '받아쓰기 + 화자 분리 (whisper + pyannote)', diarization: true, available: true, note: null },
      { id: 'vibevoice', label: 'VibeVoice', diarization: true, available: false, note: '모델 폴더가 없어요' },
    ]);
    const openai = { data: [{ id: 'gpt-4.1' }, { id: 'whisper-1' }, { id: 'gpt-4o-transcribe' }, { id: 'tts-1' }, { nope: 1 }] };
    expect(parseModelList(openai).map((m) => m.id)).toEqual(['whisper-1', 'gpt-4o-transcribe']);
    expect(parseModelList({ error: 'x' })).toEqual([]);
  });

  it('연결 확인은 목록을 먼저 받고(키 포함) 무음을 보낸 뒤 목록을 돌려준다', async () => {
    const fetchMock = jest.spyOn(netFetch, 'run');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(sidecarList), { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ text: '' }), { status: 200 }));
    const models = await new SttClient().checkConnection({ baseUrl: 'http://100.87.40.116:8001/v1', apiKey: 'fsv-key' }, 'whisper-pyannote');
    expect(models.map((m) => m.id)).toEqual(['whisper-pyannote', 'vibevoice']);
    const [listUrl, listInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(listUrl).toBe('http://100.87.40.116:8001/v1/models');
    expect(listInit.headers).toEqual({ authorization: 'Bearer fsv-key' });
    expect(listInit.redirect).toBe('error');
    expect(fetchMock.mock.calls[1][0]).toBe('http://100.87.40.116:8001/v1/audio/transcriptions');
    fetchMock.mockRestore();
  });

  it('whisper.cpp 단독처럼 /models가 없으면 빈 목록으로 무음 확인만 한다', async () => {
    const fetchMock = jest.spyOn(netFetch, 'run');
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ text: '' }), { status: 200 }));
    expect(await new SttClient().checkConnection(endpoint, null)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockRestore();
  });

  it('키가 필요한데 없거나 틀리면 무음을 보내지 않고 바로 알린다', async () => {
    const fetchMock = jest.spyOn(netFetch, 'run');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'API 키가 맞지 않아요' } }), { status: 401 }));
    expect((await failureOf(new SttClient().checkConnection(endpoint, null))).message).toContain('API 키가 필요해요');
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
    expect((await failureOf(new SttClient().checkConnection({ ...endpoint, apiKey: 'wrong' }, null))).message).toContain('API 키가 맞지 않거나');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockRestore();
  });

  it('닿지 않으면 목록 단계에서 바로 이유를 준다', async () => {
    const fetchMock = jest.spyOn(netFetch, 'run');
    fetchMock.mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));
    expect((await failureOf(new SttClient().checkConnection(endpoint, null))).message).toContain('연결을 거절했어요');
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    const check = jest.fn().mockResolvedValue([]);
    const service = setup(check);
    await service.testConnection({ baseUrl: 'http://100.101.102.103:8001/v1/', model: 'whisper-pyannote', apiKey: 'typed' });
    expect(check).toHaveBeenLastCalledWith({ baseUrl: 'http://100.101.102.103:8001/v1', apiKey: 'typed' }, 'whisper-pyannote');
    await service.testConnection({ baseUrl: 'http://127.0.0.1:8000/v1' });
    expect(check).toHaveBeenLastCalledWith({ baseUrl: 'http://127.0.0.1:8000/v1', apiKey: 'saved-key' }, 'saved-model');
    await service.testConnection({ baseUrl: 'http://127.0.0.1:8000/v1', model: null });
    expect(check).toHaveBeenLastCalledWith({ baseUrl: 'http://127.0.0.1:8000/v1', apiKey: 'saved-key' }, null);
  });

  it('저장된 키는 저장된 주소와 같은 출처로만 보낸다', async () => {
    const check = jest.fn().mockResolvedValue([]);
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
    expect(result).toMatchObject({ connected: false, latencyMs: null, error: '꺼져 있어요', models: [] });
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
