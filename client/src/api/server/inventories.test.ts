// 재고 서버 어댑터: 제품(합격 = 서버 onHandQty, 재고 매수 = AVAILABLE LOT 수), LOT 목록(상세로 히트·배정·처리), 원료(입고·발주로 채움), 여재(서버 재고 응답의 surplus).
import { afterEach, describe, expect, it } from 'vitest';
import { inventoryApi } from '@/api/inventories';
import { fail, ok, page, stopFakeServer, useFakeServer, type ServerCall } from '@/api/server/serverTestKit';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

const lot = (id: number, lotNo: string, lotType: string, over: Record<string, unknown> = {}) => ({
  id,
  lotNo,
  lotType,
  lotStatus: 'AVAILABLE',
  itemId: null,
  itemCode: null,
  itemName: null,
  steelGradeCode: null,
  yardName: null,
  producedDate: '2026-10-06',
  initialTon: null,
  remainingTon: null,
  inspectionResult: null,
  ...over,
});

const slabSpec = { itemId: 5, itemCode: 'SL-1', itemName: '슬래브', steelGradeCode: 'SS275' };
const heat = lot(10, 'HT-001', 'HEAT', { steelGradeCode: 'SS275', inspectionResult: 'PASS', lotStatus: 'CONSUMED' });
const failedHeat = lot(20, 'HT-002', 'HEAT', { inspectionResult: 'FAIL', lotStatus: 'CONSUMED' });
const slabPass = lot(11, 'HT-001-01', 'SLAB', { ...slabSpec, inspectionResult: 'PASS', yardName: '슬래브 1야드' });
const slabShipped = lot(12, 'HT-001-02', 'SLAB', { ...slabSpec, inspectionResult: 'PASS', lotStatus: 'SHIPPED', producedDate: '2026-10-05' });
const slabHeatFailed = lot(21, 'HT-002-01', 'SLAB', { ...slabSpec, inspectionResult: 'PASS' });
const slabFailed = lot(22, 'HT-002-02', 'SLAB', { ...slabSpec, inspectionResult: 'FAIL' });
const slabPending = lot(23, 'HT-002-03', 'SLAB', { ...slabSpec });
const ore1 = lot(1, 'RM-ORE01-1', 'RAW_MATERIAL', { itemId: 1, itemCode: 'ORE01', itemName: '철광석', producedDate: null, initialTon: '1500.000', remainingTon: '0.000', lotStatus: 'CONSUMED', yardName: '원료 1야드' });
const ore2 = lot(2, 'RM-ORE01-2', 'RAW_MATERIAL', { itemId: 1, itemCode: 'ORE01', itemName: '철광석', producedDate: null, initialTon: '1500.000', remainingTon: '1200.000' });

const detail = (summary: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  ...summary,
  steelGradeName: null,
  rawMaterialType: null,
  goodsReceiptNo: null,
  blastFurnaceCode: null,
  converterCode: null,
  heat: null,
  isEligible: null,
  disposition: null,
  inspection: null,
  allocations: [],
  parents: [],
  children: [],
  shipments: [],
  ...over,
});

const details: Record<string, unknown> = {
  '/lots/10': detail(heat),
  '/lots/20': detail(failedHeat),
  '/lots/11': detail(slabPass, { heat: { id: 10, lotNo: 'HT-001' }, allocations: [{ id: 1, allocationPurpose: 'SHIPMENT', allocationStatus: 'CONFIRMED', shipmentRequest: { id: 1, shipmentRequestNo: 'DR-1' }, productionPlan: null }] }),
  '/lots/12': detail(slabShipped, { heat: { id: 10, lotNo: 'HT-001' }, allocations: [{ id: 2, allocationPurpose: 'SHIPMENT', allocationStatus: 'CONSUMED', shipmentRequest: { id: 1, shipmentRequestNo: 'DR-1' }, productionPlan: null }] }),
  '/lots/21': detail(slabHeatFailed, { heat: { id: 20, lotNo: 'HT-002' }, disposition: { dispositionStatus: 'HOLD', dispositionReason: null } }),
  '/lots/22': detail(slabFailed, { heat: { id: 20, lotNo: 'HT-002' } }),
  '/lots/23': detail(slabPending, { heat: { id: 10, lotNo: 'HT-001' } }),
  '/lots/1': detail(ore1, { rawMaterialType: 'IRON_ORE' }),
  '/lots/2': detail(ore2, { rawMaterialType: 'IRON_ORE' }),
};

const allLots = [heat, failedHeat, slabPass, slabShipped, slabHeatFailed, slabFailed, slabPending, ore1, ore2];

/** GET /lots: lotType·lotStatus·itemId 필터 */
function listLots(call: ServerCall) {
  const rows = allLots.filter(
    (l) => (!call.query.lotType || l.lotType === call.query.lotType) && (!call.query.lotStatus || l.lotStatus === call.query.lotStatus) && (!call.query.itemId || String(l.itemId) === call.query.itemId),
  );
  return ok(page(rows));
}

const overview = {
  products: [{ ...slabSpec, itemType: 'SLAB', onHandQty: 1, reservedQty: 1, rollingAllocatedQty: 0, availableQty: 0, onHandTon: '23.550', availableTon: '0.000', unallocatedPassedQty: 0 }],
  rawMaterials: [{ itemId: 1, itemCode: 'ORE01', itemName: '철광석', remainingTon: '1200.000', lotCount: 1 }],
  surplus: [
    {
      ...slabSpec,
      theoreticalWeightTon: '23.550',
      unallocatedPassedQty: 3,
      reservedQty: 1,
      availableQty: 2,
      surplusQty: 2,
      lots: [
        { lotId: 31, lotNo: 'HT-003-01', producedDate: '2026-10-01', heatNo: 'HT-003', yardName: '슬래브 1야드', productionPlanId: 7, productionPlanNo: 'PP-2610-0007' },
        { lotId: 32, lotNo: 'HT-003-02', producedDate: null, heatNo: null, yardName: null, productionPlanId: null, productionPlanNo: null },
      ],
    },
  ],
};

const receipts = [
  { id: 1, goodsReceiptNo: 'GR-2610-0001', lotId: 1, receivedDate: '2026-09-30' },
  { id: 2, goodsReceiptNo: 'GR-2610-0002', lotId: 2, receivedDate: '2026-10-04' },
];
const purchaseOrders = [
  { id: 1, purchaseOrderStatus: 'PARTIALLY_RECEIVED', items: [{ itemId: 1, remainingTon: '300.000' }] },
  { id: 2, purchaseOrderStatus: 'CONFIRMED', items: [{ itemId: 1, remainingTon: '200.000' }, { itemId: 2, remainingTon: '50.000' }] },
  { id: 3, purchaseOrderStatus: 'RECEIVED', items: [{ itemId: 1, remainingTon: '0.000' }] },
];

function respond(call: ServerCall, over: Partial<Record<string, () => Response>> = {}) {
  const custom = over[call.path];
  if (custom) return custom();
  if (call.path === '/inventories') return ok(overview);
  if (call.path === '/lots') return listLots(call);
  if (call.path in details) return ok(details[call.path]);
  if (call.path === '/items') return ok([{ id: 5, itemCode: 'SL-1', thicknessMm: '250.00', widthMm: '1200.00', lengthMm: '10000.00', theoreticalWeightTon: '23.550' }]);
  if (call.path === '/goods-receipts') return ok(page(receipts));
  if (call.path === '/purchase-orders') return ok(page(purchaseOrders));
  return undefined;
}

const denied = () => fail(403, 'COM-002', '권한이 없습니다');

afterEach(() => stopFakeServer());

describe('재고 서버 어댑터 (api/server/inventories.ts)', () => {
  it('제품: 합격 = 서버 onHandQty, 재고 매수 = AVAILABLE LOT 수, 불합격 = 자기 검사 불합격, 판정 대기 = 나머지', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.productionHead, (c) => respond(c));
    const [row] = await inventoryApi.listProducts();
    expect(calls.find((c) => c.path === '/lots')?.query).toMatchObject({ lotStatus: 'AVAILABLE' });
    // AVAILABLE 슬래브 4매: 합격 1 · 불합격 1 · 나머지 2(판정 대기 1 + 상위 히트 불합격 1)
    expect(row).toMatchObject({ itemCode: 'SL-1', itemType: 'SLAB', onHandQty: 4, passedQty: 1, failedQty: 1, pendingQty: 2, reservedQty: 1, hotRollingAllocatedQty: 0, availableQty: 0 });
    expect(row).toMatchObject({ theoreticalWeightTon: '23.550', onHandTon: '94.200', passedTon: '23.550', reservedTon: '23.550', availableTon: '0.000', thicknessMm: '250.00', qtyUnit: '매', defaultYardName: null });
  });

  it('제품: 규격 목록 권한이 없으면(물류) 이론중량을 합격 톤 ÷ 합격 매수로 구하고 치수는 비운다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.logistics, (c) => respond(c, { '/items': denied }));
    const [row] = await inventoryApi.listProducts();
    expect(row).toMatchObject({ theoreticalWeightTon: '23.550', onHandTon: '94.200', thicknessMm: null, widthMm: null, lengthMm: null });
  });

  it('LOT 목록: 제품·히트는 상세로 히트 번호·히트 불합격·배정·불합격 처리를 채우고, 원료 날짜는 입고일, 순서는 최근 생산 → 번호', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.logistics, (c) => respond(c));
    const rows = await inventoryApi.listLots();
    const byNo = new Map(rows.map((r) => [r.lotNo, r]));
    expect(byNo.get('HT-001-01')).toMatchObject({ heatNo: 'HT-001', inspectionResult: 'PASS', quality: 'ELIGIBLE', allocationPurpose: 'SHIPMENT', allocationStatus: 'CONFIRMED', yardName: '슬래브 1야드', isSurplus: false, productionPlanId: null });
    expect(byNo.get('HT-001-02')).toMatchObject({ quality: 'NOT_AVAILABLE', inspectionResult: 'PASS', allocationStatus: 'CONSUMED' });
    expect(byNo.get('HT-002-01')).toMatchObject({ inspectionResult: 'HEAT_FAILED', quality: 'HEAT_FAILED', dispositionStatus: 'HOLD' });
    expect(byNo.get('HT-002-02')).toMatchObject({ inspectionResult: 'FAIL', quality: 'FAILED' });
    expect(byNo.get('HT-002-03')).toMatchObject({ inspectionResult: 'PENDING', quality: 'PENDING' });
    expect(byNo.get('HT-002')).toMatchObject({ inspectionResult: 'FAIL', quality: 'FAIL', heatNo: null, allocationPurpose: null });
    expect(byNo.get('RM-ORE01-2')).toMatchObject({ producedDate: '2026-10-04', inspectionResult: null, quality: null });
    expect(rows.map((r) => r.lotNo)).toEqual(['HT-001', 'HT-001-01', 'HT-002', 'HT-002-01', 'HT-002-02', 'HT-002-03', 'HT-001-02', 'RM-ORE01-2', 'RM-ORE01-1']);
    // 원료 LOT은 상세를 읽지 않는다
    expect(calls.some((c) => c.path === '/lots/1' || c.path === '/lots/2')).toBe(false);
  });

  it('LOT 목록 필터: 서버 쿼리로 넘기고, 목록에 없는 상위 히트 판정은 히트 상세에서 읽는다. 원료가 아니면 입고 목록을 읽지 않는다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.productionHead, (c) => respond(c));
    const rows = await inventoryApi.listLots({ lotType: 'SLAB', lotStatus: 'AVAILABLE', itemId: 5 });
    expect(calls.find((c) => c.path === '/lots')?.query).toMatchObject({ lotType: 'SLAB', lotStatus: 'AVAILABLE', itemId: '5' });
    expect(rows.map((r) => [r.lotNo, r.inspectionResult])).toEqual([
      ['HT-001-01', 'PASS'],
      ['HT-002-01', 'HEAT_FAILED'],
      ['HT-002-02', 'FAIL'],
      ['HT-002-03', 'PENDING'],
    ]);
    expect(calls.filter((c) => c.path === '/lots/20')).toHaveLength(1);
    expect(calls.some((c) => c.path === '/goods-receipts')).toBe(false);
  });

  it('원료: 잔량·LOT 수는 서버 합계, LOT은 입고일 순, 원료 종류는 LOT 상세, 입고예정은 입고 전 발주의 미입고량 합계', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.purchase, (c) => respond(c));
    const [row] = await inventoryApi.listRawMaterials();
    expect(row).toMatchObject({ itemCode: 'ORE01', rawMaterialType: 'IRON_ORE', remainingTon: '1200.000', availableLotCount: 1, scheduledReceiptTon: '500.000', defaultYardName: null });
    expect(row.lots).toEqual([
      { lotId: 1, lotNo: 'RM-ORE01-1', receiptDate: '2026-09-30', initialTon: '1500.000', remainingTon: '0.000', lotStatus: 'CONSUMED', supplierName: null, goodsReceiptNo: 'GR-2610-0001', yardName: '원료 1야드' },
      { lotId: 2, lotNo: 'RM-ORE01-2', receiptDate: '2026-10-04', initialTon: '1500.000', remainingTon: '1200.000', lotStatus: 'AVAILABLE', supplierName: null, goodsReceiptNo: 'GR-2610-0002', yardName: null },
    ]);
  });

  it('원료: 입고·발주 목록 권한이 없으면(생산) 입고일·입고 번호는 비우고 입고예정은 0', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.productionHead, (c) => respond(c, { '/goods-receipts': denied, '/purchase-orders': denied }));
    const [row] = await inventoryApi.listRawMaterials();
    expect(row.scheduledReceiptTon).toBe('0.000');
    expect(row.lots.map((l) => [l.lotNo, l.receiptDate, l.goodsReceiptNo])).toEqual([
      ['RM-ORE01-1', '', null],
      ['RM-ORE01-2', '', null],
    ]);
  });

  it('여재: 서버 재고 응답의 surplus를 그대로 쓰고 톤은 매수 × 이론중량, 여재 전환 시각은 비운다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.productionHead, (c) => respond(c));
    const [row] = await inventoryApi.listSurplus();
    expect(row).toMatchObject({ itemCode: 'SL-1', unallocatedPassedQty: 3, unallocatedPassedTon: '70.650', reservedQty: 1, availableTon: '47.100', surplusQty: 2, surplusTon: '47.100' });
    expect(row.lots).toEqual([
      { lotId: 31, lotNo: 'HT-003-01', producedDate: '2026-10-01', surplusAt: null, heatNo: 'HT-003', yardName: '슬래브 1야드', productionPlanId: 7, productionPlanNo: 'PP-2610-0007' },
      { lotId: 32, lotNo: 'HT-003-02', producedDate: '', surplusAt: null, heatNo: null, yardName: null, productionPlanId: null, productionPlanNo: null },
    ]);
    expect(calls.map((c) => c.path)).toEqual(['/inventories']);
  });
});
