// MRP 서버 어댑터: GET mrp/requirements?from&to, 원료 id만 화면 id로 바꾸고 계획 id는 서버 id 그대로, 기간 오류는 서버를 부르기 전에 막는다.
import type { MrpRequirementsView } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { InputError } from '@/api/errors';
import { mrpApi } from '@/api/mrp';
import { ok, stopFakeServer, useFakeServer } from '@/api/server/serverTestKit';
import { getMockDb } from '@/mock/db';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

const mockItemId = (itemCode: string) => getMockDb().read((t) => t.item.find((i) => i.itemCode === itemCode)?.id);

const view: MrpRequirementsView = {
  from: '2026-10-01',
  to: '2026-10-31',
  heatCapacityTon: '250.000',
  plans: [
    {
      productionPlanId: 300,
      productionPlanNo: 'PP-2610-0001',
      productionPlanStatus: 'PLANNED',
      salesOrderNo: 'SO-2610-0001',
      itemCode: 'SL-SM355A-250x1500x10000',
      itemName: 'SM355A 슬래브',
      steelGradeCode: 'SM355A',
      requiredDate: '2026-10-20',
      isBeforePeriod: false,
      remainingHeatCount: 1,
      heatTon: '250.000',
      requiredHotMetalTon: '277.778',
      materials: [{ itemId: 904, itemCode: 'SMN01', requiredTon: '5.000', netRequirementTon: '1.500' }],
    },
  ],
  materials: [
    {
      itemId: 904,
      itemCode: 'SMN01',
      itemName: '실리코망가니즈',
      rawMaterialType: 'FERROALLOY',
      requiredTon: '5.000',
      remainingTon: '3.500',
      scheduledReceiptTon: '0.000',
      usedRemainingTon: '3.500',
      usedScheduledReceiptTon: '0.000',
      netRequirementTon: '1.500',
      firstShortageDate: '2026-10-20',
    },
  ],
  requisitionLines: [{ productionPlanId: 300, productionPlanNo: 'PP-2610-0001', itemId: 904, itemCode: 'SMN01', itemName: '실리코망가니즈', netRequirementTon: '1.500', requiredDate: '2026-10-20', existingPurchaseRequisitionNo: null }],
};

afterEach(() => stopFakeServer());

describe('MRP 서버 어댑터 (api/server/mrp.ts)', () => {
  it('기간을 쿼리로 보내고, 원료 id는 화면 id로 바꾸며 계획 id는 서버 id를 그대로 둔다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, (c) => (c.path === '/mrp/requirements' ? ok(view) : undefined));
    const result = await mrpApi.requirements({ from: '2026-10-01', to: '2026-10-31' });
    const smn = mockItemId('SMN01');

    expect(calls[0].query).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(result.materials[0]).toMatchObject({ itemId: smn, netRequirementTon: '1.500' });
    expect(result.plans[0]).toMatchObject({ productionPlanId: 300, materials: [{ itemId: smn, itemCode: 'SMN01', requiredTon: '5.000', netRequirementTon: '1.500' }] });
    expect(result.requisitionLines[0]).toMatchObject({ productionPlanId: 300, itemId: smn, requiredDate: '2026-10-20' });
  });

  it('기간이 거꾸로면 서버를 부르지 않고 입력 오류', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, () => ok(view));
    const error = await mrpApi.requirements({ from: '2026-10-31', to: '2026-10-01' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InputError);
    expect(calls).toEqual([]);
  });
});
