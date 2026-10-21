// chatJson: 가짜 fetch로 형식 강제 요청, <think>·울타리 제거, 400 재시도, 기능별 샘플링·생각 설정을 확인한다.
import { Logger } from '@nestjs/common';
import { createThinkSplitter, LlmAbortedError, LlmClient, LlmJsonParseError, LlmModelNotLoadedError, LlmRequestError, parseJsonContent, reasoningEffortFor, splitThinking } from './llm.client';
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
/** Unsloth Studio를 알아보는 경로(/v1/status·/api/settings·/api/models)도 따로 답한다. 기본은 404 */
const unslothMock = jest.fn<Promise<Response>, [string]>();
const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();

beforeEach(() => {
  fetchMock.mockReset();
  modelsMock.mockReset().mockImplementation(async () => new Response('not found', { status: 404 }));
  unslothMock.mockReset().mockImplementation(async () => new Response('not found', { status: 404 }));
  jest.spyOn(globalThis, 'fetch').mockImplementation(((url: string, init: RequestInit) =>
    url.endsWith('/api/v1/models')
      ? modelsMock(url)
      : url.endsWith('/v1/status') || url.includes('/api/settings/') || url.includes('/api/models/')
        ? unslothMock(url)
        : fetchMock(url, init)) as unknown as typeof fetch);
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

  it('실패 종류(kind)를 나눈다: 연결 실패 CONNECT·시간 초과 TIMEOUT·HTTP 오류와 읽을 수 없는 응답 SERVER (이슈 #462)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(new LlmClient().chatJson(endpoint, 'm', [], format, options)).rejects.toMatchObject({ kind: 'CONNECT' });
    // 시간 제한(AbortSignal.timeout)이 끊으면 fetch는 TimeoutError로 실패한다
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
    await expect(new LlmClient().chatJson(endpoint, 'm', [], format, options)).rejects.toMatchObject({ kind: 'TIMEOUT' });
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    await expect(new LlmClient().chatJson(endpoint, 'm', [], format, options)).rejects.toMatchObject({ kind: 'SERVER', status: 500 });
    fetchMock.mockResolvedValueOnce(new Response('x', { status: 401 }));
    await expect(new LlmClient().chatJson(endpoint, 'm', [], format, options)).rejects.toMatchObject({ kind: 'SERVER' });
    expect(new LlmRequestError('이유').kind).toBe('SERVER');
  });

  it('연결 실패 문구에는 내부 LLM 주소가 없고, 주소는 서버 로그에만 남는다 (이슈 #497)', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const internal = { baseUrl: 'http://user:pw@100.87.40.116:1234/v1', apiKey: null };
    fetchMock.mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }) }));
    const error = await new LlmClient().chatJson(internal, 'm', [], format, options).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmRequestError);
    expect((error as LlmRequestError).message).not.toMatch(/100\.87|1234|http/);
    expect((error as LlmRequestError).kind).toBe('CONNECT');
    // 로그에는 어디로 부르다 실패했는지가 남되, 주소 안의 아이디·비밀번호는 없다
    const logged = String(warn.mock.calls[0][0]);
    expect(logged).toContain('http://100.87.40.116:1234/v1');
    expect(logged).toContain('ECONNREFUSED');
    expect(logged).not.toContain('pw');
  });

  it('리다이렉트는 따라가지 않는다 (메타데이터 같은 다른 곳에 키·질문이 가지 않게, 이슈 #497)', async () => {
    fetchMock.mockResolvedValueOnce(reply('{"a":1}'));
    await new LlmClient().chatJson({ baseUrl: 'http://llm.test/v1', apiKey: 'secret-key' }, 'm', [], format, options);
    expect(fetchMock.mock.calls[0][1].redirect).toBe('error');
  });

  it('클라우드 메타데이터 주소(저장돼 있던 것·.env)로는 요청을 보내지 않는다 (이슈 #497)', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    for (const baseUrl of ['http://169.254.169.254/v1', 'http://[fd00:ec2::254]/v1', 'http://metadata.google.internal/v1']) {
      const error = await new LlmClient().chatJson({ baseUrl, apiKey: 'secret-key' }, 'm', [], format, options).catch((e: unknown) => e);
      expect(error).toMatchObject({ kind: 'CONNECT' });
      expect((error as LlmRequestError).message).not.toContain('169.254');
    }
    expect(await new LlmClient().listModels({ baseUrl: 'http://169.254.169.254/v1', apiKey: null }).catch((e: unknown) => e)).toBeInstanceOf(LlmRequestError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(modelsMock).not.toHaveBeenCalled();
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

/** OpenAI 호환 스트리밍 응답: data: 줄을 여러 조각으로 나눠 보낸다 (조각 경계가 줄·글자 중간에 걸리게) */
function streamResponse(deltas: Record<string, unknown>[], chunkSize = 7): Response {
  const text = deltas.map((delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`).join('') + 'data: [DONE]\n\n';
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let at = 0; at < bytes.length; at += chunkSize) controller.enqueue(bytes.slice(at, at + chunkSize));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('LlmClient.streamWithTools', () => {
  const messages = [{ role: 'user' as const, content: 'x' }];
  const collect = () => {
    const seen = { thinking: '', answer: '' };
    return { seen, handlers: { onThinking: (t: string) => (seen.thinking += t), onAnswer: (t: string) => (seen.answer += t) } };
  };

  it('stream: true로 부르고 생각 글·답 글을 오는 대로 넘긴다', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse([{ role: 'assistant' }, { reasoning_content: '재고를 ' }, { reasoning_content: '보자' }, { content: '가용 재고는 ' }, { content: '120톤이에요' }]));
    const { seen, handlers } = collect();
    const reply = await new LlmClient().streamWithTools(endpoint, 'm', messages, [], LLM_PROFILE.ASSISTANT, handlers);
    expect(bodyOf(fetchMock.mock.calls[0])).toMatchObject({ stream: true, temperature: 1 });
    expect(seen).toEqual({ thinking: '재고를 보자', answer: '가용 재고는 120톤이에요' });
    expect(reply).toEqual({ content: '가용 재고는 120톤이에요', toolCalls: [], reasoning: '재고를 보자', reasoningApplied: false });
  });

  it('조각으로 나뉘어 온 도구 호출을 이어 붙인다', async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'get_inventory', arguments: '' } }] },
        { tool_calls: [{ index: 0, function: { arguments: '{"item' } }] },
        { tool_calls: [{ index: 0, function: { arguments: 'Code":"SS275"}' } }] },
        { tool_calls: [{ index: 1, id: 'c2', function: { name: 'get_sales_orders', arguments: '{}' } }] },
      ]),
    );
    const reply = await new LlmClient().streamWithTools(endpoint, 'm', messages, [{ name: 'get_inventory', description: 'd', parameters: {} }], LLM_PROFILE.ASSISTANT, collect().handlers);
    expect(reply.toolCalls).toEqual([
      { id: 'c1', name: 'get_inventory', arguments: '{"itemCode":"SS275"}' },
      { id: 'c2', name: 'get_sales_orders', arguments: '{}' },
    ]);
    expect(bodyOf(fetchMock.mock.calls[0])).toMatchObject({ tool_choice: 'auto' });
  });

  it('답 글 안의 <think> 블록은 조각이 태그를 잘라도 생각 글로 넘긴다', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse([{ content: '<thi' }, { content: 'nk>음… 생각</th' }, { content: 'ink>답' }, { content: '이에요' }], 3));
    const { seen, handlers } = collect();
    await new LlmClient().streamWithTools(endpoint, 'm', messages, [], LLM_PROFILE.ASSISTANT, handlers);
    expect(seen).toEqual({ thinking: '음… 생각', answer: '답이에요' });
  });

  it('부른 쪽이 끊으면 LlmAbortedError를 던진다', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(async (_url, init) => {
      controller.abort();
      throw init.signal?.reason ?? new Error('aborted');
    });
    await expect(new LlmClient().streamWithTools(endpoint, 'm', messages, [], LLM_PROFILE.ASSISTANT, collect().handlers, controller.signal)).rejects.toBeInstanceOf(LlmAbortedError);
  });

  it('스트림 안의 오류 조각은 LlmRequestError로 던진다', async () => {
    const body = new TextEncoder().encode('data: {"error":{"message":"model crashed"}}\n\n');
    fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));
    await expect(new LlmClient().streamWithTools(endpoint, 'm', messages, [], LLM_PROFILE.ASSISTANT, collect().handlers)).rejects.toThrow('model crashed');
  });
});

describe('createThinkSplitter', () => {
  const run = (pieces: string[]) => {
    const seen = { thinking: '', answer: '' };
    const splitter = createThinkSplitter({ onThinking: (t) => (seen.thinking += t), onAnswer: (t) => (seen.answer += t) });
    pieces.forEach((piece) => splitter.push(piece));
    splitter.flush();
    return seen;
  };

  it('태그가 없으면 모두 답이다', () => expect(run(['a<b', 'c>d'])).toEqual({ thinking: '', answer: 'a<bc>d' }));
  it('글자 하나씩 와도 나눈다', () => expect(run([...'<think>x</think>y'])).toEqual({ thinking: 'x', answer: 'y' }));
  it('닫히지 않은 생각은 끝까지 생각 글이다', () => expect(run(['<think>길게', ' 생각 중'])).toEqual({ thinking: '길게 생각 중', answer: '' }));
  it('여는 태그 없는 닫는 태그는 지운다', () => expect(run(['생각</thi', 'nk>답'])).toEqual({ thinking: '', answer: '생각답' }));
  it('Gemma 여는 표시만 오면 지우고 답만 남긴다', () =>
    expect(run(['<|chan', 'nel>thought\n포항제철소는'])).toEqual({ thinking: '', answer: '\n포항제철소는' }));
  it('Gemma 닫는 표시가 조각 사이에서 잘려 와도 표시를 지운다', () =>
    expect(run([...'<|channel>thought생각<channel|>답'])).toEqual({ thinking: '', answer: '생각답' }));
});

describe('splitThinking Gemma 표시', () => {
  it('닫는 표시 앞은 생각, 뒤는 답이다', () =>
    expect(splitThinking('<|channel>thought\n음…<channel|>답이에요')).toEqual({ thinking: '음…', text: '답이에요' }));
  it('여는 표시만 있으면 지우고 모두 답이다', () =>
    expect(splitThinking('<|channel>thought\n포항제철소는')).toEqual({ thinking: null, text: '포항제철소는' }));
});

describe('LlmClient 사진', () => {
  it('사진을 실은 질문은 text와 image_url(data URL)로 보낸다', async () => {
    fetchMock.mockResolvedValueOnce(reply('빨간색이에요'));
    await new LlmClient().chatWithTools(endpoint, 'm', [{ role: 'user', content: '무슨 색?', images: [{ mediaType: 'image/png', dataBase64: 'AAAA' }] }], [], LLM_PROFILE.ASSISTANT);
    expect(bodyOf(fetchMock.mock.calls[0]).messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: '무슨 색?' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] },
    ]);
  });

  it('modelCapabilities: LM Studio가 알린 vision·생각 설정을 돌려주고, 모르면 null', async () => {
    modelsMock.mockResolvedValue(
      Response.json({ models: [{ key: 'v', capabilities: { vision: true, reasoning: { allowed_options: ['off', 'on'] } } }, { key: 't', capabilities: { vision: false } }] }),
    );
    const client = new LlmClient();
    await expect(client.modelCapabilities(endpoint, 'v')).resolves.toEqual({ vision: true, reasoning: true });
    await expect(client.modelCapabilities(endpoint, 't')).resolves.toEqual({ vision: false, reasoning: false });
    await expect(client.modelCapabilities(endpoint, 'unknown')).resolves.toEqual({ vision: null, reasoning: null });
  });

  it('modelCapabilities: LM Studio가 아니면 모두 null', async () => {
    await expect(new LlmClient().modelCapabilities(endpoint, 'm')).resolves.toEqual({ vision: null, reasoning: null });
  });
});

describe('LlmClient.modelContextLength (심층 조사 프롬프트 예산, 이슈 #384)', () => {
  it('불러온 인스턴스의 문맥 길이를 먼저(여럿이면 작은 것), 없으면 최대 문맥 길이, 외부 LLM이면 null', async () => {
    modelsMock.mockResolvedValueOnce(
      Response.json({
        models: [
          { key: 'loaded', max_context_length: 262144, loaded_instances: [{ config: { context_length: 32768 } }, { config: { context_length: 16384 } }] },
          { key: 'idle', max_context_length: 131072, loaded_instances: [] },
          { key: 'unknown' },
        ],
      }),
    );
    const client = new LlmClient();
    expect(await client.modelContextLength(endpoint, 'loaded')).toBe(16384);
    expect(await client.modelContextLength(endpoint, 'idle')).toBe(131072);
    expect(await client.modelContextLength(endpoint, 'unknown')).toBeNull();
    expect(await new LlmClient().modelContextLength(endpoint, 'loaded')).toBeNull();
  });
});

describe('LlmClient.listModels 생각 지원 표시', () => {
  it('LM Studio가 알려 준 생각 옵션으로 표시하고, 모르는 모델·외부 LLM이면 null', async () => {
    const openAiModels = () => Response.json({ data: [{ id: 'think' }, { id: 'plain' }, { id: 'mystery' }] });
    fetchMock.mockImplementation(async (url) => (url.endsWith('/v1/models') ? openAiModels() : new Response('not found', { status: 404 })));
    modelsMock.mockResolvedValueOnce(lmStudioModels([{ key: 'think', reasoning: ['off', 'on'] }, { key: 'plain' }]));
    const models = await new LlmClient().listModels(endpoint);
    expect(models.map((m) => [m.id, m.reasoning])).toEqual([
      ['think', true],
      ['plain', false],
      ['mystery', null],
    ]);
    // /api/v1/models가 없는 서버(외부 LLM)
    expect((await new LlmClient().listModels(endpoint)).map((m) => m.reasoning)).toEqual([null, null, null]);
  });

  it('연결 확인은 기억해 둔 모델 정보를 쓰지 않고 다시 묻는다', async () => {
    fetchMock.mockImplementation(async (url) => (url.endsWith('/v1/models') ? Response.json({ data: [{ id: 'm' }] }) : new Response('not found', { status: 404 })));
    modelsMock.mockResolvedValueOnce(lmStudioModels([{ key: 'm' }])).mockResolvedValueOnce(lmStudioModels([{ key: 'm', reasoning: ['on'] }]));
    const client = new LlmClient();
    expect((await client.listModels(endpoint))[0].reasoning).toBe(false);
    expect((await client.listModels(endpoint))[0].reasoning).toBe(true);
  });
});

/** Unsloth Studio (이슈 #465): /v1/status 모양으로 알아보고, /v1/models의 loaded로 불러온 모델을 안다 */
describe('LlmClient Unsloth Studio', () => {
  const unslothEndpoint = { baseUrl: 'http://127.0.0.1:8888/v1', apiKey: 'k' };
  const idleStatus = { supports_reasoning: false, reasoning_style: 'enable_thinking', reasoning_effort_levels: [], is_vision: false, context_length: null };

  /** /v1/models·/v1/chat/completions는 fetchMock, 나머지 Unsloth 경로는 unslothMock이 답한다 */
  function unsloth({
    loaded = [] as string[],
    status = idleStatus as Record<string, unknown>,
    autoSwitch = false as boolean | null,
    vision = {} as Record<string, boolean>,
    embedding = {} as Record<string, boolean>,
    chat = () => reply('안녕하세요'),
  } = {}) {
    unslothMock.mockImplementation(async (url) => {
      if (url.endsWith('/v1/status')) return Response.json(status);
      if (url.endsWith('/api/settings/openai-auto-switch')) return autoSwitch === null ? new Response('no', { status: 401 }) : Response.json({ enabled: autoSwitch, auto_unload_idle_seconds: 0 });
      const embeddingName = decodeURIComponent(url.split('/api/models/check-embedding/')[1] ?? '');
      if (embeddingName) return embeddingName in embedding ? Response.json({ model_name: embeddingName, is_embedding: embedding[embeddingName] }) : new Response('no', { status: 404 });
      const name = decodeURIComponent(url.split('/api/models/check-vision/')[1] ?? '');
      return name in vision ? Response.json({ model_name: name, is_vision: vision[name] }) : new Response('no', { status: 404 });
    });
    fetchMock.mockImplementation(async (url) =>
      url.endsWith('/v1/models')
        ? Response.json({ object: 'list', data: ['a/think', 'b/plain'].map((id) => ({ id, owned_by: 'unsloth-studio', loaded: loaded.includes(id), status: { value: loaded.includes(id) ? 'loaded' : 'unloaded' } })) })
        : chat(),
    );
  }
  const chatBodies = () => fetchMock.mock.calls.filter(([url]) => url.endsWith('/chat/completions')).map(bodyOf);

  it('서버 종류를 unsloth로 알고, 모델 목록에 불러옴을 표시하고, auto-switch를 알린다', async () => {
    unsloth({ loaded: ['a/think'], status: { ...idleStatus, supports_reasoning: true, reasoning_effort_levels: ['low', 'medium', 'high'] }, autoSwitch: true });
    const client = new LlmClient();
    const models = await client.listModels(unslothEndpoint);
    expect(models.map((m) => [m.id, m.loaded, m.reasoning])).toEqual([
      ['a/think', true, true],
      ['b/plain', false, null],
    ]);
    await expect(client.serverSummary(unslothEndpoint)).resolves.toEqual({ kind: 'unsloth', autoSwitch: true });
    // Bearer 키를 함께 보낸다
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>).authorization).toBe('Bearer k');
  });

  it('LM Studio도 Unsloth도 아니면 openai', async () => {
    fetchMock.mockImplementation(async () => Response.json({ data: [{ id: 'gpt' }] }));
    const client = new LlmClient();
    await client.listModels(endpoint);
    await expect(client.serverSummary(endpoint)).resolves.toEqual({ kind: 'openai', autoSwitch: null });
  });

  it('불러온 모델이 생각 단계를 알리면 reasoning_effort와 enable_thinking, Unsloth 샘플링 이름으로 보낸다', async () => {
    unsloth({ loaded: ['a/think'], status: { ...idleStatus, supports_reasoning: true, reasoning_effort_levels: ['low', 'medium', 'high'] } });
    const client = new LlmClient();
    await client.chat(unslothEndpoint, 'a/think', [], LLM_PROFILE.ASSISTANT);
    await client.chat(unslothEndpoint, 'a/think', [], LLM_PROFILE.CONNECTION_TEST);
    const [thinking, off] = chatBodies();
    expect(thinking).toMatchObject({ reasoning_effort: 'medium', enable_thinking: true, top_k: 20, min_p: 0, repetition_penalty: 1 });
    expect(thinking).not.toHaveProperty('repeat_penalty');
    expect(off).toMatchObject({ reasoning_effort: 'none', enable_thinking: false });
  });

  it('불러온 모델이 생각을 못 하면 관리자가 켰어도 생각 설정을 보내지 않는다 (모델 정보가 먼저)', async () => {
    unsloth({ loaded: ['b/plain'] });
    const reply = await new LlmClient().chatWithTools({ ...unslothEndpoint, reasoningSupport: true }, 'b/plain', [], [], LLM_PROFILE.ASSISTANT);
    expect(chatBodies()[0]).not.toHaveProperty('reasoning_effort');
    expect(reply.reasoningApplied).toBe(false);
  });

  it('auto-switch가 켜져 있어 모델 정보가 없으면 관리자 설정대로 생각 정도를 보낸다', async () => {
    unsloth({ loaded: [], autoSwitch: true });
    const client = new LlmClient();
    await client.chat({ ...unslothEndpoint, reasoningSupport: true }, 'a/think', [], LLM_PROFILE.MEETING_SPEAKER);
    await client.chat({ ...unslothEndpoint, reasoningSupport: null }, 'a/think', [], LLM_PROFILE.MEETING_SPEAKER);
    const [manual, unknown] = chatBodies();
    expect(manual).toMatchObject({ reasoning_effort: 'low', enable_thinking: true });
    expect(unknown).not.toHaveProperty('reasoning_effort');
  });

  it('auto-switch가 꺼져 있고 고른 모델이 안 불러와져 있으면 부르기 전에 알기 쉬운 이유로 막는다', async () => {
    unsloth({ loaded: ['b/plain'] });
    const client = new LlmClient();
    const error = await client.chat(unslothEndpoint, 'a/think', [], LLM_PROFILE.CONNECTION_TEST).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmModelNotLoadedError);
    expect((error as LlmRequestError).kind).toBe('NO_MODEL');
    expect((error as Error).message).toBe(
      '고른 모델(a/think)이 Unsloth Studio에 불러와 있지 않아요 (지금 불러온 모델: b/plain). Unsloth Studio에서 모델을 불러오거나 Settings > API > Model auto-switch를 켜 주세요',
    );
    expect(chatBodies()).toHaveLength(0);
  });

  it('아무 모델도 없으면 그렇게 알리고, 그사이 불러왔으면 다시 물어 통과한다', async () => {
    unsloth({ loaded: [] });
    const client = new LlmClient();
    await expect(client.chat(unslothEndpoint, 'a/think', [], LLM_PROFILE.CONNECTION_TEST)).rejects.toThrow(
      'Unsloth Studio에 불러온 모델이 없어요. Unsloth Studio에서 모델을 불러오거나 Settings > API > Model auto-switch를 켜 주세요',
    );
    unsloth({ loaded: ['a/think'] });
    await expect(client.chat(unslothEndpoint, 'a/think', [], LLM_PROFILE.CONNECTION_TEST)).resolves.toBe('안녕하세요');
  });

  it('바쁜 서버가 모델 목록을 시간 안에 못 주면 \'불러온 모델 없음\'으로 막지 않고 보내며, 그 정보는 곧 다시 묻는다 (#519)', async () => {
    unsloth({ loaded: ['a/think'] });
    fetchMock.mockImplementation(async (url) => (url.endsWith('/v1/models') ? Promise.reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' })) : reply('안녕하세요')));
    const now = jest.spyOn(Date, 'now');
    try {
      now.mockReturnValue(1_000_000);
      const client = new LlmClient();
      await expect(client.chat(unslothEndpoint, 'a/think', [], LLM_PROFILE.CONNECTION_TEST)).resolves.toBe('안녕하세요');
      expect(chatBodies()).toHaveLength(1);
      const modelAsks = () => fetchMock.mock.calls.filter(([url]) => url.endsWith('/v1/models')).length;
      const asked = modelAsks();
      // 모르는 정보는 5초만 기억한다
      now.mockReturnValue(1_004_000);
      await client.chat(unslothEndpoint, 'a/think', [], LLM_PROFILE.CONNECTION_TEST);
      expect(modelAsks()).toBe(asked);
      now.mockReturnValue(1_006_000);
      await client.chat(unslothEndpoint, 'a/think', [], LLM_PROFILE.CONNECTION_TEST);
      expect(modelAsks()).toBeGreaterThan(asked);
    } finally {
      now.mockRestore();
    }
    // 목록을 읽었는데 비었으면 그대로 막는다
    unsloth({ loaded: [] });
    await expect(new LlmClient().chat(unslothEndpoint, 'a/think', [], LLM_PROFILE.CONNECTION_TEST)).rejects.toBeInstanceOf(LlmModelNotLoadedError);
  });

  it('서버가 No model loaded(400)를 주면 같은 안내로 바꾸고, JSON 형식 없이 다시 부르지 않는다', async () => {
    const noModel = () =>
      Response.json(
        { error: { message: 'No model loaded. Call POST /inference/load first. Or enable Model auto-switch (Settings > API) to load a requested model automatically.', type: 'invalid_request_error' } },
        { status: 400 },
      );
    // auto-switch를 못 읽으면 미리 막지 않는다
    unsloth({ loaded: [], autoSwitch: null, chat: noModel });
    await expect(new LlmClient().chatJson(unslothEndpoint, 'a/think', [], format, options)).rejects.toThrow('Unsloth Studio에 불러온 모델이 없어요');
    expect(chatBodies()).toHaveLength(1);
  });

  it('modelCapabilities: 불러온 모델은 status, 안 불러온 모델의 사진은 check-vision이 먼저이고 모르면 관리자 설정', async () => {
    unsloth({ loaded: ['a/think'], status: { ...idleStatus, supports_reasoning: true, is_vision: true }, vision: { 'a/think': false, 'b/plain': true } });
    const client = new LlmClient();
    const manual = { ...unslothEndpoint, visionSupport: false, reasoningSupport: false };
    await expect(client.modelCapabilities(manual, 'a/think')).resolves.toEqual({ vision: true, reasoning: true });
    await expect(client.modelCapabilities(manual, 'b/plain')).resolves.toEqual({ vision: true, reasoning: false });
    await expect(client.modelCapabilities(manual, 'c/unknown')).resolves.toEqual({ vision: false, reasoning: false });
    await expect(client.modelCapabilities(unslothEndpoint, 'c/unknown')).resolves.toEqual({ vision: null, reasoning: null });
  });

  it('한 모델을 별칭과 전체 이름으로 함께 불러옴으로 주면 한 모델로 보고 둘 다 같은 정보를 쓴다', async () => {
    unslothMock.mockImplementation(async (url) =>
      url.endsWith('/v1/status') ? Response.json({ ...idleStatus, supports_reasoning: true }) : Response.json({ enabled: false, auto_unload_idle_seconds: 0 }),
    );
    fetchMock.mockImplementation(async (url) =>
      url.endsWith('/v1/models')
        ? Response.json({ data: ['Flash-GGUF', 'unsloth/Flash-GGUF', 'other/Plain'].map((id) => ({ id, owned_by: 'unsloth-studio', loaded: id !== 'other/Plain' })) })
        : reply('ok'),
    );
    const models = await new LlmClient().listModels(unslothEndpoint);
    expect(models.map((m) => [m.id, m.loaded, m.reasoning])).toEqual([
      ['Flash-GGUF', true, true],
      ['unsloth/Flash-GGUF', true, true],
      ['other/Plain', false, null],
    ]);
  });

  it('modelContextLength: 불러온 모델의 Context Length가 먼저(없으면 최대값), 모르면 관리자가 넣은 값', async () => {
    unsloth({ loaded: ['a/think'], status: { ...idleStatus, context_length: 8192, max_context_length: 262144 } });
    const client = new LlmClient();
    expect(await client.modelContextLength({ ...unslothEndpoint, contextLength: 4096 }, 'a/think')).toBe(8192);
    expect(await client.modelContextLength(unslothEndpoint, 'b/plain')).toBeNull();
    expect(await client.modelContextLength({ ...unslothEndpoint, contextLength: 4096 }, 'b/plain')).toBe(4096);
    unsloth({ loaded: ['a/think'], status: { ...idleStatus, context_length: null, max_context_length: 131072 } });
    expect(await new LlmClient().modelContextLength(unslothEndpoint, 'a/think')).toBe(131072);
  });

  it('모델 목록: check-embedding으로 임베딩 모델을 알리고, 불러온 모델의 문맥 길이를 싣는다', async () => {
    unsloth({ loaded: ['a/think'], status: { ...idleStatus, context_length: 8192 }, embedding: { 'a/think': false, 'b/plain': true } });
    const models = await new LlmClient().listModels(unslothEndpoint);
    expect(models.map((m) => [m.id, m.type, m.contextLength])).toEqual([
      ['a/think', 'llm', 8192],
      ['b/plain', 'embeddings', null],
    ]);
  });
});

describe('LlmClient 그 밖의 OpenAI 호환 서버의 관리자 설정 (이슈 #465)', () => {
  it('modelContextLength: 관리자가 넣은 값을 쓰고, LM Studio면 쓰지 않는다', async () => {
    await expect(new LlmClient().modelContextLength({ ...endpoint, contextLength: 32768 }, 'm')).resolves.toBe(32768);
    modelsMock.mockResolvedValue(lmStudioModels([{ key: 'm' }]));
    await expect(new LlmClient().modelContextLength({ ...endpoint, contextLength: 32768 }, 'm')).resolves.toBeNull();
  });

  it('modelCapabilities는 관리자 설정을 그대로, LM Studio면 관리자 설정을 쓰지 않는다', async () => {
    await expect(new LlmClient().modelCapabilities({ ...endpoint, visionSupport: true, reasoningSupport: false }, 'm')).resolves.toEqual({ vision: true, reasoning: false });
    modelsMock.mockResolvedValue(lmStudioModels([{ key: 'm' }]));
    await expect(new LlmClient().modelCapabilities({ ...endpoint, visionSupport: true, reasoningSupport: true }, 'x')).resolves.toEqual({ vision: null, reasoning: null });
  });

  it('생각 정도 지원을 켜면 reasoning_effort만 보내고(끄기는 none) enable_thinking·top_k는 보내지 않는다', async () => {
    fetchMock.mockImplementation(async () => reply('ok'));
    const client = new LlmClient();
    await client.chat({ ...endpoint, reasoningSupport: true }, 'm', [], LLM_PROFILE.ASSISTANT);
    await client.chat({ ...endpoint, reasoningSupport: true }, 'm', [], LLM_PROFILE.CONNECTION_TEST);
    const [on, off] = fetchMock.mock.calls.map(bodyOf);
    expect(on).toMatchObject({ reasoning_effort: 'medium' });
    expect(off).toMatchObject({ reasoning_effort: 'none' });
    for (const body of [on, off]) {
      expect(body).not.toHaveProperty('enable_thinking');
      expect(body).not.toHaveProperty('top_k');
    }
  });
});
