import { AI_CHAT_TITLE_MAX, type AiActionCard } from '@fantasteel/shared';
import { AI_CHAT_ROLE, answerMeta, cardsWithDone, chatHistoryTurns, chatThreadTitle, questionMeta, readyCards, toChatMessageView, TRACE_STEPS_MAX, traceStepsOf } from './ai-chat-thread.view';

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
    expect(answerMeta(undefined, { reasoningApplied: true, thinking: null, toolCalls: [] })).toBeNull();
    expect(answerMeta('high', { reasoningApplied: false, thinking: null, toolCalls: [] })).toEqual({ reasoning: 'high', reasoningApplied: false });
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

  it('답하는 중에 덧붙인 말은 질문 줄의 meta에 남고, 다시 열면 질문 아래에 보이며, 지난 대화에는 한 줄로 붙는다 (이슈 #430)', () => {
    const meta = questionMeta({ question: 'q', notes: ['서울 기준으로', '2주 안 자료만'] });
    expect(meta).toEqual({ notes: ['서울 기준으로', '2주 안 자료만'] });
    expect(questionMeta({ question: 'q', notes: [] })).toBeNull();
    expect(toChatMessageView(row({ role: AI_CHAT_ROLE.USER, meta }))).toMatchObject({ role: 'user', notes: ['서울 기준으로', '2주 안 자료만'] });
    expect(chatHistoryTurns([{ role: 'USER', content: '시세 알려줘', meta }])).toEqual([{ role: 'user', content: '시세 알려줘\n(답하는 중에 덧붙인 말: 서울 기준으로 / 2주 안 자료만)' }]);
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

describe('생각 과정과 도구 동작 기록 저장 (이슈 #433)', () => {
  const call = (patch: Partial<Parameters<typeof traceStepsOf>[0][number]>) => ({ name: 'get_inventory', arguments: '{"item":"SS275"}', resultPreview: '[{"재고":120}]', durationMs: 40, ...patch });

  it('결과 글은 빼고 입력·걸린 시간·조회 대상·본 주소·실패 이유만 줄여서 남긴다', () => {
    const steps = traceStepsOf([
      call({ label: '재고 · SS275' }),
      call({ name: 'browser_open', arguments: '{"url":"https://a.example.kr/x"}', resultPreview: '[브라우저 화면] a.example.kr\n긴 페이지 글', url: 'a.example.kr/x' }),
      call({ name: 'browser_click', arguments: '{"ref":"r9"}', resultPreview: '{"오류":"막았어요: 로그인 버튼은 사용자가 직접 눌러요","안내":"..."}' }),
      call({ arguments: 'a'.repeat(500) }),
    ]);
    expect(steps[0]).toEqual({ name: 'get_inventory', arguments: '{"item":"SS275"}', durationMs: 40, label: '재고 · SS275' });
    expect(steps[1]).toEqual({ name: 'browser_open', arguments: '{"url":"https://a.example.kr/x"}', durationMs: 40, url: 'a.example.kr/x' });
    expect(steps[2]).toMatchObject({ name: 'browser_click', error: '막았어요: 로그인 버튼은 사용자가 직접 눌러요' });
    expect(JSON.stringify(steps)).not.toContain('긴 페이지 글');
    expect(JSON.stringify(steps)).not.toContain('120');
    expect(steps[3].arguments).toHaveLength(201);
  });

  it('동작 기록은 최대 TRACE_STEPS_MAX개까지만 남긴다', () => {
    expect(traceStepsOf(Array.from({ length: TRACE_STEPS_MAX + 10 }, () => call({})))).toHaveLength(TRACE_STEPS_MAX);
  });

  it('답 meta에는 생각 글과 동작 기록이 생각 정도 없이도 들어가고, 아무것도 없으면 null', () => {
    const meta = answerMeta(undefined, { reasoningApplied: true, thinking: '재고를 먼저 본다', toolCalls: [call({})] });
    expect(meta).toEqual({ thinking: '재고를 먼저 본다', trace: [{ name: 'get_inventory', arguments: '{"item":"SS275"}', durationMs: 40 }] });
    expect(answerMeta(undefined, { reasoningApplied: true, thinking: null, toolCalls: [] })).toBeNull();
  });

  it('저장한 meta의 생각 글·동작 기록을 답 줄로 되살리고, 깨진 줄은 건너뛴다', () => {
    const view = toChatMessageView(
      row({
        role: AI_CHAT_ROLE.ASSISTANT,
        meta: {
          thinking: '재고를 먼저 본다',
          trace: [{ name: 'browser_open', arguments: '{}', durationMs: 5, url: 'a.example.kr/x' }, { name: 3 }, 'x', { name: 'get_inventory', arguments: '{}', durationMs: 'oops' }],
        },
      }),
    );
    expect(view).toMatchObject({ role: 'assistant', thinking: '재고를 먼저 본다', trace: [{ name: 'browser_open', arguments: '{}', durationMs: 5, url: 'a.example.kr/x' }] });
    // 예전에 저장한 답(meta에 없음)은 그대로
    const old = toChatMessageView(row({ role: AI_CHAT_ROLE.ASSISTANT, meta: { reasoning: 'low', reasoningApplied: true } }));
    expect(old).not.toHaveProperty('thinking');
    expect(old).not.toHaveProperty('trace');
  });
});
