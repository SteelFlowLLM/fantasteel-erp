// 기준정보 서버 어댑터 (변경): 화면 입력을 서버 요청(API-166~188)으로 바꾸고, 서버에 없는 삭제는 입력칸 오류로 막는지 본다.
import type { RoutingView } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { InputError } from '@/api/errors';
import { masterDataApi } from '@/api/masterData';
import { ok, stopFakeServer, useFakeServer } from '@/api/server/serverTestKit';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

const routings: RoutingView[] = [
  { id: 1, itemType: 'SLAB', processType: 'IRONMAKING', sequenceNo: 1, plannedYieldRate: null },
  { id: 2, itemType: 'SLAB', processType: 'STEELMAKING', sequenceNo: 2, plannedYieldRate: '0.9000' },
];

afterEach(() => stopFakeServer());

describe('기준정보 서버 어댑터 변경 (api/server/masterData.ts)', () => {
  it('제품 규격 등록·수정은 강종·치수·기본 야드만 보내고 서버 id를 돌려준다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, (c) => (c.path.startsWith('/items') ? ok({ id: 77 }) : undefined));
    const spec = { steelGradeId: 11, thicknessMm: ' 250 ', widthMm: '1200', lengthMm: '10000', defaultYardId: 22 };
    expect(await masterDataApi.createProductSpec({ itemType: 'SLAB', ...spec })).toBe(77);
    await masterDataApi.updateProductSpec({ id: 77, ...spec, expectedUpdatedAt: '' });
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['POST', '/items', { itemType: 'SLAB', steelGradeId: 11, thicknessMm: '250', widthMm: '1200', lengthMm: '10000', defaultYardId: 22 }],
      ['PATCH', '/items/77', { steelGradeId: 11, thicknessMm: '250', widthMm: '1200', lengthMm: '10000', defaultYardId: 22 }],
    ]);
  });

  it('강종 등록은 적용 규격 번호가 비면 서버에 보내지 않는다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, () => ok({ id: 1 }));
    await expect(masterDataApi.createSteelGrade({ steelGradeCode: 'SM355C', steelGradeName: 'C', standardNo: ' ' })).rejects.toBeInstanceOf(InputError);
    expect(calls).toEqual([]);
  });

  it('라우팅 저장: 바뀐 수율은 PATCH, 새 공정은 맨 뒤 순서로 POST, 공정 빼기는 막는다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, (c) => (c.path === '/routings' && c.method === 'GET' ? ok(routings) : ok({ id: 9 })));
    await masterDataApi.saveRouting({
      itemType: 'SLAB',
      steps: [
        { processType: 'IRONMAKING', plannedYieldRate: null },
        { processType: 'STEELMAKING', plannedYieldRate: '0.92' },
        { processType: 'CONTINUOUS_CASTING', plannedYieldRate: '0.98' },
      ],
    });
    expect(calls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.path, c.body])).toEqual([
      ['PATCH', '/routings/2', { plannedYieldRate: '0.92' }],
      ['POST', '/routings', { itemType: 'SLAB', processType: 'CONTINUOUS_CASTING', sequenceNo: 3, plannedYieldRate: '0.98' }],
    ]);
    await expect(masterDataApi.saveRouting({ itemType: 'SLAB', steps: [{ processType: 'STEELMAKING', plannedYieldRate: '0.9' }] })).rejects.toBeInstanceOf(InputError);
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
});
