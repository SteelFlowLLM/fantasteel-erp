// 지난 대화 예산·찾기 (이슈 #412): 문맥 길이로 정하는 지난 대화 양, 낱말 뽑기, 찾기 도구. DB 없이 확인한다.
import type { AiAssistantTurn } from '@fantasteel/shared';
import { CHAT_HISTORY_SEARCH_TOOL, DEFAULT_HISTORY_BUDGET, fitHistory, HISTORY_SEARCH_LIMIT, historyBudget, HistorySearchSession, ROOM_MESSAGE_SEARCH_TOOL, searchWords, snippetAround, type HistoryHit, type HistorySearchSource } from './chat-memory';

const turn = (i: number, content = `말 ${i}`): AiAssistantTurn => ({ role: i % 2 ? 'assistant' : 'user', content });

describe('지난 대화 예산 (historyBudget)', () => {
  it('문맥 길이를 모르면 예전 값(10턴·2,000자·20,000자)', () => {
    expect(historyBudget(null)).toEqual({ maxTurns: 10, maxTurnChars: 2000, totalChars: 20_000 });
    expect(historyBudget(0)).toEqual(DEFAULT_HISTORY_BUDGET);
  });

  it('문맥이 크면 50턴·한 턴 4,000자, 전체는 60,000자에서 멈춘다', () => {
    expect(historyBudget(262_144)).toEqual({ maxTurns: 50, maxTurnChars: 4000, totalChars: 60_000 });
  });

  it('문맥의 25%를 1토큰 2자로 어림해 전체 글자 수를 정한다 (작은 문맥은 한 턴 2,000자)', () => {
    expect(historyBudget(8192)).toEqual({ maxTurns: 50, maxTurnChars: 2000, totalChars: 4096 });
    expect(historyBudget(16_384).totalChars).toBe(8192);
  });

  it('아주 작은 문맥이어도 전체는 4,000자 아래로 내려가지 않는다', () => {
    expect(historyBudget(1000).totalChars).toBe(4000);
  });
});

describe('지난 대화 담기 (fitHistory)', () => {
  const budget = { maxTurns: 50, maxTurnChars: 100, totalChars: 1000 };

  it('새것부터 담고 오래된 순으로 돌려준다', () => {
    const history = [turn(0), turn(1), turn(2)];
    expect(fitHistory(history, budget).map((t) => t.content)).toEqual(['말 0', '말 1', '말 2']);
  });

  it('빈 턴은 건너뛴다', () => {
    expect(fitHistory([turn(0), turn(1, '   '), turn(2, ''), turn(3)], budget).map((t) => t.content)).toEqual(['말 0', '말 3']);
  });

  it('한 턴은 maxTurnChars까지만 자른다', () => {
    const [only] = fitHistory([turn(0, 'ㄱ'.repeat(250))], budget);
    expect(only.content).toHaveLength(100);
  });

  it('전체 글자 수 몫을 넘기는 턴부터 앞(더 오래된 것)은 넣지 않는다', () => {
    const tight = { maxTurns: 50, maxTurnChars: 100, totalChars: 250 };
    const history = [turn(0, 'a'.repeat(100)), turn(1, 'b'.repeat(100)), turn(2, 'c'.repeat(100)), turn(3, 'd'.repeat(100))];
    expect(fitHistory(history, tight).map((t) => t.content[0])).toEqual(['c', 'd']);
  });

  it('maxTurns개까지만 담는다', () => {
    const history = Array.from({ length: 30 }, (_, i) => turn(i));
    const picked = fitHistory(history, { maxTurns: 5, maxTurnChars: 100, totalChars: 10_000 });
    expect(picked.map((t) => t.content)).toEqual(['말 25', '말 26', '말 27', '말 28', '말 29']);
  });

  it('예산을 안 주면 예전 값(10턴)을 쓴다', () => {
    const history = Array.from({ length: 14 }, (_, i) => turn(i));
    expect(fitHistory(history)).toHaveLength(10);
  });
});

describe('찾을 낱말 뽑기 (searchWords)', () => {
  it('끝의 조사를 뗀다', () => {
    expect(searchWords('납기를 알려줘')).toEqual(['납기', '알려줘']);
    expect(searchWords('SS275는 어땠지')).toEqual(['SS275', '어땠지']);
  });

  it('2자 미만 낱말은 버린다 (조사 뗀 뒤 포함)', () => {
    expect(searchWords('그 건 뭐')).toEqual([]);
    expect(searchWords('a b 가')).toEqual([]);
    expect(searchWords('납기가')).toEqual(['납기']);
  });

  it('같은 낱말은 한 번만, 3개까지', () => {
    expect(searchWords('납기 납기 SS275 출하 일정 재고')).toEqual(['납기', 'SS275', '출하']);
  });

  it("철강 낱말 끝의 '로'(고로·전기로)는 떼지 않는다", () => {
    expect(searchWords('전기로 탄소 배출')).toEqual(['전기로', '탄소', '배출']);
    expect(searchWords('고로에서')).toEqual(['고로']);
  });

  it('쉼표·물음표·괄호로도 나눈다', () => {
    expect(searchWords('납기,출하?재고(검수)')).toEqual(['납기', '출하', '재고']);
  });

  it('질문은 60자까지만 본다', () => {
    const query = `${'철'.repeat(60)} 뒤쪽낱말`;
    expect(searchWords(query)).toEqual(['철'.repeat(60)]);
  });

  it('낱말이 없으면 빈 목록', () => {
    expect(searchWords('   ')).toEqual([]);
  });
});

describe('찾은 글 자르기 (snippetAround)', () => {
  it('짧은 글은 줄바꿈만 공백으로 정리해 그대로', () => {
    expect(snippetAround('SS275\n납기는   11월', ['납기'])).toBe('SS275 납기는 11월');
  });

  it('긴 글은 처음 맞은 낱말 둘레를 …와 함께 자른다', () => {
    const text = `${'앞'.repeat(500)} 납기 ${'뒤'.repeat(500)}`;
    const cut = snippetAround(text, ['납기', '없는낱말'], 100);
    expect(cut).toContain('납기');
    expect(cut.startsWith('…')).toBe(true);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(102);
  });

  it('맞은 낱말이 앞쪽이면 앞에는 …를 붙이지 않는다', () => {
    const cut = snippetAround(`납기 ${'뒤'.repeat(500)}`, ['납기'], 100);
    expect(cut.startsWith('납기')).toBe(true);
    expect(cut.endsWith('…')).toBe(true);
  });

  it('맞은 낱말이 없으면 앞에서부터 자른다', () => {
    const cut = snippetAround('가'.repeat(500), ['납기'], 100);
    expect(cut).toBe(`${'가'.repeat(100)}…`);
  });

  it('맞은 낱말이 끝쪽이면 끝에서 max자를 보인다', () => {
    const cut = snippetAround(`${'앞'.repeat(500)} 납기`, ['납기'], 100);
    expect(cut.startsWith('…')).toBe(true);
    expect(cut.endsWith('납기')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(102);
  });
});

describe('지난 대화 찾기 도구 (HistorySearchSession)', () => {
  const sourceOf = (kind: HistorySearchSource['kind'], hits: HistoryHit[] = []) => {
    const searched: { words: readonly string[]; limit: number }[] = [];
    const source: HistorySearchSource = {
      kind,
      search: async (words, limit) => {
        searched.push({ words, limit });
        return hits;
      },
    };
    return { source, searched };
  };
  const call = (args: string) => ({ id: 'c1', name: 'search_chat_history', arguments: args });
  const parse = async (session: HistorySearchSession, args: string) => JSON.parse(await session.run(call(args))) as Record<string, unknown>;

  it('도구 이름은 찾는 곳에 따라 다르다', () => {
    expect(new HistorySearchSession(sourceOf('chat').source).definition.name).toBe(CHAT_HISTORY_SEARCH_TOOL);
    expect(new HistorySearchSession(sourceOf('room').source).definition.name).toBe(ROOM_MESSAGE_SEARCH_TOOL);
    expect(CHAT_HISTORY_SEARCH_TOOL).toBe('search_chat_history');
    expect(ROOM_MESSAGE_SEARCH_TOOL).toBe('search_room_messages');
  });

  it('has()는 자기 도구 이름에만 true', () => {
    const chat = new HistorySearchSession(sourceOf('chat').source);
    expect(chat.has('search_chat_history')).toBe(true);
    expect(chat.has('search_room_messages')).toBe(false);
    expect(chat.has('get_inventory')).toBe(false);
  });

  it('JSON이 깨졌으면 오류를 돌려주고 찾지 않는다', async () => {
    const { source, searched } = sourceOf('chat');
    const result = await parse(new HistorySearchSession(source), '{납기');
    expect(result).toHaveProperty('오류');
    expect(searched).toEqual([]);
  });

  it('낱말이 없으면(빈 query·2자 미만·query 아님) 오류', async () => {
    const { source, searched } = sourceOf('chat');
    const session = new HistorySearchSession(source);
    expect(await parse(session, '{"query":""}')).toHaveProperty('오류');
    expect(await parse(session, '{"query":"가 나"}')).toHaveProperty('오류');
    expect(await parse(session, '{"query":123}')).toHaveProperty('오류');
    expect(await parse(session, '')).toHaveProperty('오류');
    expect(searched).toEqual([]);
  });

  it('뽑은 낱말과 한도 8로 찾고, 시각(서울)·누가·글을 돌려준다. 어디는 있을 때만', async () => {
    const { source, searched } = sourceOf('chat', [
      { at: new Date('2026-10-19T15:30:00Z'), who: '나', where: 'SS275 납기 문의', text: 'SS275 납기가 언제예요?' },
      { at: new Date('2026-10-18T01:05:00Z'), who: '철강맨AI', where: null, text: '11월 20일이에요' },
    ]);
    const result = await parse(new HistorySearchSession(source), '{"query":"SS275 납기를"}');
    expect(searched).toEqual([{ words: ['SS275', '납기'], limit: HISTORY_SEARCH_LIMIT }]);
    expect(HISTORY_SEARCH_LIMIT).toBe(8);
    expect(result.찾은낱말).toEqual(['SS275', '납기']);
    expect(result.안내).toContain('날짜를 함께');
    expect(result.결과).toEqual([
      { 시각: '2026-10-20 00:30', 누가: '나', 어디: 'SS275 납기 문의', 글: 'SS275 납기가 언제예요?' },
      { 시각: '2026-10-18 10:05', 누가: '철강맨AI', 글: '11월 20일이에요' },
    ]);
    expect(Object.keys((result.결과 as object[])[1])).not.toContain('어디');
  });

  it('긴 글은 낱말 둘레만 자른다', async () => {
    const text = `${'앞'.repeat(600)} 납기는 11월 ${'뒤'.repeat(600)}`;
    const { source } = sourceOf('room', [{ at: new Date('2026-10-19T00:00:00Z'), who: '서민지', where: null, text }]);
    const result = await parse(new HistorySearchSession(source), '{"query":"납기"}');
    const [hit] = result.결과 as { 글: string }[];
    expect(hit.글).toContain('납기');
    expect(hit.글.length).toBeLessThan(310);
  });

  it('맞는 글이 없으면 없다고 안내하고 빈 결과', async () => {
    const { source } = sourceOf('room');
    const result = await parse(new HistorySearchSession(source), '{"query":"없는이야기"}');
    expect(result.결과).toEqual([]);
    expect(String(result.안내)).toContain('없어요');
  });
});
