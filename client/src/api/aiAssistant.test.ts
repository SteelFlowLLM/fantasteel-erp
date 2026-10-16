// 스트림 한 줄 읽기와 serverStream: 로그인 확인·오류 변환은 일반 요청과 같고, 조각난 NDJSON 응답을 이벤트로 돌려준다.
import type { AiAssistantStreamEvent } from '@fantasteel/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiAssistantApi, parseAiAssistantStreamEvent } from '@/api/aiAssistant';
import { isAbortError, resetServerSessionForTest } from '@/api/http';
import { actAs, SEED_EMPLOYEE_NO } from '@/test/actors';

afterEach(() => {
  vi.unstubAllGlobals();
  resetServerSessionForTest();
});

function stubStream(chunks: Uint8Array[], init: ResponseInit = { status: 200, headers: { 'content-type': 'application/x-ndjson' } }) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (url: string, requestInit: RequestInit) => {
    calls.push({ url: String(url), init: requestInit });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    return new Response(body, init);
  });
  return calls;
}

function login() {
  actAs(SEED_EMPLOYEE_NO.sales);
  resetServerSessionForTest(SEED_EMPLOYEE_NO.sales);
}

describe('parseAiAssistantStreamEvent', () => {
  it('알려진 이벤트는 읽고, 모르는 종류는 건너뛰고, JSON이 아니면 오류다', () => {
    expect(parseAiAssistantStreamEvent('{"type":"answer","text":"가"}')).toEqual({ type: 'answer', text: '가' });
    expect(parseAiAssistantStreamEvent('{"type":"heartbeat"}')).toBeNull();
    expect(() => parseAiAssistantStreamEvent('not json')).toThrow('서버 응답을 읽을 수 없어요');
    expect(() => parseAiAssistantStreamEvent('[1]')).toThrow('서버 응답을 읽을 수 없어요');
  });
});

describe('aiAssistantApi.askStream', () => {
  it('줄과 한글 글자 중간에서 끊긴 조각도 이벤트 순서대로 돌려주고 본문에 생각 정도를 담는다', async () => {
    const text = '{"type":"thinking","text":"재고를 볼게요"}\n{"type":"answer","text":"철강"}\n{"type":"done","reply":{"answer":"끝"}}\n';
    const all = new TextEncoder().encode(text);
    const calls = stubStream([all.slice(0, 20), all.slice(20, 33), all.slice(33)]);
    login();
    const events: AiAssistantStreamEvent[] = [];
    await aiAssistantApi.askStream({ question: '재고', reasoning: 'low' }, (event) => events.push(event));
    expect(events.map((event) => event.type)).toEqual(['thinking', 'answer', 'done']);
    expect(events[0]).toEqual({ type: 'thinking', text: '재고를 볼게요' });
    expect(calls[0].url).toMatch(/\/ai-assistant\/messages\/stream$/);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ question: '재고', reasoning: 'low' });
  });

  it('스트림 전에 실패하면 일반 API처럼 오류 응답을 화면 오류로 바꾼다', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: false, error: { code: 'COM-999', message: '모델이 설정되지 않았어요' } }), { status: 503, headers: { 'content-type': 'application/json' } }));
    login();
    await expect(aiAssistantApi.askStream({ question: '재고' }, () => undefined)).rejects.toThrow('모델이 설정되지 않았어요');
  });

  it('로그인하지 않았으면 요청을 보내지 않는다', async () => {
    const calls = stubStream([]);
    actAs(SEED_EMPLOYEE_NO.sales);
    await expect(aiAssistantApi.askStream({ question: '재고' }, () => undefined)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('멈추면 AbortError가 그대로 던져진다', async () => {
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      await new Promise<void>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      return new Response();
    });
    login();
    const controller = new AbortController();
    const running = aiAssistantApi.askStream({ question: '재고' }, () => undefined, controller.signal);
    controller.abort();
    await running.then(
      () => {
        throw new Error('멈추면 던져져야 해요');
      },
      (error: unknown) => expect(isAbortError(error)).toBe(true),
    );
  });
});
