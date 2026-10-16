// 스트림으로 답 받기: 이벤트가 대화 저장소에 쌓이고, 멈춤·끊김·서버 오류가 실패 줄로 남는다.
import type { AiAssistantStreamEvent } from '@fantasteel/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiAssistantApi } from '@/api/aiAssistant';
import { ApiError } from '@/api/errors';
import { decideAiApproval, runAiAsk, stopAiAssistant } from '@/hooks/useAiAssistant';
import { useToastStore } from '@/stores/useToastStore';
import { useAiChatStore } from '@/stores/useAiChatStore';

const store = () => useAiChatStore.getState();
const SCREEN = { path: '/', title: '대시보드', label: null };
const DONE: AiAssistantStreamEvent = { type: 'done', reply: { answer: '최종 답', sources: [], model: 'm', latencyMs: 1, toolCalls: [], thinking: null, reasoningApplied: false } };

beforeEach(() => {
  useAiChatStore.setState({ ownerEmployeeId: null, entries: [], pendingId: null, live: null });
  useToastStore.setState({ items: [] });
});
afterEach(() => vi.restoreAllMocks());

const PHOTO = { mediaType: 'image/jpeg' as const, dataBase64: 'QUJD' };

function ask(reasoning?: 'off' | 'high', images?: (typeof PHOTO)[]) {
  store().addQuestion('q1', '질문', reasoning, images);
  return runAiAsk({ questionId: 'q1', question: '질문', screen: SCREEN, history: [], reasoning, images });
}

describe('runAiAsk', () => {
  it('이벤트를 저장소에 쌓고 done에서 최종 답으로 바꾼다. 생각 정도는 정한 질문에만 보낸다', async () => {
    const spy = vi.spyOn(aiAssistantApi, 'askStream').mockImplementation(async (_input, onEvent) => {
      onEvent({ type: 'thinking', text: '음' });
      onEvent({ type: 'answer', text: '원문 [출처]' });
      onEvent(DONE);
    });
    await ask('high');
    expect(spy.mock.calls[0][0]).toMatchObject({ question: '질문', reasoning: 'high', approvalCards: true });
    expect(store().pendingId).toBeNull();
    expect(store().entries.at(-1)).toMatchObject({ role: 'assistant', content: '최종 답', requestedReasoning: 'high', reasoningApplied: false });

    await ask();
    expect(spy.mock.calls[1][0]).not.toHaveProperty('reasoning');
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

const REQUIRED: AiAssistantStreamEvent = {
  type: 'approval_required',
  approvalId: 'a1',
  toolId: 't1',
  toolName: 'add_my_schedule_event',
  title: '내 일정 추가: 주간 회의',
  details: [],
  expiresAt: '2026-10-16T10:10:00.000Z',
};

describe('decideAiApproval', () => {
  const startCard = () => {
    store().addQuestion('q1', '질문');
    store().applyStreamEvent('q1', REQUIRED);
  };

  it('보내는 동안 보내는 중이고, 성공해도 카드는 서버 이벤트가 올 때까지 끝나지 않는다', async () => {
    startCard();
    let release: () => void = () => undefined;
    const spy = vi.spyOn(aiAssistantApi, 'decideApproval').mockImplementation(() => new Promise((resolve) => (release = () => resolve({ approvalId: 'a1', decision: 'ALLOW' }))));
    const running = decideAiApproval('a1', 'ALLOW');
    expect(spy).toHaveBeenCalledWith('a1', 'ALLOW');
    expect(store().live?.approvals[0]).toMatchObject({ sending: 'ALLOW', resolution: null });
    release();
    await running;
    expect(store().live?.approvals[0]).toMatchObject({ sending: 'ALLOW', resolution: null });
    store().applyStreamEvent('q1', { type: 'approval_resolved', approvalId: 'a1', decision: 'ALLOW' });
    expect(store().live?.approvals[0]).toMatchObject({ sending: null, resolution: 'ALLOW' });
  });

  it('실패하면 다시 고를 수 있게 풀고 오류를 알린다', async () => {
    startCard();
    vi.spyOn(aiAssistantApi, 'decideApproval').mockRejectedValue(new ApiError('COM-002', '질문한 사원이 아니에요'));
    await decideAiApproval('a1', 'DENY');
    expect(store().live?.approvals[0]).toMatchObject({ sending: null, resolution: null });
    expect(useToastStore.getState().items).toMatchObject([{ kind: 'error' }]);
  });

  it('이미 처리된 카드(AST-002)는 오류 알림 없이 풀고 스트림의 상태를 따른다', async () => {
    startCard();
    vi.spyOn(aiAssistantApi, 'decideApproval').mockRejectedValue(new ApiError('AST-002', '이미 처리됐어요'));
    await decideAiApproval('a1', 'ALLOW');
    expect(store().live?.approvals[0].sending).toBeNull();
    expect(useToastStore.getState().items.map((item) => item.kind)).toEqual(['info']);
  });
});
