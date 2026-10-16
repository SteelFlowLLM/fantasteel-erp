// 스트림으로 답 받기: 이벤트가 대화 저장소에 쌓이고, 멈춤·끊김·서버 오류가 실패 줄로 남는다.
import type { AiAssistantStreamEvent } from '@fantasteel/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiAssistantApi } from '@/api/aiAssistant';
import { runAiAsk, stopAiAssistant } from '@/hooks/useAiAssistant';
import { useAiChatStore } from '@/stores/useAiChatStore';

const store = () => useAiChatStore.getState();
const SCREEN = { path: '/', title: '대시보드', label: null };
const DONE: AiAssistantStreamEvent = { type: 'done', reply: { answer: '최종 답', sources: [], model: 'm', latencyMs: 1, toolCalls: [], thinking: null, reasoningApplied: false, actionCards: [] } };

beforeEach(() => useAiChatStore.setState({ ownerEmployeeId: null, entries: [], pendingId: null, live: null }));
afterEach(() => vi.restoreAllMocks());

const PHOTO = { mediaType: 'image/jpeg' as const, dataBase64: 'QUJD' };

function ask(reasoning?: 'off' | 'high', images?: (typeof PHOTO)[], webSearch?: boolean) {
  store().addQuestion('q1', '질문', reasoning, images, webSearch);
  return runAiAsk({ questionId: 'q1', question: '질문', screen: SCREEN, history: [], reasoning, images, webSearch });
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

  it('웹 검색을 켠 질문만 webSearch: true를 보낸다', async () => {
    const spy = vi.spyOn(aiAssistantApi, 'askStream').mockImplementation(async (_input, onEvent) => onEvent(DONE));
    await ask(undefined, undefined, true);
    expect(spy.mock.calls[0][0]).toMatchObject({ question: '질문', webSearch: true });
    await ask(undefined, undefined, false);
    expect(spy.mock.calls[1][0]).not.toHaveProperty('webSearch');
    await ask();
    expect(spy.mock.calls[2][0]).not.toHaveProperty('webSearch');
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
