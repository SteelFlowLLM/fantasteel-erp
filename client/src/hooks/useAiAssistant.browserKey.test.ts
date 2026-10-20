// 브라우저 탭을 이어 쓰는 대화 열쇠 (이슈 #423): 같은 대화는 같은 열쇠, 새 대화는 새 열쇠.
import type { AiAssistantStreamEvent } from '@fantasteel/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiAssistantApi } from '@/api/aiAssistant';
import { bindBrowserSession, browserSessionIdFor, runAiAsk } from '@/hooks/useAiAssistant';
import { useAiChatStore } from '@/stores/useAiChatStore';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SCREEN = { path: '/', title: '대시보드', label: null };
const doneWithThread = (id: number): AiAssistantStreamEvent => ({
  type: 'done',
  reply: { answer: '답', sources: [], model: 'm', latencyMs: 1, toolCalls: [], thinking: null, reasoningApplied: false, actionCards: [] },
  thread: { id, title: '대화', assistantMessageId: 1 },
});

describe('browserSessionIdFor · bindBrowserSession', () => {
  it('새 대화는 UUID 열쇠를 만들고, 첫 답이 저장되기 전 이어 묻는 질문은 같은 열쇠를 쓴다', () => {
    const first = browserSessionIdFor(null, true);
    expect(first).toMatch(UUID);
    expect(browserSessionIdFor(null, false)).toBe(first);
    expect(browserSessionIdFor(null, false)).toBe(first);
  });

  it('대화 id가 생기면 그 대화에 묶어, 이어 묻는 질문(threadId 7)이 같은 열쇠를 쓴다', () => {
    const key = browserSessionIdFor(null, true);
    bindBrowserSession(7);
    expect(browserSessionIdFor(7, false)).toBe(key);
    expect(browserSessionIdFor(7, true)).toBe(key);
  });

  it('묶은 뒤 새 대화를 시작하면 새 열쇠이고, 이미 묶인 대화는 그대로다', () => {
    const old = browserSessionIdFor(7, false);
    const fresh = browserSessionIdFor(null, true);
    expect(fresh).toMatch(UUID);
    expect(fresh).not.toBe(old);
    bindBrowserSession(8);
    expect(browserSessionIdFor(8, false)).toBe(fresh);
    expect(browserSessionIdFor(7, false)).toBe(old);
    // 이미 열쇠가 있는 대화에 다시 묶어도 바뀌지 않는다
    browserSessionIdFor(null, true);
    bindBrowserSession(8);
    expect(browserSessionIdFor(8, false)).toBe(fresh);
  });

  it('묶을 새 열쇠가 없으면 아무 일도 없고, 모르는 대화 id는 열쇠를 새로 만들어 기억한다', () => {
    expect(() => bindBrowserSession(99)).not.toThrow();
    const created = browserSessionIdFor(123, false);
    expect(created).toMatch(UUID);
    expect(browserSessionIdFor(123, false)).toBe(created);
  });
});

describe('runAiAsk의 browserSessionId', () => {
  beforeEach(() => useAiChatStore.setState({ ownerEmployeeId: null, threadId: null, entries: [], pendingId: null, live: null }));
  afterEach(() => vi.restoreAllMocks());

  it('브라우저를 켠 질문만 열쇠를 보내고, 새 대화의 첫 답이 저장되면 다음 질문이 같은 열쇠를 쓴다', async () => {
    const sent: Array<{ browser?: boolean; browserSessionId?: string }> = [];
    vi.spyOn(aiAssistantApi, 'askStream').mockImplementation(async (input, onEvent) => {
      sent.push(input);
      onEvent(doneWithThread(41));
    });
    const store = () => useAiChatStore.getState();

    store().addQuestion('q1', '요로 찾아줘', undefined, undefined, undefined, true);
    await runAiAsk({ questionId: 'q1', question: '요로 찾아줘', screen: SCREEN, threadId: null, browser: true });
    expect(store().threadId).toBe(41);

    store().addQuestion('q2', '다음 페이지', undefined, undefined, undefined, true);
    await runAiAsk({ questionId: 'q2', question: '다음 페이지', screen: SCREEN, threadId: store().threadId, browser: true });

    store().addQuestion('q3', '그냥 질문');
    await runAiAsk({ questionId: 'q3', question: '그냥 질문', screen: SCREEN, threadId: store().threadId });

    expect(sent[0].browser).toBe(true);
    expect(sent[0].browserSessionId).toMatch(UUID);
    expect(sent[1].browserSessionId).toBe(sent[0].browserSessionId);
    expect(sent[2]).not.toHaveProperty('browser');
    expect(sent[2]).not.toHaveProperty('browserSessionId');
  });
});
