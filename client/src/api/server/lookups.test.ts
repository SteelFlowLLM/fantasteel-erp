// 서버 모드 선택 목록(api/server/lookups.ts)과 규격 표시값(api/server/masterIds.ts): 화면 id는 서버 id 그대로, 서버에서 새로 만든 고객사·규격도 고를 수 있다.
// 출하요청 등록 창의 고객사·품목도 서버 id로 고르고 보낸다 (api/server/shipmentRequests.ts).
import { afterEach, describe, expect, it } from 'vitest';
import { lookupApi } from '@/api/lookups';
import { itemInfoReader } from '@/api/server/masterIds';
import { fail, ok, stopFakeServer, useFakeServer, type ServerCall } from '@/api/server/serverTestKit';
import { shipmentRequestApi } from '@/api/shipmentRequests';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

afterEach(() => stopFakeServer());

const denied = () => fail(403, 'COM-002', '권한이 없어요');

/** 서버 기준정보: 시드에 없는 고객사(C-NEW)·규격(SL-SM355C-…)이 섞여 있다 */
const customers = [
  { id: 52, customerCode: 'C-NEW', customerName: '새고객' },
  { id: 51, customerCode: 'C-001', customerName: '한빛조선' },
];
const yards = [{ id: 7, yardCode: 'Y-S1', yardName: '슬래브 1야드', yardType: 'SLAB' }];
const slabNew = {
  id: 301,
  itemCode: 'SL-SM355C-250x1500x10000',
  itemName: 'SM355C 슬래브',
  itemType: 'SLAB',
  unitType: 'QTY',
  rawMaterialType: null,
  steelGradeId: 9,
  steelGradeCode: 'SM355C',
  thicknessMm: '250.00',
  widthMm: '1500.00',
  lengthMm: '10000.00',
  theoreticalWeightTon: '29.438',
  defaultYardId: 7,
  defaultSupplierId: null,
};
const coilNew = { ...slabNew, id: 302, itemCode: 'CL-SM355C-8x1500x300000', itemName: 'SM355C 코일', itemType: 'COIL', thicknessMm: '8.00', lengthMm: '300000.00', theoreticalWeightTon: '28.260' };
const mapping = {
  id: 40,
  steelGradeId: 9,
  steelGradeCode: 'SM355C',
  slabItem: { id: 301, itemCode: slabNew.itemCode, thicknessMm: '250.00', widthMm: '1500.00', lengthMm: '10000.00', theoreticalWeightTon: '29.438' },
  coilItem: { id: 302, itemCode: coilNew.itemCode, thicknessMm: '8.00', widthMm: '1500.00', lengthMm: '300000.00', theoreticalWeightTon: '28.260' },
  hotRollingYieldRate: '0.9600',
};

function master(c: ServerCall): Response | undefined {
  if (c.path === '/customers') return ok(customers);
  if (c.path === '/items') return ok([slabNew, coilNew].filter((i) => !c.query.itemType || i.itemType === c.query.itemType));
  if (c.path === '/yards') return ok(yards);
  if (c.path === '/suppliers') return ok([]);
  if (c.path === '/spec-mappings') return ok([mapping]);
  if (c.path === '/steel-grades') return ok([{ id: 9, steelGradeCode: 'SM355C', steelGradeName: 'SM355C', standardNo: 'KS D 3515:2018' }]);
  return undefined;
}

describe('선택 목록 서버 모드 (api/server/lookups.ts)', () => {
  it('고객사·강종은 서버 목록 그대로(서버 id), 고객사는 코드 순', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.sales, master);
    expect(await lookupApi.listCustomers()).toEqual([
      { id: 51, customerCode: 'C-001', customerName: '한빛조선' },
      { id: 52, customerCode: 'C-NEW', customerName: '새고객' },
    ]);
    expect(await lookupApi.listSteelGrades()).toEqual([{ id: 9, steelGradeCode: 'SM355C', steelGradeName: 'SM355C', standardNo: 'KS D 3515:2018' }]);
  });

  it('제품 규격: 서버에서 새로 만든 규격이 서버 id로 보이고, 매핑 상대 규격·열연 수율·기본 야드 이름을 채운다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.sales, master);
    const specs = await lookupApi.listProductSpecs({ itemType: 'SLAB' });
    expect(specs).toEqual([
      expect.objectContaining({ id: 301, itemCode: 'SL-SM355C-250x1500x10000', steelGradeId: 9, defaultYardName: '슬래브 1야드', mappedItemId: 302, mappedItemCode: coilNew.itemCode, hotRollingPlannedYieldRate: '0.9600' }),
    ]);
    expect(calls.find((c) => c.path === '/items')?.query).toEqual({ itemType: 'SLAB' });
  });

  it('기준정보 조회 권한이 없으면(물류) 빈 목록이고 숫자를 만들지 않는다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.logistics, denied);
    expect(await lookupApi.listCustomers()).toEqual([]);
    expect(await lookupApi.listProductSpecs()).toEqual([]);
    expect(await lookupApi.getProductionSetting()).toBeNull();
  });
});

describe('규격 표시값 (api/server/masterIds.ts itemInfoReader)', () => {
  it('서버 규격 목록을 먼저 보고(서버 야드 id), 권한이 없으면 시드의 같은 코드로 이름만 채운다(야드 id 없음)', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.sales, master);
    expect((await itemInfoReader())(slabNew.itemCode)).toEqual({ itemType: 'SLAB', itemName: 'SM355C 슬래브', theoreticalWeightTon: '29.438', steelGradeCode: 'SM355C', yardId: 7, yardName: '슬래브 1야드' });
    stopFakeServer();

    useFakeServer(SEED_EMPLOYEE_NO.logistics, denied);
    const info = await itemInfoReader();
    expect(info('SL-SS275-250x1200x10000')).toMatchObject({ itemType: 'SLAB', steelGradeCode: 'SS275', yardId: null });
    expect(info(slabNew.itemCode)).toBeUndefined();
  });
});

describe('출하요청 등록 창 서버 모드: 고객사·품목 id는 서버 id', () => {
  const shippable = [
    { salesOrderId: 9, salesOrderNo: 'SO-2610-0009', salesOrderItemId: 72, customerId: 52, customerName: '새고객', itemId: 301, itemCode: slabNew.itemCode, itemName: slabNew.itemName, itemType: 'SLAB', orderedQty: 5, dueDate: '2026-11-30', activeReservedQty: 5, pendingRequestQty: 0, shippableQty: 5 },
  ];
  const salesOrder = { items: [{ salesOrderItemId: 72, orderedQty: 5, shippedQty: 0, dueDate: '2026-11-30', salesOrderItemStatus: 'OPEN' }] };
  const respond = (c: ServerCall) => (c.path === '/shipment-requests/shippable' ? ok(shippable) : c.path === '/sales-orders/9' ? ok(salesOrder) : master(c));

  it('고객사는 서버 고객사 전부(코드 순)이고, 서버에서 새로 만든 고객사의 품목도 서버 id로 고른다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.sales, respond);
    expect((await shipmentRequestApi.shippableCustomers()).map((c) => [c.customerId, c.customerCode, c.itemCount])).toEqual([
      [51, 'C-001', 0],
      [52, 'C-NEW', 1],
    ]);
    expect(await shipmentRequestApi.shippableItems(52)).toEqual([
      expect.objectContaining({ salesOrderItemId: 72, itemId: 301, theoreticalWeightTon: '29.438', steelGradeCode: 'SM355C', lineNo: 1 }),
    ]);
  });

  it('고객사 목록 권한이 없으면 출하 가능 품목이 있는 고객사만 보인다 (코드는 비운다)', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.logistics, (c) => (c.path === '/customers' ? denied() : respond(c)));
    expect((await shipmentRequestApi.shippableCustomers()).map((c) => [c.customerId, c.customerCode, c.customerName])).toEqual([[52, '', '새고객']]);
  });

  it('등록은 고른 서버 고객사 id를 그대로 보낸다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.sales, (c) =>
      c.method === 'POST' && c.path === '/shipment-requests' ? ok({ id: 80, shipmentRequestNo: 'DR-2610-0080', items: [] }) : respond(c),
    );
    await shipmentRequestApi.create({ customerId: 52, requestedShipDate: '2026-11-20', items: [{ salesOrderItemId: 72, requestQty: '2' }] });
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ customerId: 52, shipDate: '2026-11-20', items: [{ salesOrderItemId: 72, requestQty: 2 }] });
    expect(calls.some((c) => c.path === '/customers' || c.path === '/shipment-requests/shippable')).toBe(false);
  });
});
