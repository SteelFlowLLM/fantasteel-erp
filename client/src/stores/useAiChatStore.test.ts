// AI 어시스턴트 대화 저장소: 대화는 이 탭 메모리에만 두고, 서버에는 답을 받은 지난 대화만 보낸다.
import { beforeEach, describe, expect, it } from 'vitest';
import { AI_CHAT_HISTORY_LIMIT, aiChatHistory, useAiChatStore, type AiChatEntry } from '@/stores/useAiChatStore';

const store = () => useAiChatStore.getState();
const SOURCE = { kind: 'GLOSSARY' as const, id: 'TRM-056', label: '예약' };

beforeEach(() => useAiChatStore.setState({ ownerEmployeeId: null, entries: [], pendingId: null }));

describe('AI 대화 저장소', () => {
  it('질문을 넣으면 답을 기다리고, 답이 오면 질문 뒤에 붙는다', () => {
    store().addQuestion('q1', '예약이 뭐야?');
    expect(store().pendingId).toBe('q1');
    store().addAnswer('q1', '예약은 매수를 확보하는 거예요.', [SOURCE]);
    expect(store().pendingId).toBeNull();
    expect(store().entries.map((e) => [e.role, e.content])).toEqual([
      ['user', '예약이 뭐야?'],
      ['assistant', '예약은 매수를 확보하는 거예요.'],
    ]);
  });

  it('실행 카드는 답에 붙고, 카드 하나만 닫거나 실행 결과를 적을 수 있다', () => {
    const a = { key: 'a1', kind: 'TASK' as const, title: '견적서 보내기', description: null, assigneeId: 7, assigneeName: null, dueDate: '2026-10-20', startAt: null, endAt: null, endAssumed: false, attendeeIds: [], purchase: null, itemName: null, issues: [] };
    store().addQuestion('q1', '견적서 보내기 업무 등록해줘');
    store().addAnswer('q1', '카드를 만들었어요.', [], [a, { ...a, key: 'a2' }]);
    const entry = store().entries[1];
    if (entry.role !== 'assistant') throw new Error('답이 아니에요');
    expect(entry.cards?.map((c) => c.status)).toEqual(['ready', 'ready']);
    store().updateCard(entry.id, 'a1', { status: 'done', result: { type: 'task', id: 9 } });
    store().updateCard(entry.id, 'a2', { status: 'dismissed' });
    const after = store().entries[1];
    if (after.role !== 'assistant') throw new Error('답이 아니에요');
    expect(after.cards?.map((c) => [c.status, c.result?.id])).toEqual([['done', 9], ['dismissed', undefined]]);
  });

  it('카드가 없는 답에는 cards 칸을 만들지 않는다', () => {
    store().addQuestion('q1', '예약이 뭐야?');
    store().addAnswer('q1', '답이에요', []);
    expect(store().entries[1]).not.toHaveProperty('cards');
  });

  it('대화를 비운 뒤 늦게 온 답은 버린다', () => {
    store().addQuestion('q1', '예약이 뭐야?');
    store().clear();
    store().addAnswer('q1', '늦은 답', []);
    store().addFailure('q1', '예약이 뭐야?', '늦은 실패');
    expect(store().entries).toEqual([]);
  });

  it('다른 사원으로 들어오면 대화를 비우고, 같은 사원이면 그대로 둔다', () => {
    store().claim(1);
    store().addQuestion('q1', '예약이 뭐야?');
    store().claim(1);
    expect(store().entries).toHaveLength(1);
    store().claim(2);
    expect(store()).toMatchObject({ ownerEmployeeId: 2, entries: [], pendingId: null });
  });

  it('다시 물을 때 실패 줄과 그 질문을 지운다', () => {
    store().addQuestion('q1', '예약이 뭐야?');
    store().addAnswer('q1', '답', []);
    store().addQuestion('q2', '배정이 뭐야?');
    store().addFailure('q2', '배정이 뭐야?', '응답이 없어요');
    const failure = store().entries.at(-1);
    expect(failure?.role).toBe('failure');
    store().removeFailure(failure?.id ?? '');
    expect(store().entries.map((e) => e.content)).toEqual(['예약이 뭐야?', '답']);
  });
});

describe('서버로 보낼 지난 대화', () => {
  it('답을 받은 질문과 답만 보내고, 실패한 질문은 빼며, 최근 것만 남긴다', () => {
    const entries: AiChatEntry[] = [
      { id: '1', role: 'user', content: '예약이 뭐야?' },
      { id: '2', role: 'assistant', content: '예약은 …', sources: [SOURCE] },
      { id: '3', role: 'user', content: '배정은?' },
      { id: '4', role: 'failure', content: '응답이 없어요', question: '배정은?' },
    ];
    expect(aiChatHistory(entries)).toEqual([
      { role: 'user', content: '예약이 뭐야?' },
      { role: 'assistant', content: '예약은 …' },
    ]);

    const many: AiChatEntry[] = Array.from({ length: AI_CHAT_HISTORY_LIMIT }, (_, i): AiChatEntry[] => [
      { id: `u${i}`, role: 'user', content: `질문 ${i}` },
      { id: `a${i}`, role: 'assistant', content: `답 ${i}`, sources: [] },
    ]).flat();
    const history = aiChatHistory(many);
    expect(history).toHaveLength(AI_CHAT_HISTORY_LIMIT);
    expect(history.at(-1)).toEqual({ role: 'assistant', content: `답 ${AI_CHAT_HISTORY_LIMIT - 1}` });
    expect(history[0].role).toBe('user');
  });
});
