// AI 어시스턴트 대화 저장소: 지금 보는 대화를 이 탭 메모리에 두고, 저장한 대화(이슈 #399)를 열어 되살린다.
import type { AiActionCard, AiAssistantReplyView, AiChatThreadView } from '@fantasteel/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { AI_CHAT_HISTORY_LIMIT, AI_CHAT_STOPPED_REASON, aiChatEntriesFromThread, aiChatHistory, emptyAiChatLive, reduceAiChatLive, useAiChatStore, type AiChatEntry } from '@/stores/useAiChatStore';

const store = () => useAiChatStore.getState();
const SOURCE = { kind: 'GLOSSARY' as const, id: 'TRM-056', label: '예약' };

beforeEach(() => useAiChatStore.setState({ ownerEmployeeId: null, threadId: null, entries: [], pendingId: null, live: null }));

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
  actionCards: [],
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
    expect(store().entries.at(-1)).not.toHaveProperty('cards');
  });

  it('done 답에 담긴 실행 카드는 확인 대기 카드로 답에 붙는다', () => {
    const card = { key: 'a1', kind: 'TASK' as const, title: '견적서 보내기', description: null, assigneeId: 7, assigneeName: null, dueDate: '2026-10-20', startAt: null, endAt: null, endAssumed: false, attendeeIds: [], purchase: null, itemName: null, issues: [] };
    store().addQuestion('q1', '견적서 보내기 업무 등록해줘');
    store().applyStreamEvent('q1', { type: 'done', reply: { ...REPLY, actionCards: [card] } });
    const answer = store().entries.at(-1);
    expect(answer?.role === 'assistant' ? answer.cards : null).toEqual([{ card, status: 'ready' }]);
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

  it('error 이벤트의 LLM 실패 오류 코드(AST-)는 실패 줄에 담기고, 코드가 없으면 담지 않는다 (이슈 #462)', () => {
    store().addQuestion('q1', '재고 알려줘');
    store().applyStreamEvent('q1', { type: 'error', message: 'AI 서버에 연결할 수 없어요', code: 'AST-003' });
    expect(store().entries.at(-1)).toMatchObject({ role: 'failure', content: 'AI 서버에 연결할 수 없어요', code: 'AST-003' });
    store().addQuestion('q2', '또 알려줘');
    store().applyStreamEvent('q2', { type: 'error', message: '답을 만드는 중에 문제가 생겼어요' });
    expect(store().entries.at(-1)).not.toHaveProperty('code');
    // HTTP 오류로 알게 된 실패(스트림 시작 전)도 코드를 담는다
    store().addQuestion('q3', '모델 없이 알려줘');
    store().addFailure('q3', '모델 없이 알려줘', 'AI 모델이 아직 정해지지 않았어요', 'AST-002');
    expect(store().entries.at(-1)).toMatchObject({ role: 'failure', code: 'AST-002' });
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

describe('브라우저 사용 (이슈 #373)', () => {
  const frame = (n: number) => ({ type: 'browser_frame' as const, url: `example.kr/${n}`, title: `제목 ${n}`, imageBase64: 'QUJD', at: '2026-10-17T00:00:00.000Z' });

  it('화면 사진을 모으고 최종 답 줄에 남긴다. 규칙에 어긋난 사진은 버리고, 사진이 없으면 필드가 없다', () => {
    store().addQuestion('q1', '페이지 열어 줘', undefined, undefined, undefined, true);
    expect(store().entries[0]).toMatchObject({ role: 'user', browser: true });
    for (let n = 1; n <= 12; n += 1) store().applyStreamEvent('q1', frame(n));
    store().applyStreamEvent('q1', { ...frame(99), imageBase64: '<img onerror=x>' });
    expect(store().live?.browserFrames).toHaveLength(10);
    expect(store().live?.browserFrames.at(-1)?.url).toBe('example.kr/12');
    store().applyStreamEvent('q1', { type: 'done', reply: REPLY });
    expect(store().entries.at(-1)).toMatchObject({ role: 'assistant', browserFrames: expect.arrayContaining([expect.objectContaining({ url: 'example.kr/12' })]) });

    store().addQuestion('q2', '재고');
    store().applyStreamEvent('q2', { type: 'done', reply: REPLY });
    expect(store().entries.at(-1)).not.toHaveProperty('browserFrames');
  });

  it('실패 줄에 브라우저 사용 여부를 남겨 다시 물을 때 쓴다', () => {
    store().addQuestion('q1', '질문', undefined, undefined, undefined, true);
    store().applyStreamEvent('q1', { type: 'error', message: '실패' } as never);
    expect(store().entries.at(-1)).toMatchObject({ role: 'failure', browser: true });
  });
});

describe('실시간 브라우저 화면·멈춤 (이슈 #425)', () => {
  const CONTROL_ID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  const liveEvent = { type: 'browser_live' as const, url: 'example.kr/a', imageBase64: 'QUJD', at: '2026-10-20T00:00:00.000Z' };

  describe('reduceAiChatLive', () => {
    it('emptyAiChatLive는 열쇠가 있을 때만 멈춤 상태를 만든다', () => {
      expect(emptyAiChatLive(null, CONTROL_ID)).toMatchObject({ liveFrame: null, control: { id: CONTROL_ID, requested: false, pausedBefore: null } });
      expect(emptyAiChatLive()).toMatchObject({ liveFrame: null, control: null });
      expect(emptyAiChatLive('high', null).control).toBeNull();
    });

    it('browser_live는 가장 최근 한 장만 liveFrame에 두고(제목은 비움), browserFrames에는 더하지 않는다', () => {
      const first = reduceAiChatLive(emptyAiChatLive(), liveEvent, 0);
      expect(first.liveFrame).toEqual({ url: 'example.kr/a', title: '', imageBase64: 'QUJD', at: '2026-10-20T00:00:00.000Z' });
      expect(first.browserFrames).toEqual([]);
      const second = reduceAiChatLive(first, { ...liveEvent, imageBase64: 'QUJDRA==', at: '2026-10-20T00:00:01.000Z' }, 0);
      expect(second.liveFrame?.imageBase64).toBe('QUJDRA==');
    });

    it('규칙에 어긋난 사진(base64 아님·길이 안 맞음·빈 값)은 버리고 이전 화면을 그대로 둔다', () => {
      const shown = reduceAiChatLive(emptyAiChatLive(), liveEvent, 0);
      for (const bad of ['<img onerror=x>', 'QUJ', '', 'data:image/jpeg;base64,QUJD']) {
        expect(reduceAiChatLive(shown, { ...liveEvent, imageBase64: bad }, 0)).toBe(shown);
      }
    });

    it('덧붙인 말은 전하는 중으로 더해지고, user_note가 오면 전했음으로 바뀌며, 답이 끝나면 질문 아래에 남는다 (이슈 #430)', () => {
      store().addQuestion('q1', '시세 알려줘', undefined, undefined, undefined, true, CONTROL_ID);
      store().addAgentNote('q1', '서울 기준으로');
      expect(store().live?.steps).toEqual([{ kind: 'userNote', text: '서울 기준으로', applied: false }]);
      store().applyStreamEvent('q1', { type: 'user_note', text: '서울 기준으로' });
      expect(store().live?.steps).toEqual([{ kind: 'userNote', text: '서울 기준으로', applied: true }]);
      store().addAgentNote('q1', '아직 못 전한 말');
      store().applyStreamEvent('q1', { type: 'done', reply: REPLY });
      const user = store().entries[0];
      expect(user).toMatchObject({ role: 'user', notes: ['서울 기준으로'] });
    });

    it('열쇠가 없는 답(멈출 수 없는 답)에는 덧붙임을 더하지 않고, 저장한 대화를 열면 질문 아래에 덧붙임이 보인다', () => {
      store().addQuestion('q1', '예약이 뭐야?');
      store().addAgentNote('q1', '무시됨');
      expect(store().live?.steps).toEqual([]);
      const thread: AiChatThreadView = { id: 5, title: 't', createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z', messages: [{ id: 1, seq: 1, role: 'user', content: '질문', createdAt: '2026-10-20T00:00:00.000Z', notes: ['서울 기준으로'] }] };
      expect(aiChatEntriesFromThread(thread)[0]).toMatchObject({ role: 'user', notes: ['서울 기준으로'] });
    });

    it('agent_paused는 멈춘 도구를 적고 멈추기 요청을 끝내며, agent_resumed는 멈춘 도구를 지운다', () => {
      const asked = { ...emptyAiChatLive(null, CONTROL_ID), control: { id: CONTROL_ID, requested: true, pausedBefore: null } };
      const paused = reduceAiChatLive(asked, { type: 'agent_paused', tool: 'browser_click' }, 0);
      expect(paused.control).toEqual({ id: CONTROL_ID, requested: false, pausedBefore: 'browser_click' });
      const resumed = reduceAiChatLive(paused, { type: 'agent_resumed' }, 0);
      expect(resumed.control).toEqual({ id: CONTROL_ID, requested: false, pausedBefore: null });
    });

    it('agent_resumed는 아직 누른 멈추기 요청(requested)을 건드리지 않는다', () => {
      const live = { ...emptyAiChatLive(null, CONTROL_ID), control: { id: CONTROL_ID, requested: true, pausedBefore: 'ui_click' } };
      expect(reduceAiChatLive(live, { type: 'agent_resumed' }, 0).control).toEqual({ id: CONTROL_ID, requested: true, pausedBefore: null });
    });

    it('멈출 수 없는 답(control이 null)에서는 agent_paused·agent_resumed를 무시한다', () => {
      const live = emptyAiChatLive();
      expect(reduceAiChatLive(live, { type: 'agent_paused', tool: 'browser_open' }, 0)).toBe(live);
      expect(reduceAiChatLive(live, { type: 'agent_resumed' }, 0)).toBe(live);
    });
  });

  describe('저장소', () => {
    it('addQuestion에 열쇠를 주면 live.control이 생기고, 안 주면 null이다', () => {
      store().addQuestion('q1', '봐줘', undefined, undefined, undefined, true, CONTROL_ID);
      expect(store().live?.control).toEqual({ id: CONTROL_ID, requested: false, pausedBefore: null });
      store().addAnswer('q1', '답', []);
      store().addQuestion('q2', '재고');
      expect(store().live?.control).toBeNull();
    });

    it('setControlRequested는 답하는 중인 그 질문의 control에만 적용한다', () => {
      store().addQuestion('q1', '봐줘', undefined, undefined, undefined, true, CONTROL_ID);
      store().setControlRequested('q1', true);
      expect(store().live?.control?.requested).toBe(true);
      store().setControlRequested('q1', false);
      expect(store().live?.control?.requested).toBe(false);

      // 다른 질문 id, 멈출 수 없는 답, 답을 마친 뒤에는 바꾸지 않는다
      const before = store().live;
      store().setControlRequested('other', true);
      expect(store().live).toBe(before);
      store().addAnswer('q1', '답', []);
      store().setControlRequested('q1', true);
      expect(store().live).toBeNull();
      store().addQuestion('q2', '재고');
      const plain = store().live;
      store().setControlRequested('q2', true);
      expect(store().live).toBe(plain);
    });

    it('스트림 이벤트가 저장소 live에 반영되고, 답이 끝나면 liveFrame·control은 대화에 남지 않는다', () => {
      store().addQuestion('q1', '봐줘', undefined, undefined, undefined, true, CONTROL_ID);
      store().applyStreamEvent('q1', liveEvent);
      store().applyStreamEvent('q1', { type: 'agent_paused', tool: 'browser_open' });
      expect(store().live).toMatchObject({ liveFrame: { url: 'example.kr/a' }, control: { pausedBefore: 'browser_open' } });
      store().applyStreamEvent('q1', { type: 'agent_resumed' });
      store().applyStreamEvent('q1', { type: 'done', reply: REPLY });
      expect(store().live).toBeNull();
      const answer = store().entries.at(-1);
      expect(answer).not.toHaveProperty('liveFrame');
      expect(answer).not.toHaveProperty('control');
      expect(answer).not.toHaveProperty('browserFrames');
    });
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

describe('저장한 대화 (이슈 #399)', () => {
  const THREAD: AiChatThreadView = {
    id: 5,
    title: '예약이 뭐야?',
    createdAt: '2026-10-19T01:00:00.000Z',
    updatedAt: '2026-10-19T01:01:00.000Z',
    messages: [
      { id: 11, seq: 1, role: 'user', content: '예약이 뭐야?', createdAt: '2026-10-19T01:00:00.000Z', imageCount: 2, webSearch: true },
      {
        id: 12,
        seq: 2,
        role: 'assistant',
        content: '매수를 확보하는 거예요',
        createdAt: '2026-10-19T01:00:05.000Z',
        sources: [{ kind: 'GLOSSARY', id: 'TRM-056', label: '예약' }],
        actionCards: [{ card: { key: 'a1', kind: 'TASK', title: '견적서' } as unknown as AiActionCard, status: 'done', result: { type: 'task', id: 3 } }],
        reasoning: 'high',
        reasoningApplied: false,
      },
    ],
  };

  it('저장한 메시지를 대화 줄로 되살린다: 사진은 수만, 답은 저장 id·카드 상태와 함께', () => {
    expect(aiChatEntriesFromThread(THREAD)).toEqual([
      { id: 'saved-11', role: 'user', content: '예약이 뭐야?', imageCount: 2, webSearch: true },
      {
        id: 'saved-12',
        role: 'assistant',
        content: '매수를 확보하는 거예요',
        sources: [{ kind: 'GLOSSARY', id: 'TRM-056', label: '예약' }],
        messageId: 12,
        requestedReasoning: 'high',
        reasoningApplied: false,
        cards: [{ card: { key: 'a1', kind: 'TASK', title: '견적서' }, status: 'done', result: { type: 'task', id: 3 } }],
      },
    ]);
  });

  it('저장한 생각 글·도구 동작 기록으로 생각 과정을 되살린다 (이슈 #433)', () => {
    const entries = aiChatEntriesFromThread({
      ...THREAD,
      messages: [
        THREAD.messages[0],
        {
          ...(THREAD.messages[1] as Extract<AiChatThreadView['messages'][number], { role: 'assistant' }>),
          thinking: '재고를 먼저 본다',
          trace: [
            { name: 'get_inventory', arguments: '{"item":"SS275"}', durationMs: 40, label: '재고 · SS275' },
            { name: 'browser_open', arguments: '{"url":"https://a.example.kr/x"}', durationMs: 900, url: 'a.example.kr/x' },
            { name: 'browser_click', arguments: '{"ref":"r9"}', durationMs: 5, error: '막았어요' },
          ],
        },
      ],
    });
    const answer = entries[1];
    expect(answer.role === 'assistant' && answer.steps).toEqual([
      { kind: 'thinking', text: '재고를 먼저 본다', startedAt: 0, endedAt: 0 },
      { kind: 'tool', id: 'saved-12-0', name: 'get_inventory', arguments: '{"item":"SS275"}', result: { label: '재고 · SS275', resultPreview: '', durationMs: 40 } },
      { kind: 'tool', id: 'saved-12-1', name: 'browser_open', arguments: '{"url":"https://a.example.kr/x"}', result: { label: 'a.example.kr/x', resultPreview: '', durationMs: 900 } },
      { kind: 'tool', id: 'saved-12-2', name: 'browser_click', arguments: '{"ref":"r9"}', result: { label: null, resultPreview: '{"오류":"막았어요"}', durationMs: 5 } },
    ]);
  });

  it('대화를 열면 그 대화로 바꾸고, 답을 기다리는 중이면 열지 않는다', () => {
    store().openThread(THREAD);
    expect(store().threadId).toBe(5);
    expect(store().entries).toHaveLength(2);
    store().addQuestion('q1', '다음 질문');
    store().openThread({ ...THREAD, id: 6, messages: [] });
    expect(store().threadId).toBe(5);
  });

  it('새 대화는 대화 id도 비우고, 다른 사원으로 들어와도 비운다', () => {
    store().claim(1);
    store().openThread(THREAD);
    store().clear();
    expect(store().threadId).toBeNull();
    store().openThread(THREAD);
    store().claim(2);
    expect(store()).toMatchObject({ threadId: null, entries: [] });
  });

  it('지운 대화가 지금 대화면 비우고, 답을 기다리는 중이면 대화 id만 잊는다', () => {
    store().openThread(THREAD);
    store().forgetThread(99);
    expect(store().threadId).toBe(5);
    store().forgetThread(5);
    expect(store()).toMatchObject({ threadId: null, entries: [] });
    store().openThread(THREAD);
    store().addQuestion('q1', '다음 질문');
    store().forgetThread(5);
    expect(store().threadId).toBeNull();
    expect(store().pendingId).toBe('q1');
    expect(store().entries).toHaveLength(3);
  });
});
