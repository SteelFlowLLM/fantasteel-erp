// 대시보드 위젯 중 이미 있는 서버 API를 모아 화면에서 묶는 3개(납기 위험·강종별 불합격률·생산량)를 본다.
import { afterEach, describe, expect, it } from 'vitest';
import { serverDashboardApi, serverDashboardSourceApi } from '@/api/server/dashboard';
import { ok, stopFakeServer, useFakeServer } from '@/api/server/serverTestKit';
import { trendWindow } from '@/features/dashboard/lib/widgetMath';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

const WINDOW = trendWindow('2026-10-07', 30);
afterEach(() => stopFakeServer());

const fulfillmentItem = (salesOrderItemId: number, extra: object) => ({
  salesOrderItemId,
  itemId: 101,
  itemCode: 'SL-SS275-250x1200x10000',
  itemName: '',
  itemType: 'SLAB',
  theoreticalWeightTon: '23.550',
  orderedQty: 10,
  orderedTon: '235.500',
  dueDate: '2026-10-09',
  salesOrderItemStatus: 'OPEN',
  isDueRisk: true,
  shippedQty: 4,
  unshippedQty: 6,
  daysToDue: 2,
  ...extra,
});

describe('대시보드 서버 묶음 위젯 (api/server/dashboard.ts)', () => {
  it('납기 위험: 진행 중 품목 중 서버가 isDueRisk로 표시한 것만, 미출하 톤을 계산한다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.sales, (c) =>
      c.path === '/dashboard/widgets/order-fulfillment'
        ? ok({
            today: '2026-10-07',
            deliveryRiskDays: 3,
            salesOrders: [
              {
                salesOrderId: 1,
                salesOrderNo: 'SO-2610-001',
                customerName: '한빛조선',
                items: [fulfillmentItem(11, {}), fulfillmentItem(12, { isDueRisk: false, dueDate: '2026-10-30', daysToDue: 23 }), fulfillmentItem(13, { salesOrderItemStatus: 'SHIPPED', isDueRisk: false })],
              },
            ],
          })
        : undefined,
    );
    const result = await serverDashboardSourceApi.deliveryRisk();
    expect(result).toMatchObject({ deliveryRiskDays: 3, openItemCount: 2 });
    expect(result.items).toEqual([expect.objectContaining({ salesOrderItemId: 11, lineNo: 1, unshippedQty: 6, unshippedTon: '141.300', isOverdue: false })]);
  });

  it('강종별 불합격률: 기간 안 판정만 세고, 기간 밖 검사가 나오면 다음 페이지를 읽지 않는다', async () => {
    const inspection = (inspectedAt: string, inspectionResult: string, processType = 'STEELMAKING') => ({ inspectedAt, inspectionResult, processType, steelGradeCode: 'SS275' });
    const calls = useFakeServer(SEED_EMPLOYEE_NO.quality, (c) => {
      if (c.path === '/steel-grades') return ok([{ id: 2, steelGradeCode: 'SM355A' }, { id: 1, steelGradeCode: 'SS275' }]);
      if (c.path === '/quality-inspections') {
        return ok({ items: [inspection('2026-10-06T01:00:00Z', 'FAIL'), inspection('2026-10-05T01:00:00Z', 'PASS', 'CONTINUOUS_CASTING'), inspection('2026-08-01T01:00:00Z', 'FAIL')], page: 1, size: 100, total: 500 });
      }
      return undefined;
    });
    const result = await serverDashboardSourceApi.rejectRate(WINDOW);
    expect(calls.filter((c) => c.path === '/quality-inspections')).toHaveLength(1);
    expect(result.grades.map((g) => [g.steelGradeCode, g.inspectedCount, g.failedCount, g.rejectRate])).toEqual([
      ['SS275', 2, 1, 0.5],
      ['SM355A', 0, 0, null],
    ]);
    expect(result.grades[0].byProcess.find((p) => p.processType === 'STEELMAKING')).toMatchObject({ inspectedCount: 1, failedCount: 1 });
  });

  it('생산량: 슬래브·코일 LOT을 생산완료일로 묶고 톤은 규격 이론중량으로 계산한다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.admin, (c) => {
      if (c.path === '/items') return ok([{ id: 101, theoreticalWeightTon: '23.550' }, { id: 102, theoreticalWeightTon: '23.079' }]);
      if (c.path === '/lots' && c.query.lotType === 'SLAB') return ok({ items: [{ lotType: 'SLAB', itemId: 101, producedDate: '2026-10-07' }, { lotType: 'SLAB', itemId: 101, producedDate: '2026-10-07' }], page: 1, size: 100, total: 2 });
      if (c.path === '/lots') return ok({ items: [{ lotType: 'COIL', itemId: 102, producedDate: '2026-10-06' }], page: 1, size: 100, total: 1 });
      return undefined;
    });
    const result = await serverDashboardSourceApi.productionVolume(WINDOW);
    expect(result).toMatchObject({ days: 30, totalSlabQty: 2, totalCoilQty: 1, totalTon: '70.179' });
    expect(result.series.at(-1)).toEqual({ date: '2026-10-07', slabQty: 2, coilQty: 0, ton: '47.100' });
  });

  it('공정별 수율: 서버 값을 그대로 쓰고 연주 계획 대비 매수는 비운다', async () => {
    const row = { processType: 'CONTINUOUS_CASTING', resultCount: 2, inputTon: '500.000', outputTon: '490.000', actualYieldRate: '0.9800', plannedYieldRate: '0.9800' };
    useFakeServer(SEED_EMPLOYEE_NO.admin, (c) => (c.path === '/dashboard/widgets/process-yield' ? ok({ processes: [row] }) : undefined));
    expect(await serverDashboardApi.processYield()).toEqual({ processes: [{ ...row, qtyAttainmentRate: null }] });
  });

  it('여재 보유 기간: 서버 응답을 그대로 쓴다', async () => {
    const data = { today: '2026-10-07', totalQty: 2, totalTon: '47.100', maxAgeDays: 5, items: [{ itemId: 101, itemCode: 'SL-SS275-250x1200x10000', steelGradeCode: 'SS275', surplusQty: 2, surplusTon: '47.100', oldestSinceDate: '2026-10-02', maxAgeDays: 5 }] };
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, (c) => (c.path === '/dashboard/widgets/surplus-age' ? ok(data) : undefined));
    expect(await serverDashboardApi.surplusAge()).toEqual(data);
    expect(calls.map((c) => c.path)).toEqual(['/dashboard/widgets/surplus-age']);
  });
});
