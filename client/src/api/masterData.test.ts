import { describe, expect, it } from 'vitest';
import { ApiError, InputError } from '@/api/client';
import { masterDataApi } from '@/api/masterData';
import { getMockDb } from '@/mock/db';
import type { MockTables } from '@/mock/schema';
import { insertRow } from '@/mock/store';
import { actAs, SEED_EMPLOYEE_NO } from '@/test/actors';

const readDb = <T,>(reader: (tables: Readonly<MockTables>) => T): T => getMockDb().read(reader);

const findGradeId = (code: string) => {
  const grade = getMockDb().read((t) => t.steelGrade.find((g) => g.steelGradeCode === code));
  if (!grade) throw new Error(code);
  return grade.id;
};
const findYardId = (type: 'RAW_MATERIAL' | 'SLAB' | 'COIL') => {
  const yard = getMockDb().read((t) => t.yard.find((y) => y.yardType === type));
  if (!yard) throw new Error(type);
  return yard.id;
};
const findItem = (code: string) => {
  const item = getMockDb().read((t) => t.item.find((i) => i.itemCode === code));
  if (!item) throw new Error(code);
  return item;
};

/** 규격을 '쓰인' 상태로 만든다 (LOT 1개) */
function markUsed(itemId: number): void {
  getMockDb().transact((tx) => {
    const item = tx.tables.item.find((i) => i.id === itemId);
    insertRow(tx, 'lot', {
      lotNo: `TEST-LOT-${itemId}`,
      lotType: item?.itemType === 'COIL' ? 'COIL' : 'SLAB',
      lotStatus: 'AVAILABLE',
      itemId,
      steelGradeId: item?.steelGradeId ?? null,
      heatLotId: null,
      initialTon: null,
      remainingTon: null,
      blastFurnaceCode: null,
      converterCode: null,
      yardId: item?.defaultYardId ?? null,
      goodsReceiptId: null,
      productionResultId: null,
      productionPlanId: null,
      isPassed: true,
      dispositionStatus: null,
      dispositionReason: null,
      dispositionAt: null,
      surplusAt: null,
      producedDate: '2026-09-20',
      consumedAt: null,
      shippedAt: null,
    });
  });
}

async function catchError(promise: Promise<unknown>): Promise<ApiError | InputError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError || error instanceof InputError) return error;
    throw error;
  }
  throw new Error('오류가 나지 않았어요');
}

const buildSlabInput = () => ({ itemType: 'SLAB' as const, steelGradeId: findGradeId('SM355C'), thicknessMm: '250', widthMm: '1200', lengthMm: '10000', defaultYardId: findYardId('SLAB') });

describe('제품 규격 (REQ-MST-003)', () => {
  it('관리자가 규격을 추가하면 규격 코드·1매 이론중량을 계산해 저장한다', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const id = await masterDataApi.createProductSpec(buildSlabInput());
    const row = readDb((t) => t.item.find((i) => i.id === id));
    expect(row).toMatchObject({ itemCode: 'SL-SM355C-250x1200x10000', unitType: 'QTY', theoreticalWeightTon: '23.550', thicknessMm: '250.00', defaultSupplierId: null });
  });

  it('기준정보 관리 사용 권한이 없으면 COM-002, 같은 조합은 InputError', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    expect(await catchError(masterDataApi.createProductSpec(buildSlabInput()))).toMatchObject({ code: 'COM-002' });

    actAs(SEED_EMPLOYEE_NO.admin);
    const duplicate = await catchError(masterDataApi.createProductSpec({ ...buildSlabInput(), steelGradeId: findGradeId('SS275'), thicknessMm: '250.00' }));
    expect(duplicate).toBeInstanceOf(InputError);
    expect((duplicate as InputError).fieldErrors.thicknessMm).toContain('SL-SS275-250x1200x10000');
  });

  it('기본 야드는 품목 유형에 맞는 야드만, 없는 강종은 COM-003', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const wrongYard = await catchError(masterDataApi.createProductSpec({ ...buildSlabInput(), defaultYardId: findYardId('COIL') }));
    expect((wrongYard as InputError).fieldErrors.defaultYardId).toBe('슬래브 야드만 기본 야드로 고를 수 있어요');
    expect(await catchError(masterDataApi.createProductSpec({ ...buildSlabInput(), steelGradeId: 9999 }))).toMatchObject({ code: 'COM-003' });
  });

  it('쓰이지 않은 규격은 치수를 고칠 수 있고, 쓰인 규격은 MST-002 (기본 야드만 바꿀 수 있음)', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const id = await masterDataApi.createProductSpec(buildSlabInput());
    await masterDataApi.updateProductSpec({ id, steelGradeId: findGradeId('SM355C'), thicknessMm: '230', widthMm: '1200', lengthMm: '10000', defaultYardId: findYardId('SLAB') });
    expect(readDb((t) => t.item.find((i) => i.id === id))).toMatchObject({ itemCode: 'SL-SM355C-230x1200x10000', theoreticalWeightTon: '21.666' });

    markUsed(id);
    const blocked = await catchError(masterDataApi.updateProductSpec({ id, steelGradeId: findGradeId('SM355C'), thicknessMm: '240', widthMm: '1200', lengthMm: '10000', defaultYardId: findYardId('SLAB') }));
    expect(blocked).toMatchObject({ code: 'MST-002', message: '사용된 규격은 치수·이론중량을 수정할 수 없습니다' });
    await expect(
      masterDataApi.updateProductSpec({ id, steelGradeId: findGradeId('SM355C'), thicknessMm: '230.00', widthMm: '1200', lengthMm: '10000', defaultYardId: findYardId('SLAB') }),
    ).resolves.toBe(id);
  });

  it('화면을 연 뒤 다른 곳에서 바뀌었으면 COM-001', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const id = await masterDataApi.createProductSpec(buildSlabInput());
    const stale = await catchError(
      masterDataApi.updateProductSpec({ id, expectedUpdatedAt: '2020-01-01T00:00:00.000Z', steelGradeId: findGradeId('SM355C'), thicknessMm: '250', widthMm: '1200', lengthMm: '10000', defaultYardId: findYardId('SLAB') }),
    );
    expect(stale).toMatchObject({ code: 'COM-001' });
  });

  it('매핑이 있거나 쓰인 규격은 지울 수 없고, 쓰이지 않은 규격은 지운다', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const mapped = await catchError(masterDataApi.deleteProductSpec(findItem('SL-SS275-250x1200x10000').id));
    expect(mapped).toBeInstanceOf(InputError);
    expect(mapped.message).toContain('규격 매핑 1건');
    const id = await masterDataApi.createProductSpec(buildSlabInput());
    await masterDataApi.deleteProductSpec(id);
    expect(readDb((t) => t.item.some((i) => i.id === id))).toBe(false);
  });
});

describe('규격 매핑 (REQ-MST-004)', () => {
  it('같은 강종 슬래브 → 코일을 1:1로 매핑하고, 열연 계획 수율을 계산해 보여 준다', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const slab = await masterDataApi.createProductSpec(buildSlabInput());
    const coil = await masterDataApi.createProductSpec({ itemType: 'COIL', steelGradeId: findGradeId('SM355C'), thicknessMm: '2.3', widthMm: '1200', lengthMm: '1065000', defaultYardId: findYardId('COIL') });
    const id = await masterDataApi.createSpecMapping({ slabItemId: slab, coilItemId: coil });
    const view = (await masterDataApi.listSpecMappings()).find((m) => m.id === id);
    expect(view).toMatchObject({ steelGradeCode: 'SM355C', hotRollingPlannedYieldRate: '0.9798', isUsed: false });

    const again = await catchError(masterDataApi.createSpecMapping({ slabItemId: slab, coilItemId: coil }));
    expect(again.message).toBe('이미 대응 코일이 있는 슬래브 규격이에요');
  });

  it('코일이 슬래브보다 무겁거나 강종이 다르면 거부한다', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const slab = await masterDataApi.createProductSpec(buildSlabInput());
    const heavy = await masterDataApi.createProductSpec({ itemType: 'COIL', steelGradeId: findGradeId('SM355C'), thicknessMm: '2.3', widthMm: '1200', lengthMm: '1100000', defaultYardId: findYardId('COIL') });
    const tooHeavy = await catchError(masterDataApi.createSpecMapping({ slabItemId: slab, coilItemId: heavy }));
    expect((tooHeavy as InputError).fieldErrors.coilItemId).toContain('보다 커서 매핑할 수 없어요');
    const otherGrade = await catchError(masterDataApi.createSpecMapping({ slabItemId: slab, coilItemId: findItem('CL-SS275-2.3x1200x1065000').id }));
    expect(otherGrade.message).toBe('강종이 다른 규격은 매핑할 수 없어요');
  });

  it('쓰인 규격의 매핑은 지울 수 없다', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const mapping = (await masterDataApi.listSpecMappings())[0];
    markUsed(mapping.coil.id);
    expect((await catchError(masterDataApi.deleteSpecMapping(mapping.id))).message).toBe('수주·재고·LOT에 쓰인 규격의 매핑은 삭제할 수 없어요');
  });
});

describe('라우팅 (REQ-MST-005)', () => {
  it('공정 순서를 바꾸고 계획 수율을 저장한다. 열연·제선 수율은 저장하지 않는다', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    await masterDataApi.saveRouting({
      itemType: 'COIL',
      steps: [
        { processType: 'IRONMAKING', plannedYieldRate: '0.5' },
        { processType: 'STEELMAKING', plannedYieldRate: '0.92' },
        { processType: 'CONTINUOUS_CASTING', plannedYieldRate: '0.97' },
        { processType: 'HOT_ROLLING', plannedYieldRate: '0.9' },
      ],
    });
    const coil = (await masterDataApi.listRoutings()).find((r) => r.itemType === 'COIL');
    expect(coil?.steps.map((s) => [s.processType, s.processSeq, s.plannedYieldRate])).toEqual([
      ['IRONMAKING', 1, null],
      ['STEELMAKING', 2, '0.9200'],
      ['CONTINUOUS_CASTING', 3, '0.9700'],
      ['HOT_ROLLING', 4, null],
    ]);
  });

  it('수율은 0보다 크고 1 이하, 같은 공정 두 번·슬래브 열연은 거부한다', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const out = await catchError(masterDataApi.saveRouting({ itemType: 'SLAB', steps: [{ processType: 'STEELMAKING', plannedYieldRate: '1.2' }] }));
    expect((out as InputError).fieldErrors['steps.0.plannedYieldRate']).toBe('계획 수율은 1 이하로 입력해 주세요');
    const empty = await catchError(masterDataApi.saveRouting({ itemType: 'SLAB', steps: [{ processType: 'CONTINUOUS_CASTING', plannedYieldRate: '' }] }));
    expect((empty as InputError).fieldErrors['steps.0.plannedYieldRate']).toBe('계획 수율을 입력해 주세요');
    const hot = await catchError(masterDataApi.saveRouting({ itemType: 'SLAB', steps: [{ processType: 'HOT_ROLLING', plannedYieldRate: null }] }));
    expect((hot as InputError).fieldErrors['steps.0.processType']).toBe('슬래브 라우팅에는 열연 공정을 넣을 수 없어요');
  });
});

describe('배합 원단위 (REQ-MST-006)', () => {
  it('바뀐 칸을 한 번에 저장하고, 비운 칸은 지운다', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const ore = findItem('ORE01').id;
    const alloy = findItem('SMN01').id;
    await masterDataApi.saveSpecificConsumptions([
      { itemId: ore, steelGradeId: null, consumptionRate: '1.55' },
      { itemId: alloy, steelGradeId: findGradeId('SM355C'), consumptionRate: '22' },
      { itemId: alloy, steelGradeId: findGradeId('SPHC'), consumptionRate: '' },
    ]);
    const rows = await masterDataApi.listSpecificConsumptions();
    expect(rows.find((r) => r.itemId === ore)?.consumptionRate).toBe('1.550');
    expect(rows.find((r) => r.itemId === alloy && r.steelGradeId === findGradeId('SM355C'))).toMatchObject({ consumptionRate: '22.000', consumptionUnit: 'kg/t' });
    expect(rows.some((r) => r.itemId === alloy && r.steelGradeId === findGradeId('SPHC'))).toBe(false);
  });

  it('하나라도 틀리면 아무것도 저장하지 않는다', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const ore = findItem('ORE01').id;
    const error = await catchError(
      masterDataApi.saveSpecificConsumptions([
        { itemId: ore, steelGradeId: null, consumptionRate: '1.7' },
        { itemId: findItem('COL01').id, steelGradeId: null, consumptionRate: '-1' },
      ]),
    );
    expect(error).toBeInstanceOf(InputError);
    expect((await masterDataApi.listSpecificConsumptions()).find((r) => r.itemId === ore)?.consumptionRate).toBe('1.600');
  });
});

describe('원료·고객사·공급업체·야드 (REQ-MST-001·007·008)', () => {
  it('원료 코드는 영문 3자 + 숫자 2자리, 기본 야드는 원료 야드만', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const bad = await catchError(masterDataApi.createRawMaterial({ itemCode: 'IO', itemName: '철광석2', rawMaterialType: 'IRON_ORE', defaultYardId: findYardId('SLAB'), defaultSupplierId: null }));
    expect((bad as InputError).fieldErrors).toMatchObject({ itemCode: '원료 코드는 영문 대문자 3자 + 숫자 2자리예요 (예: ORE01)', defaultYardId: '원료 야드만 기본 야드로 고를 수 있어요' });
    const id = await masterDataApi.createRawMaterial({ itemCode: 'ore02', itemName: '철광석(펠릿)', rawMaterialType: 'IRON_ORE', defaultYardId: findYardId('RAW_MATERIAL'), defaultSupplierId: null });
    expect(readDb((t) => t.item.find((i) => i.id === id))).toMatchObject({ itemCode: 'ORE02', unitType: 'TON', rawMaterialType: 'IRON_ORE', defaultSupplierId: null });
  });

  it('쓰는 곳이 있으면 삭제를 거부하고, 없으면 지운다', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const supplier = getMockDb().read((t) => t.supplier.find((s) => s.supplierCode === 'SUP-01'));
    expect((await catchError(masterDataApi.deleteSupplier(supplier?.id ?? 0))).message).toContain('원료 기본 공급업체 1건');
    const id = await masterDataApi.createCustomer({ customerCode: 'cus-09', customerName: '테스트 고객사' });
    expect(readDb((t) => t.customer.find((c) => c.id === id)?.customerCode)).toBe('CUS-09');
    await masterDataApi.deleteCustomer(id);
    expect(await catchError(masterDataApi.deleteCustomer(id))).toMatchObject({ code: 'COM-003' });
  });

  it('야드 유형은 만든 뒤 바꾸지 않고, 목록은 실제 야드 유형을 돌려준다', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const id = await masterDataApi.createYard({ yardCode: 'YD-CL-02', yardName: '코일 2야드', yardType: 'COIL' });
    await masterDataApi.updateYard({ id, yardName: '코일 2야드(동)' });
    expect((await masterDataApi.listYards()).find((y) => y.id === id)).toMatchObject({ yardType: 'COIL', yardName: '코일 2야드(동)', referenceText: null });
  });

  it('입력칸 안내 키는 ERD 이름이다 (customerCode·supplierName·yardCode …)', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const customer = await catchError(masterDataApi.createCustomer({ customerCode: 'CUS-01', customerName: '' }));
    expect(Object.keys((customer as InputError).fieldErrors).sort()).toEqual(['customerCode', 'customerName']);
    const supplier = await catchError(masterDataApi.createSupplier({ supplierCode: '', supplierName: '' }));
    expect(Object.keys((supplier as InputError).fieldErrors).sort()).toEqual(['supplierCode', 'supplierName']);
    const yard = await catchError(masterDataApi.createYard({ yardCode: 'YD-CL-01', yardName: '', yardType: null }));
    expect(Object.keys((yard as InputError).fieldErrors).sort()).toEqual(['yardCode', 'yardName', 'yardType']);
    const yardId = findYardId('COIL');
    const rename = await catchError(masterDataApi.updateYard({ id: yardId, yardName: ' ' }));
    expect(Object.keys((rename as InputError).fieldErrors)).toEqual(['yardName']);
  });
});

describe('강종·생산 설정값 (REQ-MST-002·009)', () => {
  it('강종의 성분 규격은 그 강종의 제강 검사 기준만 보인다 (공통 제강 기준으로 대신하지 않음, TRM-020)', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const gradeId = await masterDataApi.createSteelGrade({ steelGradeCode: 'TEST420', steelGradeName: 'TEST420', standardNo: '' });
    // 예전 데이터에 공통 제강 기준이 남아 있어도
    getMockDb().transact((tx) => insertRow(tx, 'inspectionStandard', { inspectionStandardCode: 'QS-COMMON-ST', version: 1, processType: 'STEELMAKING', steelGradeId: null, isCurrent: true }));
    const grades = await masterDataApi.listSteelGrades();
    expect(grades.find((g) => g.id === gradeId)?.steelmakingStandard).toBeNull();
    expect(grades.find((g) => g.steelGradeCode === 'SM355A')?.steelmakingStandard).toMatchObject({ inspectionStandardCode: 'QS-SM355A-ST' });
  });

  it('강종을 추가·수정하고, 쓰는 곳이 있는 강종은 지울 수 없다', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const id = await masterDataApi.createSteelGrade({ steelGradeCode: 'sm420a', steelGradeName: 'SM420A', standardNo: 'KS D 3515:2018' });
    await masterDataApi.updateSteelGrade({ id, steelGradeName: 'SM420A 용접 구조용', standardNo: '' });
    expect(readDb((t) => t.steelGrade.find((g) => g.id === id))).toMatchObject({ steelGradeCode: 'SM420A', standardNo: null });
    expect((await catchError(masterDataApi.deleteSteelGrade(findGradeId('SS275')))).message).toContain('제품 규격 6건');
  });

  it('히트 용량·납기 위험 기준일을 저장한다', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    await masterDataApi.saveProductionSetting({ heatCapacityTon: '260.5', deliveryRiskDays: '5' });
    expect(await masterDataApi.getProductionSetting()).toMatchObject({ heatCapacityTon: '260.500', deliveryRiskDays: 5 });
    const bad = await catchError(masterDataApi.saveProductionSetting({ heatCapacityTon: '0', deliveryRiskDays: '-1' }));
    expect((bad as InputError).fieldErrors).toMatchObject({ heatCapacityTon: '히트 용량은 0보다 커야 해요', deliveryRiskDays: '납기 위험 기준일은 0 이상의 정수로 입력해 주세요' });
    actAs(SEED_EMPLOYEE_NO.quality);
    expect(await catchError(masterDataApi.saveProductionSetting({ heatCapacityTon: '250', deliveryRiskDays: 3 }))).toMatchObject({ code: 'COM-002' });
  });
});

describe('준비 상태 (BP-MST-01, MST-001)', () => {
  it('원료의 기본 공급업체를 비우면 준비 상태에 누락으로 나온다', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const ore = findItem('ORE01');
    await masterDataApi.updateRawMaterial({ id: ore.id, itemName: ore.itemName, defaultYardId: ore.defaultYardId, defaultSupplierId: null });
    const readiness = await masterDataApi.getReadiness();
    expect(readiness.ready).toBe(false);
    expect(readiness.problems.filter((p) => p.area === 'DEFAULT_SUPPLIER').map((p) => p.message)).toEqual(['ORE01 철광석의 기본 공급업체가 없어요']);
  });
});
