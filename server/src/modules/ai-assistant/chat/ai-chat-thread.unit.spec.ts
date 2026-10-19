import { AI_CHAT_TITLE_MAX, type AiActionCard } from '@fantasteel/shared';
import { AI_CHAT_ROLE, answerMeta, cardsWithDone, chatHistoryTurns, chatThreadTitle, questionMeta, readyCards, toChatMessageView } from './ai-chat-thread.view';

const card = (key: string) => ({ key, kind: 'TASK', title: `업무 ${key}` }) as unknown as AiActionCard;
const row = (patch: Partial<Parameters<typeof toChatMessageView>[0]>) => ({
  id: 1,
  seq: 1,
  role: AI_CHAT_ROLE.USER,
  content: '질문',
  sources: [],
  webSources: null,
  actionCards: null,
  meta: null,
  createdAt: new Date('2026-10-19T01:02:03.000Z'),
  ...patch,
});

describe('대화 제목 (이슈 #399)', () => {
  it('첫 질문의 줄바꿈·연속 공백을 공백 하나로 바꾸고 앞뒤 공백을 지운다', () => {
    expect(chatThreadTitle('  SS275\n\n재고   알려 줘 ')).toBe('SS275 재고 알려 줘');
  });

  it(`${AI_CHAT_TITLE_MAX}자를 넘으면 자르고 …을 붙인다 (이모지를 반으로 자르지 않는다)`, () => {
    const long = '가'.repeat(AI_CHAT_TITLE_MAX - 1) + '😀나다';
    const title = chatThreadTitle(long);
    expect(Array.from(title)).toHaveLength(AI_CHAT_TITLE_MAX + 1);
    expect(title.endsWith('😀…')).toBe(true);
    expect(chatThreadTitle('가'.repeat(AI_CHAT_TITLE_MAX))).toBe('가'.repeat(AI_CHAT_TITLE_MAX));
  });
});

describe('저장한 메시지 모양', () => {
  it('질문 옵션은 켠 것만, 없으면 null', () => {
    expect(questionMeta({ question: 'q' })).toBeNull();
    expect(questionMeta({ question: 'q', reasoning: 'low', webSearch: true, browser: false, imageCount: 0 })).toEqual({ reasoning: 'low', webSearch: true });
    expect(answerMeta(undefined, { reasoningApplied: true })).toBeNull();
    expect(answerMeta('high', { reasoningApplied: false })).toEqual({ reasoning: 'high', reasoningApplied: false });
  });

  it('질문 줄은 옵션을, 답 줄은 출처·웹 출처·카드·생각 정도를 돌려준다', () => {
    expect(toChatMessageView(row({ meta: { reasoning: 'high', webSearch: true, imageCount: 2, junk: 1 } }))).toEqual({
      id: 1,
      seq: 1,
      role: 'user',
      content: '질문',
      createdAt: '2026-10-19T01:02:03.000Z',
      reasoning: 'high',
      webSearch: true,
      imageCount: 2,
    });
    const answer = toChatMessageView(
      row({
        id: 2,
        seq: 2,
        role: AI_CHAT_ROLE.ASSISTANT,
        content: '답',
        sources: [{ kind: 'GLOSSARY', id: 'TRM-056', label: '예약' }],
        webSources: [{ title: '뉴스', url: 'https://example.com/a' }],
        actionCards: readyCards([card('a1')]),
        meta: { reasoning: 'off', reasoningApplied: true },
      }),
    );
    expect(answer).toMatchObject({ role: 'assistant', sources: [{ id: 'TRM-056' }], webSources: [{ url: 'https://example.com/a' }], actionCards: [{ status: 'ready', card: { key: 'a1' } }], reasoning: 'off', reasoningApplied: true });
  });

  it('카드·출처가 비었거나 모르는 생각 정도면 빈 값으로 본다', () => {
    const answer = toChatMessageView(row({ role: AI_CHAT_ROLE.ASSISTANT, sources: null, actionCards: { not: 'array' }, meta: { reasoning: 'max' } }));
    expect(answer).toEqual({ id: 1, seq: 1, role: 'assistant', content: '질문', createdAt: '2026-10-19T01:02:03.000Z', sources: [], actionCards: [] });
  });

  it('지난 대화는 역할을 소문자로 바꿔 순서대로 넘긴다', () => {
    expect(chatHistoryTurns([{ role: 'USER', content: 'q' }, { role: 'ASSISTANT', content: 'a' }])).toEqual([{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }]);
  });

  it('@로 붙인 Drive 파일은 이름만 남기고, 지난 대화에는 글 없이 이름 한 줄만 붙인다 (이슈 #398)', () => {
    const meta = questionMeta({ question: 'q', driveFiles: ['점검 메모.txt', '보고서.pdf'] });
    expect(meta).toEqual({ driveFiles: ['점검 메모.txt', '보고서.pdf'] });
    expect(toChatMessageView(row({ role: AI_CHAT_ROLE.USER, meta }))).toMatchObject({ role: 'user', driveFiles: ['점검 메모.txt', '보고서.pdf'] });
    expect(chatHistoryTurns([{ role: 'USER', content: '요약해줘', meta }, { role: 'ASSISTANT', content: 'a', meta: null }])).toEqual([
      { role: 'user', content: '요약해줘\n(이 질문에 붙인 Drive 파일: 점검 메모.txt, 보고서.pdf)' },
      { role: 'assistant', content: 'a' },
    ]);
  });

  it('새 카드 종류(Notion·고치기)도 저장·실행 표시가 된다 (이슈 #398)', () => {
    const notion = { key: 'a1', kind: 'NOTION_PAGE_APPEND' as const, title: 'Notion 글 더하기 · 회의', nonce: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', page: { id: 'p', title: '회의', url: 'https://www.notion.so/p' }, content: '추가', issues: [] };
    const next = cardsWithDone(readyCards([notion]), 'a1', { type: 'notion_page', id: 0, url: 'https://www.notion.so/p' });
    expect(next).toEqual([{ card: notion, status: 'done', result: { type: 'notion_page', id: 0, url: 'https://www.notion.so/p' } }]);
  });
});

describe('저장한 카드 실행 표시', () => {
  const registered = { type: 'task' as const, id: 31 };

  it('그 카드만 done과 만든 것으로 바꾼다', () => {
    const next = cardsWithDone(readyCards([card('a1'), card('a2')]), 'a2', registered);
    expect(next?.map((item) => [item.card.key, item.status, item.result?.id])).toEqual([
      ['a1', 'ready', undefined],
      ['a2', 'done', 31],
    ]);
  });

  it('없는 카드나 이미 실행한 카드면 null (고치지 않는다)', () => {
    expect(cardsWithDone(readyCards([card('a1')]), 'a9', registered)).toBeNull();
    expect(cardsWithDone([{ card: card('a1'), status: 'done', result: { type: 'task', id: 1 } }], 'a1', registered)).toBeNull();
    expect(cardsWithDone(null, 'a1', registered)).toBeNull();
  });
});
