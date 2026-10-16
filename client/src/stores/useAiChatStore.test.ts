// AI 어시스턴트 대화 저장소: 대화는 이 탭 메모리에만 두고, 서버에는 답을 받은 지난 대화만 보낸다.
import type { AiAssistantReplyView, AiAssistantStreamEvent } from '@fantasteel/shared';
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

const PHOTO = { mediaType: 'image/jpeg' as const, dataBase64: 'QUJD' };

describe('질문에 붙인 사진', () => {
  it('질문 줄에 사진을 남기고, 사진이 없으면 필드를 만들지 않는다', () => {
    store().addQuestion('q1', '이 화면이 뭐야?', undefined, [PHOTO]);
    store().addAnswer('q1', '수주 화면이에요', []);
    store().addQuestion('q2', '예약이 뭐야?');
    expect(store().entries[0]).toEqual({ id: 'q1', role: 'user', content: '이 화면이 뭐야?', images: [PHOTO] });
    expect(store().entries[2]).not.toHaveProperty('images');
  });

  it('지난 대화에는 사진이 들어가지 않는다 (글만)', () => {
    store().addQuestion('q1', '이 화면이 뭐야?', undefined, [PHOTO]);
    store().addAnswer('q1', '수주 화면이에요', []);
    expect(aiChatHistory(store().entries)).toEqual([
      { role: 'user', content: '이 화면이 뭐야?' },
      { role: 'assistant', content: '수주 화면이에요' },
    ]);
    expect(JSON.stringify(aiChatHistory(store().entries))).not.toContain(PHOTO.dataBase64);
  });

  it('실패 줄이 사진을 들고 있어 다시 물을 때 같은 사진을 쓴다 (addFailure·error 이벤트 모두)', () => {
    store().addQuestion('q1', '이 화면이 뭐야?', 'low', [PHOTO]);
    store().addFailure('q1', '이 화면이 뭐야?', '응답이 없어요');
    expect(store().entries.at(-1)).toMatchObject({ role: 'failure', question: '이 화면이 뭐야?', reasoning: 'low', images: [PHOTO] });

    store().clear();
    store().addQuestion('q2', '이 화면이 뭐야?', undefined, [PHOTO]);
    store().applyStreamEvent('q2', { type: 'error', message: '모델이 사진을 볼 수 없어요' });
    expect(store().entries.at(-1)).toMatchObject({ role: 'failure', content: '모델이 사진을 볼 수 없어요', images: [PHOTO] });
  });

  it('사진 없는 질문의 실패 줄에는 사진 필드가 없다', () => {
    store().addQuestion('q1', '예약이 뭐야?');
    store().addFailure('q1', '예약이 뭐야?', '응답이 없어요');
    expect(store().entries.at(-1)).not.toHaveProperty('images');
  });

  it('다시 물으면 실패 줄과 사진 달린 질문을 지우고 같은 사진으로 새 질문을 넣는다', () => {
    store().addQuestion('q1', '이 화면이 뭐야?', undefined, [PHOTO]);
    store().addFailure('q1', '이 화면이 뭐야?', '응답이 없어요');
    const failure = store().entries.at(-1);
    if (failure?.role !== 'failure') throw new Error('실패 줄이 없어요');
    store().removeFailure(failure.id);
    store().addQuestion('q2', failure.question, failure.reasoning, failure.images);
    expect(store().entries).toEqual([{ id: 'q2', role: 'user', content: '이 화면이 뭐야?', images: [PHOTO] }]);
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

describe('승인 카드 (이슈 #362)', () => {
  const REQUIRED: Extract<AiAssistantStreamEvent, { type: 'approval_required' }> = {
    type: 'approval_required',
    approvalId: 'a1',
    toolId: 't1',
    toolName: 'add_my_schedule_event',
    title: '내 일정 추가: 주간 회의',
    details: [{ label: '날짜', value: '2026-10-19 (월)' }],
    expiresAt: '2026-10-16T10:10:00.000Z',
  };
  const EXECUTION: AiAssistantStreamEvent = { type: 'tool_execution', approvalId: 'a1', status: 'SUCCESS', message: '일정을 추가했어요', result: { table: 'schedule_event', id: 31, label: '주간 회의', linkPath: '/schedule?week=2026-10-19' }, attempts: 1 };

  it('카드가 도구 줄과 함께 쌓이고 서버 이벤트로만 끝난다', () => {
    store().addQuestion('q1', '일정 추가해 줘');
    store().applyStreamEvent('q1', { type: 'tool_start', id: 't1', name: 'add_my_schedule_event', arguments: '{}' });
    store().applyStreamEvent('q1', REQUIRED);
    store().setApprovalSending('a1', 'ALLOW');
    expect(store().live?.approvals[0]).toMatchObject({ approvalId: 'a1', toolId: 't1', sending: 'ALLOW', resolution: null });
    store().applyStreamEvent('q1', { type: 'approval_resolved', approvalId: 'a1', decision: 'ALLOW' });
    store().applyStreamEvent('q1', EXECUTION);
    expect(store().live?.approvals[0]).toMatchObject({ sending: null, resolution: 'ALLOW', execution: { status: 'SUCCESS' } });
  });

  it('done이 오면 카드가 답 줄에 남고, 카드가 없는 답에는 필드가 없다', () => {
    store().addQuestion('q1', '일정 추가해 줘');
    store().applyStreamEvent('q1', REQUIRED);
    store().applyStreamEvent('q1', { type: 'approval_resolved', approvalId: 'a1', decision: 'DENY' });
    store().applyStreamEvent('q1', { type: 'done', reply: REPLY });
    expect(store().entries.at(-1)).toMatchObject({ role: 'assistant', approvals: [{ approvalId: 'a1', resolution: 'DENY' }] });

    store().addQuestion('q2', '재고 알려줘');
    store().applyStreamEvent('q2', { type: 'done', reply: REPLY });
    expect(store().entries.at(-1)).not.toHaveProperty('approvals');
  });

  it('고르는 중에 멈추면 실패 줄이 그 카드를 거부됨으로 들고 있고, 이미 만든 일정의 링크는 남는다', () => {
    store().addQuestion('q1', '일정 두 개 추가해 줘');
    store().applyStreamEvent('q1', REQUIRED);
    store().applyStreamEvent('q1', { type: 'approval_resolved', approvalId: 'a1', decision: 'ALLOW' });
    store().applyStreamEvent('q1', EXECUTION);
    store().applyStreamEvent('q1', { ...REQUIRED, approvalId: 'a2', toolId: 't2' });
    store().addFailure('q1', '일정 두 개 추가해 줘', AI_CHAT_STOPPED_REASON);
    const failure = store().entries.at(-1);
    expect(failure).toMatchObject({ role: 'failure', approvals: [{ approvalId: 'a1', execution: { status: 'SUCCESS' } }, { approvalId: 'a2', resolution: 'DENY' }] });
    expect(store().live).toBeNull();
  });

  it('카드가 없던 질문의 실패 줄에는 approvals 필드가 없다', () => {
    store().addQuestion('q1', '재고');
    store().addFailure('q1', '재고', '응답이 없어요');
    expect(store().entries.at(-1)).not.toHaveProperty('approvals');
  });
});

describe('웹 검색 (이슈 #367)', () => {
  const WEB = [{ title: '철강 시황', url: 'https://example.com/steel' }];

  it('웹 도구 결과의 출처와 최종 답의 웹 출처를 대화에 남긴다. 웹 검색이 아니면 필드가 없다', () => {
    store().addQuestion('q1', '철강 시황', undefined, undefined, true);
    store().applyStreamEvent('q1', { type: 'tool_start', id: 't1', name: 'web_search', arguments: '{"query":"철강"}' }, 1000);
    store().applyStreamEvent('q1', { type: 'tool_end', id: 't1', label: null, resultPreview: '…', durationMs: 900, webSources: WEB }, 1900);
    const tool = store().live?.steps[0];
    expect(tool?.kind === 'tool' ? tool.result?.webSources : null).toEqual(WEB);
    store().applyStreamEvent('q1', { type: 'done', reply: { ...REPLY, webSources: WEB } }, 2000);
    expect(store().entries.at(-1)).toMatchObject({ role: 'assistant', webSources: WEB });

    store().addQuestion('q2', '재고');
    store().applyStreamEvent('q2', { type: 'done', reply: REPLY });
    expect(store().entries.at(-1)).not.toHaveProperty('webSources');
  });

  it('웹 검색을 켜고 물은 질문이 실패하면 다시 물을 때 쓰도록 실패 줄에 담는다', () => {
    store().addQuestion('q1', '철강 시황', undefined, undefined, true);
    store().addFailure('q1', '철강 시황', '응답이 없어요');
    expect(store().entries.at(-1)).toMatchObject({ role: 'failure', webSearch: true });
  });
});
