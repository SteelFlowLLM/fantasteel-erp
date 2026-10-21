// LlmClient의 연결 Agent (#497): 전역 fetch에 undici Agent(dispatcher)를 넘겨도 localhost·사설망 이름의 LLM 서버를 그대로 부를 수 있고(짧은 요청·스트리밍),
// 이름이 메타데이터 주소로 풀리는 연결 실패는 알아본다. fetch를 가로채지 않고 127.0.0.1 시험 서버를 실제로 부른다.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import { LlmClient, LlmRequestError } from './llm.client';
import { LLM_PROFILE } from './llm-profiles';

let server: Server;
let port: number;
const paths: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    paths.push(`${req.method} ${req.url}`);
    if (req.url === '/v1/models') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'local-model' }] }));
    if (req.url === '/v1/chat/completions') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '안녕' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '하세요' } }] })}\n\n`);
      return res.end('data: [DONE]\n\n');
    }
    if (req.url === '/redirect/v1/models') return res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' }).end();
    return res.writeHead(404).end('not found');
  });
  // 주소를 주지 않으면 IPv4·IPv6 모두 받아 localhost가 어느 쪽으로 풀려도 닿는다
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  paths.length = 0;
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('LlmClient 연결 Agent', () => {
  it('이름(localhost)으로 쓴 로컬 LLM 서버에 연결한다: 모델 목록', async () => {
    const models = await new LlmClient().listModels({ baseUrl: `http://localhost:${port}/v1`, apiKey: null });
    expect(models.map((m) => m.id)).toEqual(['local-model']);
    expect(paths).toContain('GET /v1/models');
  });

  it('스트리밍 답도 Agent를 거쳐 조각으로 받는다', async () => {
    const pieces: string[] = [];
    const reply = await new LlmClient().streamWithTools(
      { baseUrl: `http://localhost:${port}/v1`, apiKey: null },
      'local-model',
      [{ role: 'user', content: '인사해 줘' }],
      [],
      LLM_PROFILE.CONNECTION_TEST,
      { onThinking: () => undefined, onAnswer: (text) => pieces.push(text) },
    );
    expect(reply.content).toBe('안녕하세요');
    expect(pieces.join('')).toBe('안녕하세요');
  });

  it('리다이렉트(메타데이터 주소로 가라는 응답)는 따라가지 않고, 이유는 서버 로그에만 남는다', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = await new LlmClient().listModels({ baseUrl: `http://localhost:${port}/redirect/v1`, apiKey: null }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmRequestError);
    expect((error as LlmRequestError).kind).toBe('CONNECT');
    expect((error as LlmRequestError).message).not.toMatch(/169\.254|localhost|http/);
    // 코드 없는 연결 거절은 원인 글이 로그에 남는다
    expect(String(warn.mock.calls[0][0])).toContain('unexpected redirect');
    expect(paths).toEqual(['GET /redirect/v1/models']);
  });
});
