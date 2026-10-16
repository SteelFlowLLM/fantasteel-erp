// AI 어시스턴트 대화 저장소: 대화는 이 탭 메모리에만 두고, 서버에는 답을 받은 지난 대화만 보낸다.
import type { AiAssistantReplyView } from '@fantasteel/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { AI_CHAT_HISTORY_LIMIT, AI_CHAT_STOPPED_REASON, aiChatHistory, useAiChatStore, type AiChatEntry } from '@/stores/useAiChatStore';

const store = () => useAiChatStore.getState();
const SOURCE = { kind: 'GLOSSARY' as const, id: 'TRM-056', label: '예약' };

beforeEach(() => useAiChatStore.setState({ ownerEmployeeId: null, entries: [], pendingId: null, live: null }));

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

const REPLY: AiAssistantReplyView = {
  answer: '재고는 120.000톤이에요.',
  sources: [{ kind: 'DATA', id: 'get_inventory', label: '재고 · SS275' }],
  model: 'm',
  latencyMs: 10,
  toolCalls: [],
  thinking: null,
  reasoningApplied: true,
};

describe('실시간 답 (스트림 이벤트)', () => {
  it('생각 → 조회 → 답 이벤트가 순서대로 쌓이고, done이 오면 최종 답과 단계가 대화에 남는다', () => {
    store().addQuestion('q1', '재고 알려줘', 'high');
    store().applyStreamEvent('q1', { type: 'thinking', text: '재고를 ' }, 1000);
    store().applyStreamEvent('q1', { type: 'thinking', text: '봐야겠다' }, 2000);
    expect(store().live?.steps).toEqual([{ kind: 'thinking', text: '재고를 봐야겠다', startedAt: 1000, endedAt: null }]);

    store().applyStreamEvent('q1', { type: 'tool_start', id: 't1', name: 'get_inventory', arguments: '{"grade":"SS275"}' }, 9000);
    expect(store().live?.steps).toEqual([
      { kind: 'thinking', text: '재고를 봐야겠다', startedAt: 1000, endedAt: 9000 },
      { kind: 'tool', id: 't1', name: 'get_inventory', arguments: '{"grade":"SS275"}', result: null },
    ]);

    store().applyStreamEvent('q1', { type: 'tool_end', id: 't1', label: '재고 · SS275', resultPreview: '120.000', durationMs: 300 }, 9300);
    store().applyStreamEvent('q1', { type: 'answer', text: '재고는 ' }, 9400);
    store().applyStreamEvent('q1', { type: 'answer', text: '120톤[출처]' }, 9500);
    expect(store().live?.answer).toBe('재고는 120톤[출처]');
    expect(store().pendingId).toBe('q1');

    store().applyStreamEvent('q1', { type: 'done', reply: REPLY }, 9600);
    expect(store().pendingId).toBeNull();
    expect(store().live).toBeNull();
    const answer = store().entries.at(-1);
    expect(answer).toMatchObject({ role: 'assistant', content: '재고는 120.000톤이에요.', sources: REPLY.sources, requestedReasoning: 'high', reasoningApplied: true });
    expect(answer?.role === 'assistant' ? answer.steps?.map((step) => step.kind) : null).toEqual(['thinking', 'tool']);
    // 대화 기록에는 최종 답만 들어간다
    expect(aiChatHistory(store().entries)).toEqual([
      { role: 'user', content: '재고 알려줘' },
      { role: 'assistant', content: '재고는 120.000톤이에요.' },
    ]);
  });

  it('답 글 뒤에 도구를 부르면 그 글은 중간 메모가 되고 답 글은 새로 시작한다', () => {
    store().addQuestion('q1', '재고 알려줘');
    store().applyStreamEvent('q1', { type: 'answer', text: '먼저 조회해 볼게요' });
    store().applyStreamEvent('q1', { type: 'tool_start', id: 't1', name: 'get_inventory', arguments: '{}' });
    expect(store().live?.answer).toBe('');
    expect(store().live?.steps.map((step) => step.kind)).toEqual(['note', 'tool']);
    expect(store().live?.steps[0]).toEqual({ kind: 'note', text: '먼저 조회해 볼게요' });
  });

  it('생각 정도를 보내지 않은 질문의 답에는 생각 정도 정보를 담지 않는다', () => {
    store().addQuestion('q1', '요약해 줘');
    store().applyStreamEvent('q1', { type: 'done', reply: REPLY });
    expect(store().entries.at(-1)).not.toHaveProperty('requestedReasoning');
  });

  it('이벤트 없이 done만 와도 답에 담긴 조회 기록으로 단계를 만든다', () => {
    store().addQuestion('q1', '재고 알려줘');
    store().applyStreamEvent('q1', {
      type: 'done',
      reply: { ...REPLY, thinking: '생각했다', toolCalls: [{ name: 'get_inventory', arguments: '{}', resultPreview: '120', durationMs: 5 }] },
    });
    const answer = store().entries.at(-1);
    expect(answer?.role === 'assistant' ? answer.steps?.map((step) => step.kind) : null).toEqual(['thinking', 'tool']);
  });

  it('error 이벤트는 실패 줄이 되고 다시 물을 때 보낼 생각 정도를 담는다', () => {
    store().addQuestion('q1', '재고 알려줘', 'low');
    store().applyStreamEvent('q1', { type: 'error', message: '모델이 설정되지 않았어요' });
    expect(store().pendingId).toBeNull();
    expect(store().entries.at(-1)).toMatchObject({ role: 'failure', content: '모델이 설정되지 않았어요', question: '재고 알려줘', reasoning: 'low' });
  });

  it('대화를 비운 뒤 늦게 온 이벤트는 버린다', () => {
    store().addQuestion('q1', '재고 알려줘');
    store().clear();
    store().applyStreamEvent('q1', { type: 'answer', text: '늦은 글' });
    store().applyStreamEvent('q1', { type: 'done', reply: REPLY });
    expect(store()).toMatchObject({ entries: [], live: null, pendingId: null });
  });

  it('멈춘 질문은 실패 줄로 남고 다시 물을 수 있다', () => {
    store().addQuestion('q1', '재고 알려줘');
    store().applyStreamEvent('q1', { type: 'answer', text: '반쯤' });
    store().addFailure('q1', '재고 알려줘', AI_CHAT_STOPPED_REASON);
    expect(store().live).toBeNull();
    const failure = store().entries.at(-1);
    expect(failure).toMatchObject({ role: 'failure', content: '멈췄어요' });
    store().removeFailure(failure?.id ?? '');
    expect(store().entries).toEqual([]);
  });
});
