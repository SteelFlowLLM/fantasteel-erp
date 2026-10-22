// 기준정보 서버 어댑터 (변경): 화면 입력을 서버 요청(API-166~188, 삭제 API-275~279)으로 바꾸는지 본다.
import type { RoutingView } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { InputError } from '@/api/errors';
import { masterDataApi } from '@/api/masterData';
import { fail, ok, stopFakeServer, useFakeServer } from '@/api/server/serverTestKit';
import { errorMessageOf } from '@/stores/useToastStore';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

const routings: RoutingView[] = [
  { id: 1, itemType: 'SLAB', processType: 'IRONMAKING', sequenceNo: 1, plannedYieldRate: null, updatedAt: '2026-10-21T00:00:00.000Z' },
  { id: 2, itemType: 'SLAB', processType: 'STEELMAKING', sequenceNo: 2, plannedYieldRate: '0.9000', updatedAt: '2026-10-21T00:00:01.000Z' },
];
/** 서버 라우팅 응답: 고칠 때마다 새 저장 시각을 돌려준다 */
let savedCount = 0;
const routingServer = (c: { path: string; method: string }) =>
  c.path === '/routings' && c.method === 'GET'
    ? ok(routings)
    : c.method === 'PATCH'
      ? ok({ id: Number(c.path.split('/').at(-1)), updatedAt: `2026-10-22T00:00:0${(savedCount += 1)}.000Z` })
      : ok({ id: 9 });

afterEach(() => stopFakeServer());

describe('기준정보 서버 어댑터 변경 (api/server/masterData.ts)', () => {
  it('제품 규격 등록·수정은 강종·치수·기본 야드만 보내고 서버 id를 돌려준다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, (c) => (c.path.startsWith('/items') ? ok({ id: 77 }) : undefined));
    const spec = { steelGradeId: 11, thicknessMm: ' 250 ', widthMm: '1200', lengthMm: '10000', defaultYardId: 22 };
    expect(await masterDataApi.createProductSpec({ itemType: 'SLAB', ...spec })).toBe(77);
    await masterDataApi.updateProductSpec({ id: 77, ...spec, expectedUpdatedAt: '' });
    await masterDataApi.updateProductSpec({ id: 77, ...spec, expectedUpdatedAt: '2026-10-21T00:00:00.000Z' });
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['POST', '/items', { itemType: 'SLAB', steelGradeId: 11, thicknessMm: '250', widthMm: '1200', lengthMm: '10000', defaultYardId: 22 }],
      ['PATCH', '/items/77', { steelGradeId: 11, thicknessMm: '250', widthMm: '1200', lengthMm: '10000', defaultYardId: 22 }],
      // 폼이 불러온 시각을 보내면 서버가 그 사이 바뀐 것을 막는다 (이슈 #498)
      ['PATCH', '/items/77', { steelGradeId: 11, thicknessMm: '250', widthMm: '1200', lengthMm: '10000', defaultYardId: 22, expectedUpdatedAt: '2026-10-21T00:00:00.000Z' }],
    ]);
  });

  it('강종 등록은 적용 규격 번호가 비면 서버에 보내지 않는다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, () => ok({ id: 1 }));
    await expect(masterDataApi.createSteelGrade({ steelGradeCode: 'SM355C', steelGradeName: 'C', standardNo: ' ' })).rejects.toBeInstanceOf(InputError);
    expect(calls).toEqual([]);
  });

  it('라우팅 저장: 바뀐 수율은 PATCH, 새 공정은 화면 순서 번호로 POST, 공정 빼기는 막는다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, routingServer);
    await masterDataApi.saveRouting({
      itemType: 'SLAB',
      // 폼이 가진 시각 = 이 품목 유형 공정 중 가장 늦은 저장 시각
      expectedUpdatedAt: '2026-10-21T00:00:01.000Z',
      steps: [
        { processType: 'IRONMAKING', plannedYieldRate: null },
        { processType: 'STEELMAKING', plannedYieldRate: '0.92' },
        { processType: 'CONTINUOUS_CASTING', plannedYieldRate: '0.98' },
      ],
    });
    expect(calls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.path, c.body])).toEqual([
      ['PATCH', '/routings/2', { plannedYieldRate: '0.92', expectedUpdatedAt: '2026-10-21T00:00:01.000Z' }],
      ['POST', '/routings', { itemType: 'SLAB', processType: 'CONTINUOUS_CASTING', sequenceNo: 3, plannedYieldRate: '0.98' }],
    ]);
    await expect(masterDataApi.saveRouting({ itemType: 'SLAB', steps: [{ processType: 'STEELMAKING', plannedYieldRate: '0.9' }] })).rejects.toBeInstanceOf(InputError);
  });

  it('라우팅 저장: 폼을 연 뒤 공정이 다른 곳에서 바뀌었으면(COM-001) 아무것도 저장하지 않는다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, routingServer);
    await expect(
      masterDataApi.saveRouting({ itemType: 'SLAB', expectedUpdatedAt: '2026-10-20T00:00:00.000Z', steps: [{ processType: 'IRONMAKING', plannedYieldRate: null }, { processType: 'STEELMAKING', plannedYieldRate: '0.92' }] }),
    ).rejects.toMatchObject({ code: 'COM-001' });
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('라우팅 순서 바꾸기: 옮길 공정을 빈 번호로 비켜 둔 뒤 화면 순서대로 1부터 놓고, 새 공정은 그 자리에 POST', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, routingServer);
    await masterDataApi.saveRouting({
      itemType: 'SLAB',
      steps: [
        { processType: 'STEELMAKING', plannedYieldRate: '0.9' },
        { processType: 'CONTINUOUS_CASTING', plannedYieldRate: '0.98' },
        { processType: 'IRONMAKING', plannedYieldRate: null },
      ],
    });
    expect(calls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.path, c.body])).toEqual([
      ['PATCH', '/routings/2', { sequenceNo: 4, expectedUpdatedAt: '2026-10-21T00:00:01.000Z' }],
      ['PATCH', '/routings/1', { sequenceNo: 5, expectedUpdatedAt: '2026-10-21T00:00:00.000Z' }],
      // 같은 공정을 다시 고칠 때는 방금 서버가 돌려준 새 저장 시각을 보낸다
      ['PATCH', '/routings/2', { sequenceNo: 1, expectedUpdatedAt: expect.stringMatching(/^2026-10-22T00:00:0\d\.000Z$/) }],
      ['POST', '/routings', { itemType: 'SLAB', processType: 'CONTINUOUS_CASTING', sequenceNo: 2, plannedYieldRate: '0.98' }],
      ['PATCH', '/routings/1', { sequenceNo: 3, expectedUpdatedAt: expect.stringMatching(/^2026-10-22T00:00:0\d\.000Z$/) }],
    ]);
  });

  it('원단위 저장: 있는 칸은 PATCH, 없는 칸은 POST, 비운 칸은 입력칸 오류', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, (c) =>
      c.method === 'GET' ? ok([{ id: 5, rawMaterialItemId: 1, rawMaterialItemCode: 'ORE01', rawMaterialType: 'IRON_ORE', steelGradeId: null, steelGradeCode: null, consumptionRate: '1.6000' }]) : ok({ id: 6 }),
    );
    expect(await masterDataApi.saveSpecificConsumptions([{ itemId: 1, steelGradeId: null, consumptionRate: '1.5' }, { itemId: 4, steelGradeId: 12, consumptionRate: '15' }])).toBe(2);
    expect(calls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.path, c.body])).toEqual([
      ['PATCH', '/specific-consumptions/5', { consumptionRate: '1.5' }],
      ['POST', '/specific-consumptions', { rawMaterialItemId: 4, steelGradeId: 12, consumptionRate: '15' }],
    ]);
    const cleared = masterDataApi.saveSpecificConsumptions([{ itemId: 1, steelGradeId: null, consumptionRate: null }]);
    await expect(cleared).rejects.toMatchObject({ fieldErrors: { '1:common': expect.any(String) } });
  });

  it('고객사 수정은 이름만, 생산 설정값은 기준일을 정수로 보낸다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, () => ok({ id: 1 }));
    await masterDataApi.updateCustomer({ id: 41, customerName: '한빛조선(주)', expectedUpdatedAt: '' });
    await masterDataApi.saveProductionSetting({ heatCapacityTon: '260', deliveryRiskDays: '5', expectedUpdatedAt: '' });
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['PATCH', '/customers/41', { customerName: '한빛조선(주)' }],
      ['PATCH', '/production-settings', { heatCapacityTon: '260', deliveryRiskDays: 5 }],
    ]);
  });

  it('불러온 수정 시각은 고객사·공급업체·야드·원료·생산 설정값 수정에도 서버로 보낸다 (동시 수정 방지, 이슈 #498)', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, () => ok({ id: 1 }));
    const expectedUpdatedAt = '2026-10-21T00:00:00.000Z';
    await masterDataApi.updateCustomer({ id: 41, customerName: '한빛조선(주)', expectedUpdatedAt });
    await masterDataApi.updateSupplier({ id: 31, supplierName: '가온광업(주)', expectedUpdatedAt });
    await masterDataApi.updateYard({ id: 21, yardName: '원료 1야드(동)', expectedUpdatedAt });
    await masterDataApi.updateRawMaterial({ id: 1, itemName: '철광석', defaultYardId: 21, defaultSupplierId: 31, expectedUpdatedAt });
    await masterDataApi.saveProductionSetting({ heatCapacityTon: '260', deliveryRiskDays: '5', expectedUpdatedAt });
    expect(calls.map((c) => [c.path, (c.body as { expectedUpdatedAt?: string }).expectedUpdatedAt])).toEqual([
      ['/customers/41', expectedUpdatedAt],
      ['/suppliers/31', expectedUpdatedAt],
      ['/yards/21', expectedUpdatedAt],
      ['/items/1', expectedUpdatedAt],
      ['/production-settings', expectedUpdatedAt],
    ]);
  });

  it('삭제는 DELETE /{기준정보}/:id, 쓰는 곳이 있으면 서버 문구(COM-004 · 쓰는 곳 이름)를 그대로 토스트에 보인다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, (c) => (c.path === '/customers/9' ? fail(400, 'COM-004', '쓰는 곳이 있어 삭제할 수 없어요: 수주') : ok({ id: 1 })));
    await masterDataApi.deleteItem(3);
    await masterDataApi.deleteSteelGrade(4);
    await masterDataApi.deleteSupplier(5);
    await masterDataApi.deleteYard(6);
    const refused = await masterDataApi.deleteCustomer(9).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(InputError);
    expect(errorMessageOf(refused)).toBe('쓰는 곳이 있어 삭제할 수 없어요: 수주');
    expect(calls.map((c) => [c.method, c.path])).toEqual([
      ['DELETE', '/items/3'],
      ['DELETE', '/steel-grades/4'],
      ['DELETE', '/suppliers/5'],
      ['DELETE', '/yards/6'],
      ['DELETE', '/customers/9'],
    ]);
  });
});
