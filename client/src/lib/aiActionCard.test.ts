// AI 어시스턴트 실행 카드: 사용자가 고친 값 반영, 필수 칸, 실행 요청 만들기.
import type { AiActionCard, AiHeatPlanCard, AiHotRollingCard, AiPastCaseCard, AiSalesOrderCard, AiWorkCard } from '@fantasteel/shared';
import { describe, expect, it } from 'vitest';
import { applyCardChanges, executeInputOf, missingOfCard, needsConfirmation, pastCaseIssues, salesOrderIssues } from '@/lib/aiActionCard';

const card = (over: Partial<AiWorkCard>): AiWorkCard => ({
  key: 'a1',
  kind: 'TASK',
  title: '견적서 보내기',
  description: null,
  assigneeId: null,
  assigneeName: null,
  dueDate: null,
  startAt: null,
  endAt: null,
  endAssumed: false,
  attendeeIds: [],
  purchase: null,
  itemName: null,
  issues: [],
  ...over,
});

describe('실행 카드 필수 칸', () => {
  it('업무는 담당자와 마감일이 비면 실행할 수 없다', () => {
    expect(missingOfCard(card({}))).toEqual(['담당자', '마감일']);
    expect(missingOfCard(card({ assigneeId: 7, dueDate: '2026-10-20' }))).toEqual([]);
  });

  it('일정은 시각과 참석자, 구매요청은 원료·수량·입고일이 필요하다', () => {
    expect(missingOfCard(card({ kind: 'EVENT' }))).toEqual(['시작 시각', '끝 시각', '참석자']);
    expect(missingOfCard(card({ kind: 'PURCHASE', purchase: { itemId: null, requestedTon: null, desiredReceiptDate: null, requestReason: '철광석', sourceText: null } }))).toEqual(['원료 품목', '수량(톤)', '희망 입고일']);
  });
});

describe('사용자가 고친 칸 반영', () => {
  it('고친 칸의 확인 사유만 풀린다', () => {
    const before = card({ issues: ['담당자를 정해 주세요', '마감일을 확인해 주세요 (오늘부터 1년 안)'] });
    const after = applyCardChanges(before, { assigneeId: 7 });
    expect(after.assigneeId).toBe(7);
    expect(after.issues).toEqual(['마감일을 확인해 주세요 (오늘부터 1년 안)']);
  });

  it('datetime-local 값은 +09:00 시각으로 맞추고, 가정한 끝 시각은 시작을 따라간다', () => {
    const before = card({ kind: 'EVENT', startAt: '2026-10-20T10:00:00+09:00', endAt: '2026-10-20T11:00:00+09:00', endAssumed: true, attendeeIds: [1], issues: ['끝 시각은 말이 없어 1시간으로 가정했어요'] });
    const moved = applyCardChanges(before, { startAt: '2026-10-21T14:30' });
    expect(moved.startAt).toBe('2026-10-21T14:30:00+09:00');
    expect(moved.endAt).toBe('2026-10-21T15:30:00+09:00');
    expect(moved.endAssumed).toBe(true);
    const fixed = applyCardChanges(moved, { endAt: '2026-10-21T16:00' });
    expect(fixed.endAt).toBe('2026-10-21T16:00:00+09:00');
    expect(fixed.endAssumed).toBe(false);
    expect(fixed.issues).toEqual([]);
  });

  it('제목을 고치면 고치지 않은 구매요청 사유가 따라간다', () => {
    const before = card({ kind: 'PURCHASE', title: '철광석 구매', purchase: { itemId: 3, requestedTon: '10.000', desiredReceiptDate: '2026-10-30', requestReason: '철광석 구매', sourceText: null } });
    expect(applyCardChanges(before, { title: '철광석 긴급 구매' }).purchase?.requestReason).toBe('철광석 긴급 구매');
    const own = { ...before, purchase: { ...before.purchase!, requestReason: '재고 부족' } };
    expect(applyCardChanges(own, { title: '철광석 긴급 구매' }).purchase?.requestReason).toBe('재고 부족');
  });
});

describe('실행 요청 만들기', () => {
  it('정하지 않은 칸은 보내지 않는다', () => {
    expect(executeInputOf(card({ assigneeId: 7 }))).toEqual({ kind: 'TASK', title: '견적서 보내기', assigneeId: 7 });
  });

  it('일정은 참석자까지, 구매요청은 채운 칸만 보낸다', () => {
    expect(executeInputOf(card({ kind: 'EVENT', startAt: 'S', endAt: 'E', attendeeIds: [1, 2], description: '메모' }))).toEqual({
      kind: 'EVENT',
      title: '견적서 보내기',
      description: '메모',
      startAt: 'S',
      endAt: 'E',
      attendeeIds: [1, 2],
    });
    expect(executeInputOf(card({ kind: 'PURCHASE', purchase: { itemId: 3, requestedTon: null, desiredReceiptDate: null, requestReason: 'x', sourceText: null } }))).toMatchObject({ purchase: { itemId: 3 } });
  });
});

const salesOrder = (over: Partial<AiSalesOrderCard> = {}): AiSalesOrderCard => ({
  key: 'a2',
  kind: 'SALES_ORDER',
  title: '수주 등록 · 한강철강',
  customerId: 4,
  customerName: '한강철강',
  lines: [{ itemId: 9, itemLabel: 'SS275 · 코일', orderedQty: 12, dueDate: '2026-11-10' }],
  issues: [],
  ...over,
});
const pastCase = (over: Partial<AiPastCaseCard> = {}): AiPastCaseCard => ({
  key: 'a3',
  kind: 'PAST_CASE',
  title: '성분 불합격',
  lotId: 5,
  lotNo: 'HT-2610-001',
  caseCategory: 'QUALITY',
  phenomenon: '규소 초과',
  cause: '',
  actionTaken: '',
  equipmentText: '',
  occurredDate: '2026-10-10',
  aiWritten: false,
  referenceCaseNos: [],
  issues: ['원인을 확인해 주세요', '조치를 확인해 주세요'],
  ...over,
});
const hotRolling: AiHotRollingCard = { key: 'a4', kind: 'HOT_ROLLING', title: '열연 배정', productionPlanId: 7, productionPlanNo: 'PP-2610-0001', itemLabel: 'SL-1', neededQty: 2, availableQty: 5, lots: [{ lotId: 11, lotNo: 'L11', producedDate: null, heatNo: null }, { lotId: 12, lotNo: 'L12', producedDate: null, heatNo: null }], issues: [] };
const heatPlan: AiHeatPlanCard = { key: 'a5', kind: 'HEAT_PLAN', title: '히트 편성', productionPlanId: 7, productionPlanNo: 'PP-2610-0001', itemLabel: 'SL-1', shortageQty: 10, currentHeatCount: 1, newHeatCount: 2, heatTon: '30.000', requiredMoltenSteelTon: '40.000', issues: [] };

describe('수주 등록 카드', () => {
  it('고객사·규격·매수·납기가 모두 있어야 실행할 수 있다', () => {
    expect(missingOfCard(salesOrder())).toEqual([]);
    expect(missingOfCard(salesOrder({ customerId: null, lines: [{ itemId: null, itemLabel: null, orderedQty: null, dueDate: null }] }))).toEqual(['고객사', '1번째 줄 규격', '1번째 줄 매수', '1번째 줄 납기']);
    expect(missingOfCard(salesOrder({ lines: [] }))).toEqual(['품목']);
  });

  it('실행 요청에는 정한 칸만 담고, 고친 뒤의 확인 사유는 비어 있는 칸에서 다시 만든다', () => {
    expect(executeInputOf(salesOrder())).toEqual({ kind: 'SALES_ORDER', customerId: 4, lines: [{ itemId: 9, orderedQty: 12, dueDate: '2026-11-10' }] });
    expect(executeInputOf(salesOrder({ customerId: null, lines: [{ itemId: 9, itemLabel: null, orderedQty: null, dueDate: null }] }))).toEqual({ kind: 'SALES_ORDER', lines: [{ itemId: 9 }] });
    expect(salesOrderIssues(salesOrder())).toEqual([]);
    expect(salesOrderIssues(salesOrder({ customerId: null }))).toEqual(['고객사를 정해 주세요']);
  });
});

describe('열연 배정·히트 편성·사례 카드', () => {
  it('열연 배정은 추천한 슬래브를 그대로 보내고, 히트 편성은 계획만 보낸다', () => {
    expect(executeInputOf(hotRolling)).toEqual({ kind: 'HOT_ROLLING', productionPlanId: 7, lotIds: [11, 12] });
    expect(executeInputOf(heatPlan)).toEqual({ kind: 'HEAT_PLAN', productionPlanId: 7 });
    expect(missingOfCard(hotRolling)).toEqual([]);
  });

  it('수주·열연 배정·히트 편성만 실행 뒤 확인창을 거친다', () => {
    const kinds = [salesOrder(), hotRolling, heatPlan, pastCase()].map((c: AiActionCard) => needsConfirmation(c));
    expect(kinds).toEqual([true, true, true, false]);
  });

  it('사례는 제목·현상·발생일만 필수이고, 원인·조치를 채우면 그 사유가 풀린다', () => {
    expect(missingOfCard(pastCase())).toEqual([]);
    expect(missingOfCard(pastCase({ phenomenon: ' ' }))).toEqual(['현상']);
    expect(pastCaseIssues(pastCase({ cause: '용선 규소 높음' }))).toEqual(['조치를 확인해 주세요']);
    expect(executeInputOf(pastCase())).toMatchObject({ kind: 'PAST_CASE', lotId: 5, title: '성분 불합격', occurredDate: '2026-10-10' });
  });
});
