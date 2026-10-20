// 철강맨AI 상황별 모습 (이슈 #414): 같은 열쇠면 같은 시안, 진행 단계별 모습, 끝난 답의 모습
import { describe, expect, it } from 'vitest';
import type { AiChatEntry, AiChatLive, AiTimelineStep } from '@/stores/useAiChatStore';
import { finishedSteelmanStatus, liveSteelmanStatus, SLOW_TOOL_MS, steelmanSpriteSrc, TOOL_RESULT_FLASH_MS } from '@/lib/steelmanStatus';

const live = (steps: AiTimelineStep[], answer = ''): AiChatLive => ({ steps, answer, reasoning: null, browserFrames: [] });
const tool = (name: string, resultPreview: string | null = null): AiTimelineStep => ({
  kind: 'tool',
  id: `t-${name}`,
  name,
  arguments: '{}',
  result: resultPreview === null ? null : { label: null, resultPreview, durationMs: 10 },
});

describe('시안 고르기', () => {
  it('같은 열쇠면 늘 같은 시안, 주소는 상황 파일 이름과 A/B/C', () => {
    const src = steelmanSpriteSrc('searching', 'q1:2');
    expect(src).toMatch(/^\/steelman-ai\/02_searching_[ABC]\.gif$/);
    expect(steelmanSpriteSrc('searching', 'q1:2')).toBe(src);
  });

  it('열쇠가 달라지면 시안이 고루 나온다 (답 쓰는 중은 A·B만)', () => {
    const seen = new Set(Array.from({ length: 60 }, (_, i) => steelmanSpriteSrc('thinking', `k${i}`)));
    expect(seen.size).toBe(3);
    const writing = new Set(Array.from({ length: 60 }, (_, i) => steelmanSpriteSrc('writing', `k${i}`)));
    expect([...writing].every((s) => /07_writing_[AB]\.gif$/.test(s))).toBe(true);
  });
});

describe('답을 기다리는 동안', () => {
  const now = 100_000;

  it('아무것도 안 왔거나 생각 중이면 생각 중', () => {
    expect(liveSteelmanStatus(live([]), now)).toBe('thinking');
    expect(liveSteelmanStatus(live([{ kind: 'thinking', text: '음', startedAt: 0, endedAt: null }]), now)).toBe('thinking');
  });

  it('ERP 조회·웹 검색은 조회 중, 지식·지난 대화·본문 읽기는 문서 찾는 중', () => {
    expect(liveSteelmanStatus(live([tool('get_inventory')]), now)).toBe('searching');
    expect(liveSteelmanStatus(live([tool('web_search')]), now)).toBe('searching');
    expect(liveSteelmanStatus(live([tool('read_knowledge')]), now)).toBe('reading');
    expect(liveSteelmanStatus(live([tool('search_chat_history')]), now)).toBe('reading');
  });

  it(`도구가 ${SLOW_TOOL_MS / 1000}초 넘게 돌면 시간 초과`, () => {
    expect(liveSteelmanStatus(live([tool('get_inventory')]), now, () => ({ startedAt: now - SLOW_TOOL_MS }))).toBe('slow');
    expect(liveSteelmanStatus(live([tool('get_inventory')]), now, () => ({ startedAt: now - 1000 }))).toBe('searching');
  });

  it('도구가 막 끝나면 찾았다·결과 0건, 권한 밖이면 권한 밖, 잠시 뒤에는 다시 생각 중', () => {
    expect(liveSteelmanStatus(live([tool('get_inventory', '{"제품":[{"규격":"SS275"}]}')]), now, () => ({ endedAt: now }))).toBe('found');
    expect(liveSteelmanStatus(live([tool('get_inventory', '{"결과":[]}')]), now, () => ({ endedAt: now }))).toBe('no_result');
    expect(liveSteelmanStatus(live([tool('get_sales_orders', '이 조회는 권한이 없어요. 조회할 수 있는 역할: 영업')]), now, () => ({ endedAt: now }))).toBe('no_permission');
    expect(liveSteelmanStatus(live([tool('get_inventory', '{"제품":[1]}')]), now, () => ({ endedAt: now - TOOL_RESULT_FLASH_MS }))).toBe('thinking');
  });

  it('답 글이 나오면 답 쓰는 중 (도구가 도는 중이면 도구 모습)', () => {
    expect(liveSteelmanStatus(live([], '재고는'), now)).toBe('writing');
    expect(liveSteelmanStatus(live([tool('get_inventory', '{"제품":[1]}')], '재고는'), now, () => ({ endedAt: now }))).toBe('writing');
    expect(liveSteelmanStatus(live([tool('get_inventory')], '찾아볼게요'), now)).toBe('searching');
  });
});

describe('답이 끝난 직후', () => {
  const answer = (content: string, cards = false): AiChatEntry => ({
    id: 'a1',
    role: 'assistant',
    content,
    sources: [],
    ...(cards ? { cards: [{ card: { key: 'a1', kind: 'RESEARCH', title: '심층 조사 만들기', question: '열연 가격', issues: [] }, status: 'ready' }] } : {}),
  });

  it('실패는 오류, 카드가 있으면 초안 확인 부탁, 근거가 없다고 하면 확인할 수 없음, 아니면 답 완료', () => {
    expect(finishedSteelmanStatus({ id: 'f1', role: 'failure', content: '연결 실패', question: '재고' })).toBe('error');
    expect(finishedSteelmanStatus(answer('카드를 만들었어요', true))).toBe('draft_review');
    expect(finishedSteelmanStatus(answer('자료에서 확인할 수 없어요'))).toBe('unknown');
    expect(finishedSteelmanStatus(answer('재고는 8매예요'))).toBe('done');
    expect(finishedSteelmanStatus({ id: 'u1', role: 'user', content: '재고' })).toBeNull();
  });
});
