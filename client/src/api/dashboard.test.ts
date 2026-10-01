// 대시보드 위젯 조회: 권한(COM-002·단계 잠금)과 숫자(core 읽기 모델과 같은 값)를 시드 위에서 확인한다.
import { beforeEach, describe, expect, it } from 'vitest';
import { setActingEmployeeForTest } from '@/api/actor';
import { dashboardApi, DASHBOARD_TREND_DAYS } from '@/api/dashboard';
import { getMockDb } from '@/mock/db';
import { seedDashboard } from '@/mock/seeds/dashboard';
import { seedTxAt } from '@/mock/seeds';
import { createSalesOrder, productInventory, userActor } from '@/mock/services';
import { actAs, SEED_EMPLOYEE_NO } from '@/test/actors';

const TODAY = '2026-10-01';
const opts = { today: TODAY };

/** 시계열 시드가 등록부에 없으면(병합 전) 여기서 넣는다 → 병합 전후 같은 숫자 */
function ensureDashboardSeed(): void {
  getMockDb().transact((tx) => {
    if (!tx.tables.salesOrder.some((so) => so.salesOrderNo === 'SO-2608-001')) seedDashboard(seedTxAt(tx, '2026-08-24T09:00:00+09:00'));
  });
}

beforeEach(() => {
  ensureDashboardSeed();
});

describe('권한', () => {
  it('계정 선택이 없으면 모든 위젯이 COM-002', async () => {
    setActingEmployeeForTest(null);
    await expect(dashboardApi.widget('PRODUCT_STOCK', opts)).rejects.toMatchObject({ code: 'COM-002' });
    await expect(dashboardApi.widget('PROCESS_FLOW', opts)).rejects.toMatchObject({ code: 'COM-002' });
  });

  it('위젯 데이터를 보는 화면의 조회 권한이 없으면 COM-002 (덧붙임 = 필요한 권한)', async () => {
    actAs(SEED_EMPLOYEE_NO.logistics);
    await expect(dashboardApi.widget('ORDER_FULFILLMENT', opts)).rejects.toMatchObject({ code: 'COM-002', detail: '수주 등록·수주 취소 조회 권한이 필요해요' });
    await expect(dashboardApi.widget('DELIVERY_RISK', opts)).rejects.toMatchObject({ code: 'COM-002' });
    actAs(SEED_EMPLOYEE_NO.sales);
    await expect(dashboardApi.widget('PROCESS_YIELD', opts)).rejects.toMatchObject({ code: 'COM-002' });
    await expect(dashboardApi.widget('RAW_MATERIAL_BALANCE', opts)).rejects.toMatchObject({ code: 'COM-002' });
    await expect(dashboardApi.widget('REJECT_RATE', opts)).rejects.toMatchObject({ code: 'COM-002' });
    actAs(SEED_EMPLOYEE_NO.quality);
    await expect(dashboardApi.widget('SHIPMENT_RESULT', opts)).rejects.toMatchObject({ code: 'COM-002' });
    await expect(dashboardApi.widget('PURCHASE_PROGRESS', opts)).rejects.toMatchObject({ code: 'COM-002' });
  });

  it('모든 사원이 보는 위젯: 작업 로그·제품 재고·여재 보유 기간', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    await expect(dashboardApi.widget('RECENT_EVENTS', opts)).resolves.toBeTruthy();
    await expect(dashboardApi.widget('PRODUCT_STOCK', opts)).resolves.toBeTruthy();
    await expect(dashboardApi.widget('SURPLUS_AGE', opts)).resolves.toBeTruthy();
  });

  it('공정 흐름 현황: 볼 수 없는 단계는 숫자 없이(null) 온다', async () => {
    actAs(SEED_EMPLOYEE_NO.purchase);
    const flow = await dashboardApi.widget('PROCESS_FLOW', opts);
    expect(flow.salesOrders).toBeNull();
    expect(flow.inspections).toBeNull();
    expect(flow.shipmentRequests).toBeNull();
    expect(flow.goodsIssues).toBeNull();
    expect(flow.productionPlans).not.toBeNull(); // 구매 → 생산계획 조회
    expect(flow.inventories.slabAvailableQty).toBeGreaterThan(0);

    actAs(SEED_EMPLOYEE_NO.admin);
    const all = await dashboardApi.widget('PROCESS_FLOW', opts);
    expect(all.salesOrders).toEqual({ openCount: 4, dueRiskCount: 1 }); // SO-2609-002~005, 납기 위험 SO-2609-004
    expect(all.productionPlans).toEqual({ plannedCount: 0, inProgressCount: 2 }); // PP-2609-0003·0004
    expect(all.inspections).toMatchObject({ pendingCount: 3, heatCount: 1, slabCount: 2, coilCount: 0 });
    expect(all.shipmentRequests).toEqual({ requestedCount: 1, allocatedCount: 0 }); // DR-2609-0002
  });
});

describe('숫자', () => {
  it('수주 충족 현황: 진행 중 수주를 납기 빠른 순으로, 검사합격 = 예약 + 출하, 진행률 = 출하 ÷ 수주', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    const data = await dashboardApi.widget('ORDER_FULFILLMENT', opts);
    expect(data.deliveryRiskDays).toBe(3);
    expect(data.salesOrders.map((so) => so.salesOrderNo)).toEqual(['SO-2609-004', 'SO-2609-005', 'SO-2609-003', 'SO-2609-002']);
    const risk = data.salesOrders[0];
    expect(risk).toMatchObject({ isDueRisk: true, customerName: '나래조선' });
    expect(risk.items[0]).toMatchObject({ orderedQty: 3, reservedQty: 3, passedQty: 3, shippedQty: 0, daysToDue: 1, isDueRisk: true, shippedRatio: 0 });
    const mixed = data.salesOrders[2];
    expect(mixed.items.map((i) => i.itemType)).toEqual(['COIL', 'SLAB']);
    expect(mixed.items[0]).toMatchObject({ orderedQty: 6, passedQty: 3, reservedQty: 3, shippedQty: 0 });
    for (const so of data.salesOrders) for (const item of so.items) expect(item.passedQty).toBe(item.reservedQty + item.shippedQty);
  });

  it('납기 위험 수주: 기준일 3일 이내·지난 납기, 남은 매수와 톤', async () => {
    actAs(SEED_EMPLOYEE_NO.salesHead);
    const now = await dashboardApi.widget('DELIVERY_RISK', opts);
    expect(now.items.map((i) => [i.salesOrderNo, i.daysToDue, i.isOverdue])).toEqual([['SO-2609-004', 1, false]]);
    expect(now.items[0].unshippedTon).toBe('88.314'); // 3매 × 29.438t (250×1500×10000)

    const later = await dashboardApi.widget('DELIVERY_RISK', { today: '2026-10-13' });
    expect(later.items.map((i) => [i.salesOrderNo, i.lineNo, i.isOverdue])).toEqual([
      ['SO-2609-004', 1, true],
      ['SO-2609-005', 1, true],
      ['SO-2609-003', 1, false],
      ['SO-2609-003', 2, false],
      ['SO-2609-002', 1, false],
    ]);
  });

  it('제품 재고: 재고 화면(productInventory)과 같은 가용·예약', async () => {
    actAs(SEED_EMPLOYEE_NO.logistics);
    const data = await dashboardApi.widget('PRODUCT_STOCK', opts);
    const rows = getMockDb().read((tables) => productInventory(tables));
    const slabTotal = data.totals.find((t) => t.itemType === 'SLAB');
    expect(slabTotal?.availableQty).toBe(rows.filter((r) => r.itemType === 'SLAB').reduce((s, r) => s + r.availableQty, 0));
    expect(data.items.find((i) => i.itemCode === 'SL-SS275-250x1200x10000')).toMatchObject({ onHandQty: 6, reservedQty: 0, availableQty: 6 });
    expect(data.items.every((i) => i.onHandQty > 0)).toBe(true);
  });

  it('공정별 수율: 제강 = 계획 수율, 연주는 손실·매수 내림으로 계획보다 낮고, 제선은 수율 없음', async () => {
    actAs(SEED_EMPLOYEE_NO.productionHead);
    const data = await dashboardApi.widget('PROCESS_YIELD', opts);
    const byType = Object.fromEntries(data.processes.map((p) => [p.processType, p]));
    expect(data.processes.map((p) => p.processType)).toEqual(['IRONMAKING', 'STEELMAKING', 'CONTINUOUS_CASTING', 'HOT_ROLLING']);
    expect(byType.IRONMAKING).toMatchObject({ actualYieldRate: null, plannedYieldRate: null });
    expect(byType.STEELMAKING).toMatchObject({ actualYieldRate: '0.9000', plannedYieldRate: '0.9000' });
    expect(byType.CONTINUOUS_CASTING.plannedYieldRate).toBe('0.9800');
    expect(Number(byType.CONTINUOUS_CASTING.actualYieldRate)).toBeLessThan(0.98);
    expect(byType.CONTINUOUS_CASTING.qtyAttainmentRate).toBe('1.0000'); // 시드 히트에서는 손실 매수가 늘 0
    expect(byType.HOT_ROLLING.resultCount).toBeGreaterThan(0);
  });

  it('원료 잔량 대비 소요: MRP 결과 그대로 (14.1 수주 뒤 실리코망가니즈만 부족 1.500t)', async () => {
    actAs(SEED_EMPLOYEE_NO.purchase);
    const before = await dashboardApi.widget('RAW_MATERIAL_BALANCE', opts);
    expect(before.planCount).toBe(0);
    expect(before.materials.map((m) => m.grossTon)).toEqual(['0.000', '0.000', '0.000', '0.000']);

    getMockDb().transact((tx) => {
      const sales = tx.tables.employee.find((e) => e.employeeNo === SEED_EMPLOYEE_NO.sales);
      const item = tx.tables.item.find((i) => i.itemCode === 'SL-SS275-250x1200x10000');
      const customer = tx.tables.customer.find((c) => c.customerCode === 'CUS-01');
      if (!sales || !item || !customer) throw new Error('시드 참조 없음');
      createSalesOrder(seedTxAt(tx, '2026-10-01T10:00:00+09:00'), userActor(sales.id), { customerId: customer.id, items: [{ itemId: item.id, orderedQty: 10, dueDate: '2026-10-20' }] });
    });
    const after = await dashboardApi.widget('RAW_MATERIAL_BALANCE', opts);
    expect(after.planCount).toBe(1);
    const smn = after.materials.find((m) => m.itemCode === 'SMN01');
    expect([smn?.grossTon, smn?.onHandTon, smn?.netTon]).toEqual(['2.500', '1.000', '1.500']);
    expect(after.materials.filter((m) => m.itemCode !== 'SMN01').every((m) => m.netTon === '0.000')).toBe(true);
  });

  it('강종별 불합격률: 최근 30일 판정된 검사 중 불합격 (SM355A 슬래브 표면, SPHC 히트 성분)', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    const data = await dashboardApi.widget('REJECT_RATE', opts);
    expect(data.days).toBe(DASHBOARD_TREND_DAYS);
    expect(data.from).toBe('2026-09-02');
    const grade = (code: string) => data.grades.find((g) => g.steelGradeCode === code);
    const sm355a = grade('SM355A');
    expect(sm355a?.byProcess.find((p) => p.processType === 'CONTINUOUS_CASTING')?.failedCount).toBe(1);
    expect(grade('SPHC')?.byProcess.find((p) => p.processType === 'STEELMAKING')?.failedCount).toBe(1);
    expect(grade('SS275')?.failedCount).toBe(0);
    for (const g of data.grades) {
      expect(g.inspectedCount).toBe(g.byProcess.reduce((s, p) => s + p.inspectedCount, 0));
      expect(g.rejectRate).toBe(g.inspectedCount > 0 ? g.failedCount / g.inspectedCount : null);
    }
  });

  it('구매 진행: 구매요청 상태별 건수와 입고가 남은 발주 (발주 권한이 없으면 발주는 null)', async () => {
    actAs(SEED_EMPLOYEE_NO.purchase);
    const data = await dashboardApi.widget('PURCHASE_PROGRESS', opts);
    expect(data.requisitionsByStatus).toEqual([
      { status: 'WAITING_APPROVAL', count: 1 },
      { status: 'APPROVED', count: 1 },
      { status: 'REJECTED', count: 0 },
      { status: 'ORDERED', count: 3 },
    ]);
    expect(data.openPurchaseOrders).toMatchObject({ count: 1, scheduledReceiptTon: '3.500' });
    expect(data.openPurchaseOrders?.purchaseOrders[0]).toMatchObject({ supplierName: '하람합금철', dueDate: '2026-10-28' });

    actAs(SEED_EMPLOYEE_NO.productionHead);
    const production = await dashboardApi.widget('PURCHASE_PROGRESS', opts);
    expect(production.requisitionsByStatus).not.toBeNull();
    expect(production.openPurchaseOrders).toBeNull();
  });

  it('출하 실적·생산량: 최근 30일 하루 단위 (시계열 시드 포함)', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const shipment = await dashboardApi.widget('SHIPMENT_RESULT', opts);
    expect(shipment.series).toHaveLength(DASHBOARD_TREND_DAYS);
    expect(shipment.series[0].date).toBe('2026-09-02');
    expect(shipment.series.at(-1)?.date).toBe(TODAY);
    expect([shipment.totalSlabQty, shipment.totalCoilQty, shipment.issuedRequestCount]).toEqual([44, 10, 6]);
    expect(shipment.series.find((p) => p.date === '2026-09-12')).toMatchObject({ slabQty: 4, coilQty: 0, ton: '94.200' }); // DR-2609-0001

    const volume = await dashboardApi.widget('PRODUCTION_VOLUME', opts);
    const inWindow = getMockDb().read((tables) => tables.lot.filter((l) => (l.lotType === 'SLAB' || l.lotType === 'COIL') && l.producedDate >= volume.from && l.producedDate <= TODAY));
    expect(volume.totalSlabQty).toBe(inWindow.filter((l) => l.lotType === 'SLAB').length);
    expect(volume.totalCoilQty).toBe(inWindow.filter((l) => l.lotType === 'COIL').length);
    expect(volume.series.filter((p) => p.slabQty + p.coilQty > 0).length).toBeGreaterThanOrEqual(8);
  });

  it('여재 보유 기간: 규격별 여재(예약 가용) 매수와 여재 표시일부터의 일수', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    const data = await dashboardApi.widget('SURPLUS_AGE', opts);
    expect(data.items.find((i) => i.itemCode === 'SL-SS275-250x1200x10000')).toMatchObject({ surplusQty: 6, surplusTon: '141.300', oldestSinceDate: '2026-09-06', maxAgeDays: 25 });
    expect(data.totalQty).toBe(data.items.reduce((s, i) => s + i.surplusQty, 0));
    expect(data.maxAgeDays).toBe(data.items[0].maxAgeDays);
  });

  it('최근 작업 로그: 최신 20건, 시스템 주체는 "시스템"', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    const data = await dashboardApi.widget('RECENT_EVENTS', opts);
    expect(data.items).toHaveLength(20);
    const times = data.items.map((i) => i.occurredAt);
    expect([...times].sort().reverse()).toEqual(times);
    expect(data.items.filter((i) => i.actorType === 'SYSTEM').every((i) => i.actorName === '시스템')).toBe(true);
    expect(data.totalCount).toBe(getMockDb().read((tables) => tables.businessEvent.length));
  });
});
