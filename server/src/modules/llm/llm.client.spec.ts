// chatJson: 가짜 fetch로 형식 강제 요청, <think>·울타리 제거, 400 재시도, 기능별 샘플링·생각 설정을 확인한다.
import { LlmClient, LlmJsonParseError, LlmRequestError, parseJsonContent, reasoningEffortFor, splitThinking } from './llm.client';
import { LLM_PROFILE } from './llm-profiles';

const endpoint = { baseUrl: 'http://llm.test/v1/', apiKey: null };
const format = { name: 'demo', schema: { type: 'object' } };
const options = { timeoutMs: 1000, maxTokens: 100, profile: LLM_PROFILE.MEETING_ANALYSIS };

function reply(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as { body: string }).body) as Record<string, unknown>;
}

/** LM Studio 고유 API(/api/v1/models)는 따로 답한다. 기본은 404: 외부 LLM처럼 LM Studio가 아닌 서버 */
const modelsMock = jest.fn<Promise<Response>, [string]>();
const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();

beforeEach(() => {
  fetchMock.mockReset();
  modelsMock.mockReset().mockImplementation(async () => new Response('not found', { status: 404 }));
  jest.spyOn(globalThis, 'fetch').mockImplementation(((url: string, init: RequestInit) =>
    url.endsWith('/api/v1/models') ? modelsMock(url) : fetchMock(url, init)) as unknown as typeof fetch);
});
afterEach(() => jest.restoreAllMocks());

function lmStudioModels(models: { key: string; variants?: string[]; reasoning?: string[] }[]): Response {
  return Response.json({
    models: models.map((m) => ({ key: m.key, variants: m.variants, capabilities: m.reasoning ? { reasoning: { allowed_options: m.reasoning, default: 'on' } } : {} })),
  });
}

describe('LlmClient.chatJson', () => {
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

  it('splitThinking: 생각 글과 답을 나눈다', () => {
    expect(splitThinking('<think>음…</think>\n{"a":1}')).toEqual({ thinking: '음…', text: '{"a":1}' });
    // 여는 태그 없이 닫는 태그만 쓰는 모델
    expect(splitThinking('생각 중</think>{"a":1}')).toEqual({ thinking: '생각 중', text: '{"a":1}' });
    // 길이 상한에 걸려 끝나지 않은 생각
    expect(splitThinking('<think>끝나지 않은')).toEqual({ thinking: '끝나지 않은', text: '' });
    expect(splitThinking(' {"a":1} ')).toEqual({ thinking: null, text: '{"a":1}' });
  });

  it('chatJsonWithText: 원문과 생각 글(reasoning_content 포함)을 함께 돌려준다', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '<think>짧은 생각</think>{"items":[]}', reasoning_content: '긴 추론' } }] }));
    expect(await new LlmClient().chatJsonWithText(endpoint, 'm', [], format, options)).toEqual({ value: { items: [] }, rawText: '{"items":[]}', thinking: '긴 추론\n\n짧은 생각' });
  });

  it('chatJsonWithText: JSON으로 읽지 못하면 원문을 든 오류를 던진다', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '<think>흠</think>죄송해요' } }] }));
    const error = await new LlmClient().chatJsonWithText(endpoint, 'm', [], format, options).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmJsonParseError);
    expect(error).toMatchObject({ rawText: '죄송해요', thinking: '흠' });
  });
});

describe('LlmClient 기능별 샘플링·생각 설정', () => {
  const messages = [{ role: 'user' as const, content: 'x' }];

  it('LM Studio가 아니면 OpenAI 표준 샘플링만 보내고 생각 설정은 빼고 보낸다', async () => {
    fetchMock.mockResolvedValueOnce(reply('안녕하세요'));
    await new LlmClient().chat(endpoint, 'm', messages, LLM_PROFILE.CONNECTION_TEST);
    const body = bodyOf(fetchMock.mock.calls[0]);
    expect(body).toMatchObject({ temperature: 0.7, top_p: 0.8, presence_penalty: 1.5 });
    expect(body).not.toHaveProperty('top_k');
    expect(body).not.toHaveProperty('min_p');
    expect(body).not.toHaveProperty('repeat_penalty');
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(modelsMock.mock.calls[0][0]).toBe('http://llm.test/api/v1/models');
  });

  it('LM Studio면 top_k·min_p·repeat_penalty도 보내고, 생각을 끌 수 있는 모델에는 reasoning_effort none을 보낸다', async () => {
    modelsMock.mockResolvedValueOnce(lmStudioModels([{ key: 'm', reasoning: ['off', 'on'] }]));
    fetchMock.mockResolvedValueOnce(reply('안녕하세요'));
    await new LlmClient().chat(endpoint, 'm', messages, LLM_PROFILE.AGENT_EXPLAIN);
    expect(bodyOf(fetchMock.mock.calls[0])).toMatchObject({ top_k: 20, min_p: 0, repeat_penalty: 1, reasoning_effort: 'none' });
  });

  it('생각 설정을 알리지 않은 모델에는 reasoning_effort를 보내지 않는다', async () => {
    modelsMock.mockResolvedValueOnce(lmStudioModels([{ key: 'm' }]));
    fetchMock.mockResolvedValueOnce(reply('답'));
    await new LlmClient().chatWithTools(endpoint, 'm', messages, [], LLM_PROFILE.ASSISTANT);
    const body = bodyOf(fetchMock.mock.calls[0]);
    expect(body).toMatchObject({ temperature: 1, top_k: 20 });
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('변형 이름(key@양자화)으로 고른 모델도 찾는다', async () => {
    modelsMock.mockResolvedValueOnce(lmStudioModels([{ key: 'qwen/q', variants: ['qwen/q@4bit'], reasoning: ['off', 'low', 'medium', 'xhigh', 'on'] }]));
    fetchMock.mockResolvedValueOnce(reply('{"a":1}'));
    await new LlmClient().chatJson(endpoint, 'qwen/q@4bit', messages, format, options);
    expect(bodyOf(fetchMock.mock.calls[0])).toMatchObject({ temperature: 0, reasoning_effort: 'medium' });
  });

  it('모델 정보는 한 번 받아 두고 다음 요청에 다시 묻지 않는다', async () => {
    fetchMock.mockImplementation(async () => reply('네'));
    const client = new LlmClient();
    await client.chat(endpoint, 'm', messages, LLM_PROFILE.CONNECTION_TEST);
    await client.chat(endpoint, 'm', messages, LLM_PROFILE.CONNECTION_TEST);
    expect(modelsMock).toHaveBeenCalledTimes(1);
  });

  it('reasoningEffortFor: 모델이 받는 값으로 바꾼다', () => {
    expect(reasoningEffortFor('off', ['off', 'on'])).toBe('none');
    expect(reasoningEffortFor('high', ['off', 'on'])).toBe('high');
    // 끌 수 없는 모델
    expect(reasoningEffortFor('off', ['low', 'medium', 'high'])).toBeNull();
    // high가 없으면 가까운 단계, 같은 거리면 높은 쪽
    expect(reasoningEffortFor('high', ['off', 'low', 'medium', 'xhigh', 'on'])).toBe('xhigh');
    expect(reasoningEffortFor('low', ['off', 'medium', 'on'])).toBe('medium');
    expect(reasoningEffortFor('medium', null)).toBeNull();
    expect(reasoningEffortFor(null, ['off', 'on'])).toBeNull();
  });
});
