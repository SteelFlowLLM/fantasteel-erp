// chatJson: 가짜 fetch로 형식 강제 요청, <think>·울타리 제거, 400 재시도를 확인한다.
import { LlmClient, LlmRequestError, parseJsonContent } from './llm.client';

const endpoint = { baseUrl: 'http://llm.test/v1/', apiKey: null };
const format = { name: 'demo', schema: { type: 'object' } };
const options = { timeoutMs: 1000, maxTokens: 100 };

function reply(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as { body: string }).body) as Record<string, unknown>;
}

describe('LlmClient.chatJson', () => {
  const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
  beforeEach(() => {
    fetchMock.mockReset();
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch);
  });
  afterEach(() => jest.restoreAllMocks());

  it('json_schema 형식과 temperature 0으로 요청하고 JSON을 읽는다', async () => {
    fetchMock.mockResolvedValueOnce(reply('{"a":1}'));
    const result = await new LlmClient().chatJson(endpoint, 'm', [{ role: 'user', content: 'x' }], format, options);
    expect(result).toEqual({ a: 1 });
    const body = bodyOf(fetchMock.mock.calls[0]);
    expect(body).toMatchObject({ model: 'm', temperature: 0, max_tokens: 100, response_format: { type: 'json_schema', json_schema: { name: 'demo', strict: true, schema: { type: 'object' } } } });
    expect(fetchMock.mock.calls[0][0]).toBe('http://llm.test/v1/chat/completions');
  });

  it('<think> 블록과 ```json 울타리를 벗긴다', async () => {
    fetchMock.mockResolvedValueOnce(reply('<think>{"x":0}\n생각 중</think>\n```json\n{"ok":true}\n```'));
    await expect(new LlmClient().chatJson(endpoint, 'm', [], format, options)).resolves.toEqual({ ok: true });
  });

  it('content가 비고 reasoning_content에만 JSON이 있으면 그것을 읽는다', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '', reasoning_content: '{"r":1}' } }] }), { status: 200 }));
    await expect(new LlmClient().chatJson(endpoint, 'm', [], format, options)).resolves.toEqual({ r: 1 });
  });

  it('JSON이 아니면 읽지 못했다는 오류를 던진다', async () => {
    fetchMock.mockResolvedValueOnce(reply('죄송합니다'));
    await expect(new LlmClient().chatJson(endpoint, 'm', [], format, options)).rejects.toThrow('AI 응답을 JSON으로 읽지 못했어요');
  });

  it('첫 요청이 400이면 response_format 없이 한 번 더 부른다', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "'response_format.type' must be 'json_schema'" }), { status: 400 }));
    fetchMock.mockResolvedValueOnce(reply('{"b":2}'));
    await expect(new LlmClient().chatJson(endpoint, 'm', [], format, options)).resolves.toEqual({ b: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchMock.mock.calls[0])).toHaveProperty('response_format');
    expect(bodyOf(fetchMock.mock.calls[1])).not.toHaveProperty('response_format');
  });

  it('400이 아닌 서버 오류는 다시 부르지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    await expect(new LlmClient().chatJson(endpoint, 'm', [], format, options)).rejects.toBeInstanceOf(LlmRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('parseJsonContent: 울타리 언어 표시가 없어도 읽는다', () => {
    expect(parseJsonContent('```\n[1,2]\n```')).toEqual([1, 2]);
  });
});
