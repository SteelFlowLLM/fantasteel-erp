// 철강맨AI 대화 → 심층 조사 (이슈 #408): 웹 검색 답만 이어 가고, Notion·Drive 출처는 빼고, 카드는 이 답이나 바로 앞 답의 웹 검색 결과만 넘긴다.
import { describe, expect, it } from 'vitest';
import type { AiChatEntry } from '@/stores/useAiChatStore';
import { researchCardSeedAt, webResearchStartAt } from '@/lib/aiResearchSeed';

const user = (content: string, webSearch?: boolean): AiChatEntry => ({ id: `u-${content}`, role: 'user', content, ...(webSearch ? { webSearch } : {}) });
const answer = (content: string, webSources?: { title: string; url: string }[]): AiChatEntry => ({ id: `a-${content}`, role: 'assistant', content, sources: [], ...(webSources ? { webSources } : {}) });
const web = [
  { title: '기사', url: 'https://news.example.kr/a' },
  { title: 'Notion 페이지', url: 'notion://page/x' },
];

describe('웹 검색 답에서 심층 조사로', () => {
  it('웹 검색을 켜고 물은 질문의 답이면 질문·간단 답·http(s) 출처를 넘긴다', () => {
    const entries = [user('열연 가격이 왜 올랐어?', true), answer('원료값 때문이에요 [1]', web)];
    expect(webResearchStartAt(entries, 1)).toEqual({
      question: '열연 가격이 왜 올랐어?',
      seed: { answer: '원료값 때문이에요 [1]', sources: [{ title: '기사', url: 'https://news.example.kr/a' }] },
    });
  });

  it('웹 검색을 끈 질문, 웹 출처가 없는 답, 너무 짧은 질문, 사용자 줄이면 null', () => {
    expect(webResearchStartAt([user('열연 가격', false), answer('답', web)], 1)).toBeNull();
    expect(webResearchStartAt([user('열연 가격', true), answer('답', [{ title: 'Drive', url: 'drive://file' }])], 1)).toBeNull();
    expect(webResearchStartAt([user('열연 가격', true), answer('답')], 1)).toBeNull();
    expect(webResearchStartAt([user('x', true), answer('답', web)], 1)).toBeNull();
    expect(webResearchStartAt([user('열연 가격', true)], 0)).toBeNull();
  });

  it('간단 답·출처 수를 상한까지 자른다', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ title: `출처 ${i}`, url: `https://example.com/${i}` }));
    const start = webResearchStartAt([user('긴 질문', true), answer('가'.repeat(5000), many)], 1);
    expect(start?.seed.answer).toHaveLength(4000);
    expect(start?.seed.sources).toHaveLength(10);
  });

  it('주소가 서버 상한(2000자)을 넘는 출처는 잘라 넘기지 않고 뺀다 (서버가 400으로 조사를 못 만들지 않게, 이슈 #476)', () => {
    const long = { title: '긴 주소', url: `https://example.com/${'a'.repeat(2000)}` };
    const exact = { title: '딱 상한', url: `https://example.com/${'b'.repeat(2000 - 'https://example.com/'.length)}` };
    const start = webResearchStartAt([user('긴 질문', true), answer('답', [long, exact, { title: '짧은 주소', url: 'https://example.com/ok' }])], 1);
    expect(start?.seed.sources.map((s) => s.title)).toEqual(['딱 상한', '짧은 주소']);
    // 쓸 출처가 모두 빠지면 심층 조사로 넘기지 않는다
    expect(webResearchStartAt([user('긴 질문', true), answer('답', [long])], 1)).toBeNull();
  });
});

describe('심층 조사 카드가 넘길 웹 검색 결과', () => {
  it('카드가 달린 답이 웹 검색 답이면 그것, 아니면 바로 앞 질문의 답, 더 앞은 넘기지 않는다', () => {
    const entries = [user('열연 가격 알려 줘', true), answer('올랐어요', web), user('이거 심층 조사해 줘'), answer('카드를 만들었어요')];
    expect(researchCardSeedAt(entries, 3)?.answer).toBe('올랐어요');
    expect(researchCardSeedAt([user('열연 가격 심층 조사해 줘', true), answer('찾아보고 카드도 만들었어요', web)], 1)?.answer).toBe('찾아보고 카드도 만들었어요');
    expect(researchCardSeedAt([...entries, user('다른 얘기'), answer('네'), user('심층 조사해 줘'), answer('카드')], 7)).toBeNull();
  });
});
