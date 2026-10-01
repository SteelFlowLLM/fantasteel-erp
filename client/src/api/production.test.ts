// 생산계획 api (REQ-PRD-001·002·006, 10장 상태, 14.1-6 재생산): 가짜 DB 시드 위에서 api 함수를 그대로 부른다.
import { describe, expect, it } from 'vitest';
import { PRODUCT_QTY_UNIT } from '@/codes';
import { InputError } from '@/api/client';
import { lotQualityOf, productionPlanApi } from '@/api/production';
import { eventsOf, planIdOf, planOf } from '@/api/productionTestKit';
import { checkInvariants } from '@/mock/services';
import { getMockDb } from '@/mock/db';
import { actAs, SEED_EMPLOYEE_NO } from '@/test/actors';

describe('생산계획 조회', () => {
  it('생산 담당은 목록·편성표를 보고, 생산계획 조회 권한이 없으면 COM-002', async () => {
    actAs(SEED_EMPLOYEE_NO.productionHead);
    const list = await productionPlanApi.list();
    expect(list.map((p) => p.productionPlanNo)).toEqual(expect.arrayContaining(['PP-2609-0001', 'PP-2609-0003', 'PP-2609-0004', 'PP-2609-0005']));
    const detail = await productionPlanApi.detail(planIdOf('PP-2609-0004'));
    expect(detail.formation).toMatchObject({ heatCount: 1, heatTon: '250.000', shortageQty: 5 });
    expect(detail.lots.map((l) => l.lotType)).toEqual(['HOT_METAL', 'HEAT']);
    expect(detail.lots[1].quality).toBe('PENDING');
    // 목록 한 줄에 고객사 (검색에도 쓴다, reports/3 A-1)
    const row = list.find((p) => p.productionPlanNo === 'PP-2609-0004');
    expect(row?.customerName).toBe(detail.salesOrder?.customerName);
    expect(row?.customerName).toEqual(expect.any(String));

    actAs(SEED_EMPLOYEE_NO.logistics);
    await expect(productionPlanApi.list()).rejects.toMatchObject({ code: 'COM-002' });
    await expect(productionPlanApi.detail(planIdOf('PP-2609-0004'))).rejects.toMatchObject({ code: 'COM-002' });
  });

  it('없는 계획은 COM-003', async () => {
    actAs(SEED_EMPLOYEE_NO.productionHead);
    await expect(productionPlanApi.detail(99999)).rejects.toMatchObject({ code: 'COM-003' });
  });

  it('히트 불합격 계획: 하위 슬래브는 히트 불합격, 수주 품목은 재생산 필요 8매 (14.1-6)', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    const detail = await productionPlanApi.detail(planIdOf('PP-2609-0005'));
    expect(detail.lots.find((l) => l.lotType === 'HEAT')?.quality).toBe('FAIL');
    expect(detail.lots.filter((l) => l.lotType === 'SLAB').every((l) => l.quality === 'HEAT_FAILED')).toBe(true);
    expect(detail.reproduction).toMatchObject({ unsecuredQty: 8, openPlanRemainingQty: 0, additionalPlanQty: 8, reservationAvailableQty: 0, surplusReserveQty: 0, reproductionNeedQty: 8, canReproduce: true });
  });

  it('LOT 품질 표시: 원료·용선은 검사 없음, 제품은 상위 히트 판정까지 본다', () => {
    expect(lotQualityOf({ lotType: 'HOT_METAL', isPassed: null }, null)).toBe('NONE');
    expect(lotQualityOf({ lotType: 'SLAB', isPassed: true }, { isPassed: null })).toBe('HEAT_PENDING');
    expect(lotQualityOf({ lotType: 'SLAB', isPassed: null }, { isPassed: false })).toBe('HEAT_FAILED');
    expect(lotQualityOf({ lotType: 'COIL', isPassed: false }, { isPassed: true })).toBe('FAIL');
    expect(lotQualityOf({ lotType: 'HEAT', isPassed: true }, null)).toBe('PASS');
  });
});

describe('재생산 계획 (REQ-PRD-006: 사람이 만든다)', () => {
  it('생산 담당이 누르면 부족 매수만큼 재생산 계획을 만들고, 남는 것이 없으면 다시 만들 수 없다', async () => {
    const pp5 = await (async () => {
      actAs(SEED_EMPLOYEE_NO.productionHead);
      return productionPlanApi.detail(planIdOf('PP-2609-0005'));
    })();
    const soItemId = pp5.salesOrder?.salesOrderItemId ?? 0;

    actAs(SEED_EMPLOYEE_NO.sales);
    await expect(productionPlanApi.createReproduction({ salesOrderItemId: soItemId })).rejects.toMatchObject({ code: 'COM-002' });

    actAs(SEED_EMPLOYEE_NO.productionHead);
    const before = eventsOf('REPRODUCTION_PLAN_CREATED').length;
    const result = await productionPlanApi.createReproduction({ salesOrderItemId: soItemId });
    // 창이 보여 준 '먼저 예약하는 여재' = core가 실제로 예약한 수
    expect(result.reservedFromSurplusQty).toBe(pp5.reproduction?.surplusReserveQty);
    expect(result.plan).toMatchObject({ shortageQty: 8 });
    const plan = planOf(result.plan?.id ?? 0);
    expect(plan).toMatchObject({ isReproduction: true, productionPlanStatus: 'PLANNED', salesOrderItemId: soItemId });
    expect(eventsOf('REPRODUCTION_PLAN_CREATED')).toHaveLength(before + 1);
    // 작업 로그 사유 글자의 단위는 품목 유형을 따른다 (04 4.1: 슬래브 매, 코일 개)
    expect(eventsOf('REPRODUCTION_PLAN_CREATED').at(-1)?.reasonText).toContain(`8${PRODUCT_QTY_UNIT[pp5.item.itemType]} 재생산`);

    const after = await productionPlanApi.detail(planIdOf('PP-2609-0005'));
    expect(after.reproduction).toMatchObject({ openPlanRemainingQty: 8, additionalPlanQty: 0, reproductionNeedQty: 0 });
    await expect(productionPlanApi.createReproduction({ salesOrderItemId: soItemId })).rejects.toBeInstanceOf(InputError);
    expect(getMockDb().read((t) => checkInvariants(t))).toEqual([]);
  });
});

describe('생산계획 취소 (PLANNED일 때만, 10장)', () => {
  async function newPlannedPlan(): Promise<number> {
    actAs(SEED_EMPLOYEE_NO.productionHead);
    const pp5 = await productionPlanApi.detail(planIdOf('PP-2609-0005'));
    const result = await productionPlanApi.createReproduction({ salesOrderItemId: pp5.salesOrder?.salesOrderItemId ?? 0 });
    return result.plan?.id ?? 0;
  }

  it('계획 상태면 취소되고 작업 로그가 남는다. 다시 취소하거나 진행중 계획을 취소하면 거부', async () => {
    const planId = await newPlannedPlan();
    actAs(SEED_EMPLOYEE_NO.steelmaking);
    const before = eventsOf('PRODUCTION_PLAN_CANCELLED').length;
    await productionPlanApi.cancel({ productionPlanId: planId, reasonText: '설비 점검으로 재편성', expectedUpdatedAt: planOf(planId).updatedAt });
    expect(planOf(planId)).toMatchObject({ productionPlanStatus: 'CANCELLED' });
    expect(planOf(planId).cancelledAt).not.toBeNull();
    const events = eventsOf('PRODUCTION_PLAN_CANCELLED');
    expect(events).toHaveLength(before + 1);
    expect(events[events.length - 1]).toMatchObject({ actorType: 'USER', reasonText: '설비 점검으로 재편성' });

    await expect(productionPlanApi.cancel({ productionPlanId: planId })).rejects.toBeInstanceOf(InputError);
    await expect(productionPlanApi.cancel({ productionPlanId: planIdOf('PP-2609-0004') })).rejects.toBeInstanceOf(InputError);
  });

  it('화면을 연 뒤 바뀌었으면 COM-001, 없는 계획 COM-003, 사용 권한 없으면 COM-002', async () => {
    const planId = await newPlannedPlan();
    actAs(SEED_EMPLOYEE_NO.productionHead);
    await expect(productionPlanApi.cancel({ productionPlanId: planId, expectedUpdatedAt: '2000-01-01T00:00:00.000Z' })).rejects.toMatchObject({ code: 'COM-001' });
    await expect(productionPlanApi.cancel({ productionPlanId: 99999 })).rejects.toMatchObject({ code: 'COM-003' });
    actAs(SEED_EMPLOYEE_NO.purchase);
    await expect(productionPlanApi.cancel({ productionPlanId: planId })).rejects.toMatchObject({ code: 'COM-002' });
    expect(planOf(planId).productionPlanStatus).toBe('PLANNED');
  });
});
