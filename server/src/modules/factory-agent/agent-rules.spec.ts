import type { MrpRequisitionLineView, ReproductionCheck } from '@fantasteel/shared';
import { addDays, agentMetaOf, goodQtyShortageCandidate, rawShortageCandidates } from './agent-rules';

const line = (over: Partial<MrpRequisitionLineView> = {}): MrpRequisitionLineView => ({
  productionPlanId: 3,
  productionPlanNo: 'PP-2610-0003',
  itemId: 7,
  itemCode: 'ORE01',
  itemName: '철광석',
  netRequirementTon: '444.444',
  requiredDate: '2026-10-20',
  existingPurchaseRequisitionNo: null,
  ...over,
});

const check = (over: Partial<ReproductionCheck> = {}): ReproductionCheck => ({
  salesOrderItemId: 12,
  salesOrderId: 5,
  salesOrderNo: 'SO-2610-001',
  lineNo: 1,
  salesOrderItemStatus: 'OPEN',
  unshippedQty: 10,
  openPlans: [],
  orderedQty: 10,
  shippedQty: 0,
  activeReservedQty: 6,
  unsecuredQty: 4,
  openPlanRemainingQty: 0,
  additionalPlanQty: 4,
  reservationAvailableQty: 0,
  reproductionNeedQty: 4,
  ...over,
});

describe('rawShortageCandidates (REQ-AGT-002)', () => {
  it('순소요가 있는 줄마다 구매요청 후보를 만든다', () => {
    const [c] = rawShortageCandidates([line()], '2026-10-15');
    expect(c).toMatchObject({ productionPlanId: 3, itemId: 7, requestedTon: '444.444', desiredReceiptDate: '2026-10-20' });
    expect(c.meta.targetKey).toBe('RAW_SHORTAGE:plan:3:item:7');
    expect(c.meta.evidence.netRequirementTon).toBe('444.444');
  });

  it('순소요가 0이면 후보를 만들지 않는다 (잔량 + 입고예정이 소요 이상)', () => {
    expect(rawShortageCandidates([line({ netRequirementTon: '0.000' })], '2026-10-15')).toEqual([]);
  });

  it('같은 계획·원료의 구매요청이 이미 있으면 만들지 않는다', () => {
    expect(rawShortageCandidates([line({ existingPurchaseRequisitionNo: 'PR-2610-001' })], '2026-10-15')).toEqual([]);
  });

  it('필요일이 지났으면 희망 입고일을 오늘로 둔다', () => {
    const [c] = rawShortageCandidates([line({ requiredDate: '2026-10-01' })], '2026-10-15');
    expect(c.desiredReceiptDate).toBe('2026-10-15');
  });
});

describe('goodQtyShortageCandidate (REQ-AGT-003)', () => {
  it('추가 계획이 필요하면 재생산 후보를 만든다', () => {
    const c = goodQtyShortageCandidate(check(), '2026-10-15');
    expect(c).toMatchObject({ salesOrderItemId: 12, additionalPlanQty: 4 });
    expect(c?.meta.targetKey).toBe('GOOD_QTY_SHORTAGE:soItem:12');
  });

  it('예약·진행 계획으로 채워지면(추가 계획 0) 만들지 않는다', () => {
    expect(goodQtyShortageCandidate(check({ additionalPlanQty: 0 }), '2026-10-15')).toBeNull();
  });

  it('취소·출하완료 품목은 만들지 않는다', () => {
    expect(goodQtyShortageCandidate(check({ salesOrderItemStatus: 'CANCELLED' }), '2026-10-15')).toBeNull();
    expect(goodQtyShortageCandidate(check({ salesOrderItemStatus: 'SHIPPED' }), '2026-10-15')).toBeNull();
  });
});

describe('agentMetaOf', () => {
  it('Agent가 만든 초안의 감지 근거를 읽는다', () => {
    const [c] = rawShortageCandidates([line()], '2026-10-15');
    expect(agentMetaOf({ itemId: 7, agent: c.meta })).toEqual(c.meta);
  });

  it('메시지 초안(agent 칸 없음)이나 알 수 없는 유형은 null', () => {
    expect(agentMetaOf({ itemId: 7 })).toBeNull();
    expect(agentMetaOf({ agent: { riskType: 'UNKNOWN', targetKey: 'x' } })).toBeNull();
    expect(agentMetaOf(null)).toBeNull();
  });
});

describe('addDays', () => {
  it('달·해를 넘겨 더한다', () => {
    expect(addDays('2026-10-15', 30)).toBe('2026-11-14');
    expect(addDays('2026-12-25', 10)).toBe('2027-01-04');
  });
});
