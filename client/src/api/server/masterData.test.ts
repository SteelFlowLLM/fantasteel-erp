// 기준정보 서버 어댑터 (조회): 서버 응답(API-165~187)을 화면 모양으로 바꾸는지 본다.
import type { InspectionStandardListItem, ItemView, RoutingView, SpecMappingView, SteelGradeView, SupplierView, YardView } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { masterDataApi } from '@/api/masterData';
import { fail, ok, page, stopFakeServer, useFakeServer } from '@/api/server/serverTestKit';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

const item = (id: number, itemCode: string, extra: Partial<ItemView>): ItemView => ({
  id,
  itemCode,
  itemName: itemCode,
  itemType: 'SLAB',
  unitType: 'QTY',
  rawMaterialType: null,
  steelGradeId: 11,
  steelGradeCode: 'SS275',
  thicknessMm: '250.00',
  widthMm: '1200.00',
  lengthMm: '10000.00',
  theoreticalWeightTon: '23.550',
  defaultYardId: 22,
  defaultSupplierId: null,
  ...extra,
});
const raw = (id: number, itemCode: string, defaultSupplierId: number | null): ItemView =>
  item(id, itemCode, { itemType: 'RAW_MATERIAL', unitType: 'TON', rawMaterialType: 'IRON_ORE', steelGradeId: null, steelGradeCode: null, thicknessMm: null, widthMm: null, lengthMm: null, theoreticalWeightTon: null, defaultYardId: 21, defaultSupplierId });

const slab = item(101, 'SL-SS275-250x1200x10000', {});
const coil = item(102, 'CL-SS275-2.5x1200x980000', { itemType: 'COIL', thicknessMm: '2.50', lengthMm: '980000.00', theoreticalWeightTon: '23.079', defaultYardId: 23 });
const unmappedSlab = item(103, 'SL-SS275-220x1400x9500', { thicknessMm: '220.00', widthMm: '1400.00', lengthMm: '9500.00', theoreticalWeightTon: '22.966' });
const items: ItemView[] = [raw(1, 'ORE01', 31), raw(2, 'COL01', null), coil, slab, unmappedSlab];
const yards: YardView[] = [
  { id: 21, yardCode: 'YD-RM-01', yardName: '원료 1야드', yardType: 'RAW_MATERIAL' },
  { id: 22, yardCode: 'YD-SL-01', yardName: '슬래브 1야드', yardType: 'SLAB' },
  { id: 23, yardCode: 'YD-CL-01', yardName: '코일 1야드', yardType: 'COIL' },
];
const suppliers: SupplierView[] = [{ id: 31, supplierCode: 'SUP-01', supplierName: '가온광업' }];
const brief = (i: ItemView) => ({ id: i.id, itemCode: i.itemCode, thicknessMm: i.thicknessMm ?? '', widthMm: i.widthMm ?? '', lengthMm: i.lengthMm ?? '', theoreticalWeightTon: i.theoreticalWeightTon ?? '' });
const mappings: SpecMappingView[] = [{ id: 51, steelGradeId: 11, steelGradeCode: 'SS275', slabItem: brief(slab), coilItem: brief(coil), hotRollingYieldRate: '0.9800' }];
const grades: SteelGradeView[] = [
  { id: 11, steelGradeCode: 'SS275', steelGradeName: '일반구조용', standardNo: 'KS D 3503' },
  { id: 12, steelGradeCode: 'SM355C', steelGradeName: '용접구조용 C', standardNo: 'KS D 3515' },
];
const standard = (inspectionStandardId: number, versionNo: number, itemCount: number): InspectionStandardListItem => ({
  inspectionStandardId,
  inspectionStandardCode: 'QS-STL-SS275',
  versionNo,
  processType: 'STEELMAKING',
  steelGradeId: 11,
  steelGradeCode: 'SS275',
  createdAt: '2026-10-01T00:00:00.000Z',
  items: Array.from({ length: itemCount }, () => ({}) as InspectionStandardListItem['items'][number]),
});

const MASTER: Record<string, unknown> = { '/items': items, '/spec-mappings': mappings, '/yards': yards, '/suppliers': suppliers, '/steel-grades': grades };

afterEach(() => stopFakeServer());

describe('기준정보 서버 어댑터 조회 (api/server/masterData.ts)', () => {
  it('제품 규격: 원료를 빼고 대응 규격·열연 수율·기본 야드 이름을 채운다. 사용 여부는 서버가 주지 않아 false', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.admin, (c) => (c.path in MASTER ? ok(MASTER[c.path]) : undefined));
    const specs = await masterDataApi.listProductSpecs();

    expect(specs.map((s) => s.itemCode)).toEqual(['SL-SS275-250x1200x10000', 'SL-SS275-220x1400x9500', 'CL-SS275-2.5x1200x980000']);
    expect(specs[0]).toMatchObject({ defaultYardName: '슬래브 1야드', mappingId: 51, mappedSpec: { id: 102 }, hotRollingPlannedYieldRate: '0.9800', isUsed: false, referenceText: null });
    expect(specs[1]).toMatchObject({ mappingId: null, mappedSpec: null, hotRollingPlannedYieldRate: null });
    expect(specs[2]).toMatchObject({ itemType: 'COIL', mappedSpec: { id: 101 }, defaultYardName: '코일 1야드' });
  });

  it('강종: 규격 수를 세고 제강 검사 기준은 가장 높은 버전을 붙인다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, (c) => {
      if (c.path === '/inspection-standards') return ok(page([standard(1, 1, 5), standard(2, 2, 6)]));
      return c.path in MASTER ? ok(MASTER[c.path]) : undefined;
    });
    const result = await masterDataApi.listSteelGrades();

    expect(calls.find((c) => c.path === '/inspection-standards')?.query).toEqual({ processType: 'STEELMAKING', page: '1', size: '100' });
    expect(result[0]).toMatchObject({ steelGradeCode: 'SS275', specCount: 3, steelmakingStandard: { id: 2, version: 2, itemCount: 6 }, referenceText: null });
    expect(result[1]).toMatchObject({ steelGradeCode: 'SM355C', specCount: 0, steelmakingStandard: null });
  });

  it('강종: 검사 기준 조회 권한이 없으면 성분 규격만 비운다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.admin, (c) => (c.path === '/inspection-standards' ? fail(403, 'COM-002', '해당 업무 권한 없음') : c.path in MASTER ? ok(MASTER[c.path]) : undefined));
    const result = await masterDataApi.listSteelGrades();
    expect(result.map((g) => g.steelmakingStandard)).toEqual([null, null]);
  });

  it('라우팅: 슬래브·코일로 묶고 공정 순서대로 둔다', async () => {
    const routings: RoutingView[] = [
      { id: 3, itemType: 'COIL', processType: 'STEELMAKING', sequenceNo: 2, plannedYieldRate: '0.9000' },
      { id: 2, itemType: 'COIL', processType: 'IRONMAKING', sequenceNo: 1, plannedYieldRate: null },
      { id: 1, itemType: 'SLAB', processType: 'IRONMAKING', sequenceNo: 1, plannedYieldRate: null },
    ];
    useFakeServer(SEED_EMPLOYEE_NO.admin, (c) => (c.path === '/routings' ? ok(routings) : undefined));
    const result = await masterDataApi.listRoutings();

    expect(result.map((r) => [r.itemType, r.steps.map((s) => [s.processType, s.processSeq, s.plannedYieldRate])])).toEqual([
      ['SLAB', [['IRONMAKING', 1, null]]],
      [
        'COIL',
        [
          ['IRONMAKING', 1, null],
          ['STEELMAKING', 2, '0.9000'],
        ],
      ],
    ]);
  });

  it('원단위는 원료 유형으로 단위를 정하고, 원료 품목은 기본 야드·공급업체 이름을 채운다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.admin, (c) => {
      if (c.path === '/specific-consumptions') {
        return ok([{ id: 7, rawMaterialItemId: 4, rawMaterialItemCode: 'SMN01', rawMaterialType: 'FERROALLOY', steelGradeId: 11, steelGradeCode: 'SS275', consumptionRate: '10.0000' }]);
      }
      return c.path in MASTER ? ok(MASTER[c.path]) : undefined;
    });
    expect(await masterDataApi.listSpecificConsumptions()).toEqual([{ id: 7, itemId: 4, steelGradeId: 11, consumptionRate: '10.0000', consumptionUnit: 'kg/t' }]);
    const materials = await masterDataApi.listRawMaterials();
    expect(materials.map((m) => [m.itemCode, m.defaultYardName, m.defaultSupplierName])).toEqual([
      ['COL01', '원료 1야드', null],
      ['ORE01', '원료 1야드', '가온광업'],
    ]);
  });

  it('생산 설정값·고객사는 서버 값을 그대로 쓰고 참조 문구는 비운다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.admin, (c) => {
      if (c.path === '/production-settings') return ok({ id: 1, heatCapacityTon: '250.000', deliveryRiskDays: 3 });
      if (c.path === '/customers') return ok([{ id: 41, customerCode: 'CUS-01', customerName: '한빛조선' }]);
      return undefined;
    });
    expect(await masterDataApi.getProductionSetting()).toMatchObject({ heatCapacityTon: '250.000', deliveryRiskDays: 3 });
    expect(await masterDataApi.listCustomers()).toEqual([{ id: 41, customerCode: 'CUS-01', customerName: '한빛조선', referenceText: null, updatedAt: '' }]);
  });
});
