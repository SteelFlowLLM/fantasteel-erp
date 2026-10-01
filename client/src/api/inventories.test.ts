// 재고 조회 api (REQ-INV-001·003·007·008, 4.2·4.3) — 시드(14.1 시작 재고, 히트 불합격, 여재, 원료 입고예정) 위에서 확인한다.
import { describe, expect, it } from 'vitest';
import { setActingEmployeeForTest } from '@/api/actor';
import { inventoryApi } from '@/api/inventories';
import { calcWeightTon } from '@/lib/weight';
import { getMockDb } from '@/mock/db';
import { checkInvariants, createSalesOrder, userActor } from '@/mock/services';
import { actAs, SEED_EMPLOYEE_NO } from '@/test/actors';

const SS275_SLAB = 'SL-SS275-250x1200x10000';
const SS275_HEAT = 'HT-BOF1-260905-001';
const SPHC_FAILED_HEAT = 'HT-BOF1-260924-001';

const itemIdOf = (code: string) => {
  const item = getMockDb().read((t) => t.item.find((i) => i.itemCode === code));
  if (!item) throw new Error(code);
  return item.id;
};

describe('재고 조회 권한', () => {
  it('계정 선택이 없으면 모든 재고 조회가 COM-002', async () => {
    setActingEmployeeForTest(null);
    await expect(inventoryApi.listProducts()).rejects.toMatchObject({ code: 'COM-002' });
    await expect(inventoryApi.listLots()).rejects.toMatchObject({ code: 'COM-002' });
    await expect(inventoryApi.listRawMaterials()).rejects.toMatchObject({ code: 'COM-002' });
    await expect(inventoryApi.listSurplus()).rejects.toMatchObject({ code: 'COM-002' });
  });

  it('없는 사원으로 요청하면 COM-002', async () => {
    setActingEmployeeForTest(999_999);
    await expect(inventoryApi.listProducts()).rejects.toMatchObject({ code: 'COM-002' });
  });

  it.each(Object.entries(SEED_EMPLOYEE_NO))('%s 역할도 재고를 본다 (조회 전용, 권한 코드 없음)', async (_key, employeeNo) => {
    actAs(employeeNo);
    await expect(inventoryApi.listProducts()).resolves.not.toHaveLength(0);
  });
});

describe('제품 탭 (REQ-INV-001·003, 4.2)', () => {
  it('14.1 시작 재고: SS275 250×1200 합격·미예약 6매 = 가용재고 6, 톤 = 매수 × 23.550', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    const rows = await inventoryApi.listProducts();
    const ss275 = rows.find((r) => r.itemCode === SS275_SLAB);
    expect(ss275).toMatchObject({
      itemType: 'SLAB',
      steelGradeCode: 'SS275',
      unitWeightTon: '23.550',
      onHandQty: 6,
      passedQty: 6,
      reservedQty: 0,
      hotRollingAllocatedQty: 0,
      availableQty: 6,
      availableTon: '141.300',
      onHandTon: '141.300',
      qtyUnit: '매',
      thicknessMm: expect.stringMatching(/^250/),
      widthMm: expect.stringMatching(/^1200/),
    });
    expect(ss275?.defaultYardName).toBeTruthy();
  });

  it('모든 규격에서 가용재고 = max(0, 합격 − 예약 − 열연 배정), 재고 = 합격 + 판정 대기 + 불합격, 톤은 소수 3자리', async () => {
    actAs(SEED_EMPLOYEE_NO.productionHead);
    const rows = await inventoryApi.listProducts();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.availableQty).toBe(Math.max(0, r.passedQty - r.reservedQty - r.hotRollingAllocatedQty));
      expect(r.onHandQty).toBe(r.passedQty + r.pendingQty + r.failedQty);
      expect(r.availableTon).toBe(calcWeightTon(r.availableQty, r.unitWeightTon));
      expect(r.reservedTon).toBe(calcWeightTon(r.reservedQty, r.unitWeightTon));
      expect(r.availableTon).toMatch(/^\d+\.\d{3}$/);
      expect(r.qtyUnit).toBe(r.itemType === 'COIL' ? '개' : '매');
    }
  });

  it('히트 불합격 하위 슬래브는 합격·가용재고에서 빠지고 불합격으로 센다 (INV-007)', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    const rows = await inventoryApi.listProducts();
    const sphc = rows.find((r) => r.itemCode.startsWith('SL-SPHC-220x1400'));
    expect(sphc).toBeDefined();
    expect(sphc?.failedQty).toBeGreaterThanOrEqual(10);
    expect(sphc?.passedQty).toBe(0);
    expect(sphc?.availableQty).toBe(0);
  });

  it('새 수주가 재고 우선 예약하면 예약이 늘고 가용재고가 줄어든다 (같은 조회를 다시 부르면 바로 반영)', async () => {
    const salesId = actAs(SEED_EMPLOYEE_NO.sales);
    const before = (await inventoryApi.listProducts()).find((r) => r.itemCode === SS275_SLAB);
    getMockDb().transact((tx) =>
      createSalesOrder(tx, userActor(salesId), {
        customerId: tx.tables.customer.find((c) => c.customerCode === 'CUS-01')?.id ?? 0,
        items: [{ itemId: itemIdOf(SS275_SLAB), orderedQty: 4, dueDate: '2026-10-20' }],
      }),
    );
    const after = (await inventoryApi.listProducts()).find((r) => r.itemCode === SS275_SLAB);
    expect(before?.availableQty).toBe(6);
    expect(after).toMatchObject({ onHandQty: 6, passedQty: 6, reservedQty: 4, availableQty: 2, reservedTon: '94.200', availableTon: '47.100' });
    expect(checkInvariants(getMockDb().read((t) => t))).toEqual([]);
  });
});

describe('LOT 목록 탭', () => {
  it('모든 LOT: 유형·규격·생산완료일(날짜)·품질·배정 여부·야드·상태, 생산완료일 최근 순', async () => {
    actAs(SEED_EMPLOYEE_NO.logistics);
    const rows = await inventoryApi.listLots();
    const total = getMockDb().read((t) => t.lot.length);
    expect(rows).toHaveLength(total);
    for (const r of rows) expect(r.producedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const dates = rows.map((r) => r.producedDate);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(new Set(rows.map((r) => r.lotType))).toEqual(new Set(['RAW_MATERIAL', 'HOT_METAL', 'HEAT', 'SLAB', 'COIL']));
  });

  it('유형·상태 필터: 슬래브 재고만', async () => {
    actAs(SEED_EMPLOYEE_NO.logistics);
    const rows = await inventoryApi.listLots({ lotType: 'SLAB', lotStatus: 'AVAILABLE' });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.lotType === 'SLAB' && r.lotStatus === 'AVAILABLE')).toBe(true);
  });

  it('출고된 14.1 슬래브(-01~-04)는 출고, 남은 -05~-10은 합격·미배정·여재 표시, 생산계획 id로 링크', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    const rows = await inventoryApi.listLots({ lotType: 'SLAB' });
    const of = (n: string) => rows.find((r) => r.lotNo === `${SS275_HEAT}-${n}`);
    expect(of('01')).toMatchObject({ lotStatus: 'SHIPPED', quality: 'NOT_AVAILABLE' });
    expect(of('05')).toMatchObject({ lotStatus: 'AVAILABLE', quality: 'ELIGIBLE', allocationPurpose: null, heatLotNo: SS275_HEAT, itemCode: SS275_SLAB });
    expect(of('05')?.surplusAt).not.toBeNull();
    expect(of('05')?.productionPlanId).toEqual(expect.any(Number));
    expect(of('05')?.yardName).toBeTruthy();
  });

  it('히트 불합격 하위 슬래브는 HEAT_FAILED, 히트는 성분 FAIL', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    const slabs = await inventoryApi.listLots({ lotType: 'SLAB' });
    const children = slabs.filter((r) => r.heatLotNo === SPHC_FAILED_HEAT);
    expect(children.length).toBe(10);
    expect(children.every((r) => r.quality === 'HEAT_FAILED')).toBe(true);
    const heats = await inventoryApi.listLots({ lotType: 'HEAT' });
    expect(heats.find((r) => r.lotNo === SPHC_FAILED_HEAT)?.quality).toBe('FAIL');
  });

  it('열연 배정이 확정된 슬래브는 배정 여부 = HOT_ROLLING (확정 배정만)', async () => {
    actAs(SEED_EMPLOYEE_NO.productionHead);
    const rows = await inventoryApi.listLots({ lotType: 'SLAB' });
    const confirmed = getMockDb().read((t) => t.allocation.filter((a) => a.allocationStatus === 'CONFIRMED'));
    for (const a of confirmed) expect(rows.find((r) => r.lotId === a.lotId)?.allocationPurpose).toBe(a.allocationPurpose);
    const unallocated = rows.filter((r) => !confirmed.some((a) => a.lotId === r.lotId));
    expect(unallocated.every((r) => r.allocationPurpose === null)).toBe(true);
  });
});

describe('원료 탭 (REQ-INV-001: 원료는 톤)', () => {
  it('원료별 LOT 잔량 합계 + 입고예정 (실리코망가니즈 1.000t + 3.500t)', async () => {
    actAs(SEED_EMPLOYEE_NO.purchase);
    const rows = await inventoryApi.listRawMaterials();
    const byName = new Map(rows.map((r) => [r.itemName, r]));
    expect(rows.every((r) => /^\d+\.\d{3}$/.test(r.remainingTon) && /^\d+\.\d{3}$/.test(r.scheduledReceiptTon))).toBe(true);
    const smn = rows.find((r) => r.rawMaterialType === 'FERROALLOY' && r.lots.length > 0);
    expect(smn).toMatchObject({ remainingTon: '1.000', scheduledReceiptTon: '3.500' });
    expect(byName.size).toBe(rows.length);
  });

  it('잔량 합계 = 재고(AVAILABLE) LOT 잔량의 합, LOT은 입고일 오래된 순', async () => {
    actAs(SEED_EMPLOYEE_NO.purchase);
    const rows = await inventoryApi.listRawMaterials();
    for (const r of rows) {
      const sum = r.lots.filter((l) => l.lotStatus === 'AVAILABLE').reduce((acc, l) => acc + Math.round(Number(l.remainingTon) * 1000), 0);
      expect(Math.round(Number(r.remainingTon) * 1000)).toBe(sum);
      expect(r.availableLotCount).toBe(r.lots.filter((l) => l.lotStatus === 'AVAILABLE').length);
      const dates = r.lots.map((l) => l.receiptDate);
      expect([...dates].sort()).toEqual(dates);
      for (const l of r.lots) expect(l.lotNo.startsWith('RM-')).toBe(true);
    }
    const ore = rows.find((r) => r.rawMaterialType === 'IRON_ORE');
    expect(ore?.remainingTon).toBe('633.330');
    expect(ore?.defaultYardName).toBeTruthy();
  });
});

describe('여재 탭 (REQ-INV-008)', () => {
  it('여재 = 미배정 합격 슬래브, 규격별 묶음, 가용재고에 포함', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    const rows = await inventoryApi.listSurplus();
    const ss275 = rows.find((r) => r.itemCode === SS275_SLAB);
    expect(ss275).toMatchObject({ unallocatedPassedQty: 6, reservedQty: 0, surplusQty: 6, unitWeightTon: '23.550', unallocatedPassedTon: '141.300', surplusTon: '141.300' });
    expect(ss275?.lots.map((l) => l.lotNo)).toEqual(['05', '06', '07', '08', '09', '10'].map((n) => `${SS275_HEAT}-${n}`));
    expect(ss275?.lots.every((l) => l.surplusAt !== null && l.yardName && l.productionPlanId !== null)).toBe(true);
    const products = await inventoryApi.listProducts();
    for (const s of rows) {
      const product = products.find((p) => p.itemId === s.itemId);
      expect(s.surplusQty).toBe(product?.availableQty);
      expect(s.unallocatedPassedQty).toBeLessThanOrEqual(product?.passedQty ?? 0);
    }
  });

  it('여재로 수주를 예약하면 여재 슬래브는 그대로(미배정)지만 그 규격의 가용재고가 줄어든다', async () => {
    const salesId = actAs(SEED_EMPLOYEE_NO.sales);
    getMockDb().transact((tx) =>
      createSalesOrder(tx, userActor(salesId), {
        customerId: tx.tables.customer.find((c) => c.customerCode === 'CUS-02')?.id ?? 0,
        items: [{ itemId: itemIdOf(SS275_SLAB), orderedQty: 6, dueDate: '2026-10-25' }],
      }),
    );
    const ss275 = (await inventoryApi.listSurplus()).find((r) => r.itemCode === SS275_SLAB);
    expect(ss275).toMatchObject({ unallocatedPassedQty: 6, reservedQty: 6, surplusQty: 0, surplusTon: '0.000' });
  });

  it('슬래브만 여재다 (코일 규격은 없음)', async () => {
    actAs(SEED_EMPLOYEE_NO.productionHead);
    const rows = await inventoryApi.listSurplus();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.itemCode.startsWith('SL-'))).toBe(true);
  });
});
