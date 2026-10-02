// 대시보드 시계열 시드: 끝난 거래만 더하고 core 시드(14.1 시작 재고·원료 잔량·MRP·알림)는 그대로인지 확인한다.
import { describe, expect, it } from 'vitest';
import { createSeedTables } from '@/mock/seed';
import type { MockTables } from '@/mock/schema';
import { SEED_DASHBOARD, seedDashboard } from '@/mock/seeds/dashboard';
import { checkInvariants, computeMrp, listSalesOrders, productInventory, rawMaterialInventory, surplusSlabs } from '@/mock/services';
import type { MockTx } from '@/mock/store';


const at = (tables: MockTables, iso: string) => {
  const now = new Date(iso);
  return { tables, now, nowIso: now.toISOString() };
};

function snapshot(tables: MockTables) {
  return {
    raw: rawMaterialInventory(tables).map((r) => ({ itemCode: r.itemCode, remainingTon: r.remainingTon, scheduledReceiptTon: r.scheduledReceiptTon })),
    mrp: computeMrp(tables, { from: '2026-10-01', to: '2026-10-31' }).materials.map((m) => [m.itemCode, m.grossTon, m.onHandTon, m.netTon]),
    stock: productInventory(tables).map((r) => [r.itemCode, r.onHandQty, r.reservedQty, r.availableQty]),
    surplus: surplusSlabs(tables).map((r) => [r.itemCode, r.surplusQty]),
    unread: tables.notification.filter((n) => !n.isRead).map((n) => n.id),
  };
}

describe('대시보드 시계열 시드', () => {
  // 등록부에 이 시드가 들어가 있으므로 'dashboard'만 빼고 만든 시드에 직접 돌려 비교한다
  const tables = createSeedTables({ areaSeeders: (key) => key !== 'dashboard' });
  const before = snapshot(tables);
  const eventCount = tables.businessEvent.length;
  seedDashboard(at(tables, '2026-08-24T09:00:00+09:00'));

  it('불변조건을 지키고, 수주 4건은 모두 출하완료다', () => {
    expect(checkInvariants(tables)).toEqual([]);
    const added = listSalesOrders(tables).filter((so) => so.salesOrderNo.startsWith('SO-2608-'));
    expect(added.map((so) => so.salesOrderNo).sort()).toEqual(['SO-2608-001', 'SO-2608-002', 'SO-2608-003', 'SO-2608-004']);
    expect(added.every((so) => so.status === 'SHIPPED')).toBe(true);
    expect(tables.productionPlan.filter((p) => p.productionPlanNo.startsWith('PP-2608-')).every((p) => p.productionPlanStatus === 'COMPLETED')).toBe(true);
    expect(tables.businessEvent.length).toBeGreaterThan(eventCount);
  });

  it('원료는 정확히 다 쓰고, core 시드의 원료·MRP·재고·여재·안 읽은 알림은 그대로다', () => {
    const ownLots = tables.lot.filter((l) => l.lotType === 'RAW_MATERIAL' && l.producedDate === SEED_DASHBOARD.receiptDate);
    expect(ownLots.length).toBe(4);
    expect(ownLots.every((l) => l.remainingTon === '0.000' && l.lotStatus === 'CONSUMED')).toBe(true);
    const after = snapshot(tables);
    expect(after.raw).toEqual(before.raw);
    expect(after.mrp).toEqual(before.mrp);
    expect(after.surplus).toEqual(before.surplus);
    expect(after.unread).toEqual(before.unread);
    // 새 규격은 모두 출고되어 재고가 없다 (core 규격의 재고는 그대로)
    const stockOf = (rows: (string | number)[][]) => rows.filter((r) => Number(r[1]) > 0);
    expect(stockOf(after.stock)).toEqual(stockOf(before.stock));
  });

  it('9월에 생산·검사·출고 기록이 여러 날에 걸쳐 있다', () => {
    const shippedDates = new Set(tables.lot.filter((l) => l.shippedAt).map((l) => new Date(l.shippedAt ?? '').toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })));
    for (const date of SEED_DASHBOARD.issueDates) expect(shippedDates.has(date)).toBe(true);
    const producedDates = new Set(tables.lot.filter((l) => l.lotType === 'SLAB' || l.lotType === 'COIL').map((l) => l.producedDate));
    expect(producedDates.size).toBeGreaterThanOrEqual(8);
    const coils = tables.lot.filter((l) => l.lotType === 'COIL' && l.lotStatus === 'SHIPPED');
    expect(coils.length).toBe(10);
  });
});
