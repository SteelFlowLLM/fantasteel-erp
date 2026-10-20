// 스트림으로 답 받기: 이벤트가 대화 저장소에 쌓이고, 멈춤·끊김·서버 오류가 실패 줄로 남는다.
import type { AiAssistantStreamEvent } from '@fantasteel/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiAssistantApi } from '@/api/aiAssistant';
import { controlAiAgent, runAiAsk, stopAiAssistant } from '@/hooks/useAiAssistant';
import { useAiChatStore } from '@/stores/useAiChatStore';

const store = () => useAiChatStore.getState();
const SCREEN = { path: '/', title: '대시보드', label: null };
const DONE: AiAssistantStreamEvent = { type: 'done', reply: { answer: '최종 답', sources: [], model: 'm', latencyMs: 1, toolCalls: [], thinking: null, reasoningApplied: false, actionCards: [] } };

beforeEach(() => useAiChatStore.setState({ ownerEmployeeId: null, threadId: null, entries: [], pendingId: null, live: null }));
afterEach(() => vi.restoreAllMocks());

const PHOTO = { mediaType: 'image/jpeg' as const, dataBase64: 'QUJD' };

function ask(reasoning?: 'off' | 'high', images?: (typeof PHOTO)[], webSearch?: boolean) {
  store().addQuestion('q1', '질문', reasoning, images, webSearch);
  return runAiAsk({ questionId: 'q1', question: '질문', screen: SCREEN, threadId: null, reasoning, images, webSearch });
}

describe('runAiAsk', () => {
  it('이벤트를 저장소에 쌓고 done에서 최종 답으로 바꾼다. 생각 정도는 정한 질문에만 보낸다', async () => {
    const spy = vi.spyOn(aiAssistantApi, 'askStream').mockImplementation(async (_input, onEvent) => {
      onEvent({ type: 'thinking', text: '음' });
      onEvent({ type: 'answer', text: '원문 [출처]' });
      onEvent(DONE);
    });
    await ask('high');
    // 철강맨AI 패널의 질문이라 실행 카드도 함께 달라고 한다
    expect(spy.mock.calls[0][0]).toMatchObject({ question: '질문', reasoning: 'high', actionCards: true });
    expect(store().pendingId).toBeNull();
    expect(store().entries.at(-1)).toMatchObject({ role: 'assistant', content: '최종 답', requestedReasoning: 'high', reasoningApplied: false });

    await ask();
    expect(spy.mock.calls[1][0]).not.toHaveProperty('reasoning');
  });

  it('지난 대화 대신 저장을 요청하고, 서버가 저장한 대화를 이어 묻는다 (이슈 #399)', async () => {
    const spy = vi.spyOn(aiAssistantApi, 'askStream').mockImplementation(async (_input, onEvent) => onEvent({ ...DONE, thread: { id: 41, title: '질문', assistantMessageId: 82 } }));
    await ask();
    expect(spy.mock.calls[0][0]).toMatchObject({ saveThread: true });
    expect(spy.mock.calls[0][0]).not.toHaveProperty('threadId');
    expect(spy.mock.calls[0][0]).not.toHaveProperty('history');
    expect(store().threadId).toBe(41);
    expect(store().entries.at(-1)).toMatchObject({ role: 'assistant', messageId: 82 });

    store().addQuestion('q2', '이어서', undefined);
    await runAiAsk({ questionId: 'q2', question: '이어서', screen: SCREEN, threadId: store().threadId });
    expect(spy.mock.calls[1][0]).toMatchObject({ saveThread: true, threadId: 41 });
  });

  it('저장에 실패한 답은 저장하지 못했다고 표시하고 대화 id는 그대로 둔다', async () => {
    vi.spyOn(aiAssistantApi, 'askStream').mockImplementation(async (_input, onEvent) => onEvent({ ...DONE, thread: null }));
    useAiChatStore.setState({ threadId: 7 });
    await ask();
    expect(store().threadId).toBe(7);
    expect(store().entries.at(-1)).toMatchObject({ role: 'assistant', unsaved: true });
  });

  it('웹 검색을 켠 질문만 webSearch: true를 보낸다', async () => {
    const spy = vi.spyOn(aiAssistantApi, 'askStream').mockImplementation(async (_input, onEvent) => onEvent(DONE));
    await ask(undefined, undefined, true);
    expect(spy.mock.calls[0][0]).toMatchObject({ question: '질문', webSearch: true });
    await ask(undefined, undefined, false);
    expect(spy.mock.calls[1][0]).not.toHaveProperty('webSearch');
    await ask();
    expect(spy.mock.calls[2][0]).not.toHaveProperty('webSearch');
  });

  it('브라우저 사용을 켠 질문만 browser: true를 보낸다', async () => {
    const spy = vi.spyOn(aiAssistantApi, 'askStream').mockImplementation(async (_input, onEvent) => onEvent(DONE));
    store().addQuestion('q1', '질문', undefined, undefined, undefined, true);
    await runAiAsk({ questionId: 'q1', question: '질문', screen: SCREEN, threadId: null, browser: true });
    expect(spy.mock.calls[0][0]).toMatchObject({ question: '질문', browser: true });
    await ask();
    expect(spy.mock.calls[1][0]).not.toHaveProperty('browser');
  });

  it('사진은 질문과 함께 보내고, 없으면 images 필드를 보내지 않는다', async () => {
    const spy = vi.spyOn(aiAssistantApi, 'askStream').mockImplementation(async (_input, onEvent) => onEvent(DONE));
    await ask(undefined, [PHOTO]);
    expect(spy.mock.calls[0][0]).toMatchObject({ question: '질문', images: [PHOTO] });
    await ask(undefined, []);
    expect(spy.mock.calls[1][0]).not.toHaveProperty('images');
  });

  it('사진 질문이 실패하면 실패 줄이 사진을 들고 있다 (모델이 사진을 못 보면 서버 400)', async () => {
    vi.spyOn(aiAssistantApi, 'askStream').mockRejectedValue(new Error('지금 모델은 사진을 볼 수 없어요'));
    await ask(undefined, [PHOTO]);
    expect(store().entries.at(-1)).toMatchObject({ role: 'failure', content: '지금 모델은 사진을 볼 수 없어요', images: [PHOTO] });
  });

  it('done 없이 연결이 끝나면 실패 줄을 남긴다', async () => {
    vi.spyOn(aiAssistantApi, 'askStream').mockImplementation(async (_input, onEvent) => onEvent({ type: 'answer', text: '반쯤' }));
    await ask();
    expect(store().entries.at(-1)).toMatchObject({ role: 'failure', question: '질문' });
    expect(store().pendingId).toBeNull();
  });

  it('요청이 실패하면 오류 문구를 실패 줄로 남긴다', async () => {
    vi.spyOn(aiAssistantApi, 'askStream').mockRejectedValue(new Error('모델이 설정되지 않았어요'));
    await ask();
    expect(store().entries.at(-1)).toMatchObject({ role: 'failure', content: '모델이 설정되지 않았어요' });
  });

  it('멈추면 연결을 끊고 실패 줄은 멈췄어요로 남는다', async () => {
    vi.spyOn(aiAssistantApi, 'askStream').mockImplementation(
      (_input, _onEvent, signal) => new Promise<void>((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    );
    const running = ask();
    expect(store().pendingId).toBe('q1');
    stopAiAssistant();
    await running;
    expect(store().entries.at(-1)).toMatchObject({ role: 'failure', content: '멈췄어요', question: '질문' });
    expect(store().pendingId).toBeNull();
  });

  it('대화를 비우면 받던 연결을 끊고 늦은 결과는 버린다', async () => {
    let aborted = false;
    vi.spyOn(aiAssistantApi, 'askStream').mockImplementation(
      (_input, _onEvent, signal) =>
        new Promise<void>((_resolve, reject) =>
          signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new DOMException('aborted', 'AbortError'));
          }),
        ),
    );
    const running = ask();
    store().clear();
    await running;
    expect(aborted).toBe(true);
    expect(store().entries).toEqual([]);
  });
});

describe('controlAiAgent (이슈 #425)', () => {
  const CONTROL_ID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  const requested = () => store().live?.control?.requested;

  it('멈추기·한 단계는 멈추기를 기다리는 상태(requested true)로 두고 서버에 명령을 보낸다', async () => {
    const spy = vi.spyOn(aiAssistantApi, 'controlAgent').mockResolvedValue({ accepted: true });
    store().addQuestion('q1', '질문', undefined, undefined, undefined, true, CONTROL_ID);
    await controlAiAgent('pause');
    expect(requested()).toBe(true);
    await controlAiAgent('step');
    expect(requested()).toBe(true);
    expect(spy.mock.calls).toEqual([[CONTROL_ID, 'pause'], [CONTROL_ID, 'step']]);
  });

  it('계속은 requested를 false로 되돌린다', async () => {
    const spy = vi.spyOn(aiAssistantApi, 'controlAgent').mockResolvedValue({ accepted: true });
    store().addQuestion('q1', '질문', undefined, undefined, undefined, true, CONTROL_ID);
    await controlAiAgent('pause');
    await controlAiAgent('resume');
    expect(requested()).toBe(false);
    expect(spy).toHaveBeenLastCalledWith(CONTROL_ID, 'resume');
  });

  it('보내기에 실패하면(답이 이미 끝남 등) 오류를 던지지 않고 requested를 false로 되돌린다', async () => {
    vi.spyOn(aiAssistantApi, 'controlAgent').mockRejectedValue(new Error('답하는 중인 브라우저·화면 조작이 없어요'));
    store().addQuestion('q1', '질문', undefined, undefined, undefined, true, CONTROL_ID);
    await expect(controlAiAgent('pause')).resolves.toBeUndefined();
    expect(requested()).toBe(false);
  });

  it('요청이 실패하기 전에 답이 바뀌었으면 새 질문의 상태는 건드리지 않는다', async () => {
    let fail: (reason: Error) => void = () => undefined;
    vi.spyOn(aiAssistantApi, 'controlAgent').mockImplementation(() => new Promise((_resolve, reject) => void (fail = reject)));
    store().addQuestion('q1', '질문', undefined, undefined, undefined, true, CONTROL_ID);
    const sending = controlAiAgent('pause');
    store().addAnswer('q1', '답', []);
    store().addQuestion('q2', '다음', undefined, undefined, undefined, true, 'bbbbbbbb-3b7d-4bad-9bdd-2b0d7b3dcb6d');
    store().setControlRequested('q2', true);
    fail(new Error('끝남'));
    await sending;
    expect(store().live?.control).toMatchObject({ id: 'bbbbbbbb-3b7d-4bad-9bdd-2b0d7b3dcb6d', requested: true });
  });

  it('답하는 중인 질문이 없거나 멈출 수 없는 답(control 없음)이면 서버에 보내지 않는다', async () => {
    const spy = vi.spyOn(aiAssistantApi, 'controlAgent').mockResolvedValue({ accepted: true });
    await controlAiAgent('pause');
    store().addQuestion('q1', '질문');
    await controlAiAgent('pause');
    expect(spy).not.toHaveBeenCalled();
    expect(store().live?.control).toBeNull();
  });
});

describe('runAiAsk의 agentControlId (이슈 #425)', () => {
  const CONTROL_ID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

  it('열쇠가 있으면 agentControlId로 보내고, 없으면 필드를 보내지 않는다', async () => {
    const spy = vi.spyOn(aiAssistantApi, 'askStream').mockImplementation(async (_input, onEvent) => onEvent(DONE));
    store().addQuestion('q1', '질문', undefined, undefined, undefined, true, CONTROL_ID);
    await runAiAsk({ questionId: 'q1', question: '질문', screen: SCREEN, threadId: null, browser: true, controlId: CONTROL_ID });
    store().addQuestion('q2', '질문');
    await runAiAsk({ questionId: 'q2', question: '질문', screen: SCREEN, threadId: null });
    expect(spy.mock.calls[0][0]).toMatchObject({ agentControlId: CONTROL_ID });
    expect(spy.mock.calls[1][0]).not.toHaveProperty('agentControlId');
  });

  it('서버가 보낸 agent_paused·browser_live가 같은 질문의 live에 쌓인다', async () => {
    let seen: ReturnType<typeof store>['live'] = null;
    vi.spyOn(aiAssistantApi, 'askStream').mockImplementation(async (_input, onEvent) => {
      onEvent({ type: 'browser_live', url: 'example.kr', imageBase64: 'QUJD', at: '2026-10-20T00:00:00.000Z' });
      onEvent({ type: 'agent_paused', tool: 'browser_open' });
      seen = store().live;
      onEvent(DONE);
    });
    store().addQuestion('q1', '질문', undefined, undefined, undefined, true, CONTROL_ID);
    await runAiAsk({ questionId: 'q1', question: '질문', screen: SCREEN, threadId: null, browser: true, controlId: CONTROL_ID });
    expect(seen).toMatchObject({ liveFrame: { url: 'example.kr' }, control: { id: CONTROL_ID, pausedBefore: 'browser_open' } });
  });
});
