// 철강맨 부르기 (이슈 #457): 부르는 말 맞추기, 명령 해석, 말로 승인 카드 고르기·판정·시간 초과.
import type { AiHeatPlanCard, AiWorkCard } from '@fantasteel/shared';
import { describe, expect, it } from 'vitest';
import { confirmationOf, isLikelyHallucination, matchWakeWord, parseVoiceCommand, pickVoiceApprovalCard, resolveVoiceApproval, VOICE_APPROVAL_MS } from '@/lib/steelmanWake';
import type { AiChatEntry } from '@/stores/useAiChatStore';

const rest = (text: string) => {
  const match = matchWakeWord(text);
  return match.called ? match.rest : null;
};

describe('부르는 말 맞추기', () => {
  it.each([
    ['철강맨', ''],
    ['철강맨.', ''],
    ['철강맨아!', ''],
    ['철강맨님', ''],
    ['철강아~', ''],
    ['철강야', ''],
    ['철강맨, 재고 알려줘', '재고 알려줘'],
    ['철강맨 재고 알려줘.', '재고 알려줘.'],
    ['철강 맨, 재고 알려줘', '재고 알려줘'],
    ['철강만 재고 알려줘', '재고 알려줘'],
    ['철광맨 재고', '재고'],
    ['철강멘아 새 대화', '새 대화'],
    ['  "철강맨님... 멈춰"', '멈춰"'],
  ])('%s → 뒤의 말 %s', (text, expected) => {
    expect(rest(text)).toBe(expected);
  });

  it.each(['재고 알려줘', '철강맨이 뭐야', '철강아연 도금', '오늘 철강맨 불러 봤어', '철강 가격 알려줘', '감사합니다', ''])('%s → 부르지 않음 (버린다)', (text) => {
    expect(matchWakeWord(text)).toEqual({ called: false });
  });
});

describe('명령 해석', () => {
  it.each([
    ['', { kind: 'empty' }],
    ['.', { kind: 'empty' }],
    ['멈춰', { kind: 'stop' }],
    ['그만해 줘.', { kind: 'stop' }],
    ['잠깐', { kind: 'pause' }],
    ['잠깐만요', { kind: 'pause' }],
    ['계속', { kind: 'resume' }],
    ['계속해 줘', { kind: 'resume' }],
    ['새 대화', { kind: 'newChat' }],
    ['새 대화 시작해 줘', { kind: 'newChat' }],
    ['화면 조작 켜 줘', { kind: 'screenControl', on: true }],
    ['화면 조작 꺼', { kind: 'screenControl', on: false }],
    ['이거 실행해줘', { kind: 'approve', index: null }],
    ['그거 실행해 주세요', { kind: 'approve', index: null }],
    ['첫 번째 실행', { kind: 'approve', index: 1 }],
    ['두 번째 카드 실행해 줘', { kind: 'approve', index: 2 }],
    ['3번 실행', { kind: 'approve', index: 3 }],
  ])('%s', (text, expected) => {
    expect(parseVoiceCommand(text)).toEqual(expected);
  });

  it.each(['멈춰 있는 설비 알려줘', '아까 그 얘기 이어서', '실행', '계속 생산 중인 계획 보여줘', '재고 알려줘', '실행 카드가 뭐야'])('%s → 질문', (text) => {
    expect(parseVoiceCommand(text)).toEqual({ kind: 'ask', question: text });
  });
});

describe('whisper가 지어낸 말', () => {
  it.each(['감사합니다.', '시청해 주셔서 감사합니다!', '구독과 좋아요 부탁드립니다', 'MBC 뉴스 김철수입니다', '네.', '...'])('%s → 질문으로 받지 않는다', (text) => {
    expect(isLikelyHallucination(text)).toBe(true);
  });

  it.each(['재고 알려줘', '네 실행해', '감사합니다 그리고 재고도'])('%s → 받는다', (text) => {
    expect(isLikelyHallucination(text)).toBe(false);
  });
});

describe('말로 승인 판정', () => {
  it.each(['실행', '실행해', '실행해 줘', '응 실행', '네, 실행해 주세요.', '응 해', '철강맨 실행', '시행.'])('%s → 실행', (text) => {
    expect(confirmationOf(text)).toBe('yes');
  });

  it.each(['아니', '취소', '하지 마', '잠깐', '실행하지 마', '재고 알려줘', ''])('%s → 취소', (text) => {
    expect(confirmationOf(text)).toBe('no');
  });

  it('마감(10초)이 지나면 "실행"이라고 해도 실행하지 않는다', () => {
    const pending = { entryId: 'e', item: { card: workCard({}), status: 'ready' as const }, deadline: 1000 + VOICE_APPROVAL_MS };
    expect(resolveVoiceApproval(pending, '실행', 1000 + VOICE_APPROVAL_MS)).toBe('execute');
    expect(resolveVoiceApproval(pending, '실행', 1001 + VOICE_APPROVAL_MS)).toBe('expired');
    expect(resolveVoiceApproval(pending, '아니', 2000)).toBe('cancel');
  });
});

function workCard(over: Partial<AiWorkCard>): AiWorkCard {
  return { key: 'a1', kind: 'TASK', title: '견적서 보내기', description: null, assigneeId: 7, assigneeName: '박서영', dueDate: '2026-10-30', startAt: null, endAt: null, endAssumed: false, attendeeIds: [], purchase: null, itemName: null, issues: [], ...over };
}

const heatCard: AiHeatPlanCard = { key: 'h1', kind: 'HEAT_PLAN', title: '히트 편성', productionPlanId: 1, productionPlanNo: 'PP-1', currentHeatCount: 2, newHeatCount: 3, issues: [] } as unknown as AiHeatPlanCard;

const answer = (id: string, cards: AiWorkCard[] | AiHeatPlanCard[], status: 'ready' | 'done' = 'ready', messageId?: number): AiChatEntry => ({
  id,
  role: 'assistant',
  content: '',
  sources: [],
  cards: cards.map((card) => ({ card, status })),
  ...(messageId ? { messageId } : {}),
});

describe('말로 실행할 카드 고르기', () => {
  it('실행 전 카드가 있는 가장 최근 답의 마지막 카드, 순서를 말하면 그 카드', () => {
    const entries = [answer('old', [workCard({ key: 'o1' })]), { id: 'q', role: 'user', content: '또' } as AiChatEntry, answer('new', [workCard({ key: 'n1' }), workCard({ key: 'n2' })], 'ready', 42)];
    expect(pickVoiceApprovalCard(entries, null)).toMatchObject({ ok: true, entryId: 'new', messageId: 42, item: { card: { key: 'n2' } } });
    expect(pickVoiceApprovalCard(entries, 1)).toMatchObject({ ok: true, item: { card: { key: 'n1' } } });
    expect(pickVoiceApprovalCard(entries, 3)).toEqual({ ok: false, reason: '3번째 카드가 없어요 (실행 전 카드 2장)' });
  });

  it('이미 실행한 답은 건너뛰고, 카드가 없으면 이유를 준다', () => {
    expect(pickVoiceApprovalCard([answer('a', [workCard({ key: 'x' })]), answer('b', [workCard({ key: 'y' })], 'done')], null)).toMatchObject({ ok: true, entryId: 'a' });
    expect(pickVoiceApprovalCard([], null)).toEqual({ ok: false, reason: '실행할 카드가 없어요' });
  });

  it('되돌리기 어려운 카드·빈 칸이 남은 카드는 고르지 않는다', () => {
    expect(pickVoiceApprovalCard([answer('a', [heatCard])], null)).toEqual({ ok: false, reason: '이 카드는 말로 실행할 수 없어요. 화면에서 눌러 실행해 주세요' });
    expect(pickVoiceApprovalCard([answer('a', [workCard({ assigneeId: null })])], null)).toEqual({ ok: false, reason: '담당자을(를) 채워야 실행할 수 있어요' });
  });
});
