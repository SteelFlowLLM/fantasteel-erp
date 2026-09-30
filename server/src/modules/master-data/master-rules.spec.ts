// @nestjs/common 12는 ESM 전용이라 플래그 없는 jest에서는 대체품을 쓴다 (testing/nest-common.shim.ts 참고)
jest.mock('@nestjs/common', () => require('./testing/nest-common.shim'));
jest.mock('../../common/realtime/realtime.service', () => ({ RealtimeService: class {} }));
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));

import { Prisma } from '../../generated/prisma/client';
import { validateInspectionRange } from './inspection-item.rules';
import { evaluateReadiness, type ReadinessSnapshot } from './readiness.rules';
import { validateRoutingProcesses, validateYield } from './routing.rules';
import { consumptionRuleFor } from './specific-consumption.rules';
import { validateCompositionInputs } from './steel-grade.rules';

const D = (v: string | number) => new Prisma.Decimal(v);

describe('라우팅 규칙 (REQ-MST-005)', () => {
  it('수율은 0 초과 1 이하', () => {
    expect(() => validateYield('STEELMAKING', 0)).toThrow();
    expect(() => validateYield('STEELMAKING', 1.01)).toThrow();
    expect(() => validateYield('STEELMAKING', 1)).not.toThrow();
    expect(() => validateYield('CASTING', 0.96)).not.toThrow();
    expect(() => validateYield('IRONMAKING', null)).not.toThrow();
  });
  it('열연 수율은 입력할 수 없다 (규격 매핑에서 계산)', () => {
    expect(() => validateYield('HOT_ROLLING', 0.9)).toThrow(/열연 계획 수율은 입력하지 않습니다/);
    expect(() => validateYield('HOT_ROLLING', null)).not.toThrow();
  });
  it('공정이 중복되면 거부한다', () => {
    expect(() => validateRoutingProcesses([{ processCode: 'CASTING' }, { processCode: 'CASTING' }])).toThrow(/중복/);
  });
});

describe('배합 원단위 규칙 (REQ-MST-006)', () => {
  it('철광석·석탄·석회석은 강종 없이 t/t, 합금철은 강종별 kg/t', () => {
    expect(consumptionRuleFor('IRON_ORE', null)).toEqual({ unit: 'TON_PER_TON', steelGradeId: null });
    expect(consumptionRuleFor('FERROALLOY', 3)).toEqual({ unit: 'KG_PER_TON', steelGradeId: 3 });
    expect(() => consumptionRuleFor('COAL', 3)).toThrow(/공통값/);
    expect(() => consumptionRuleFor('FERROALLOY', null)).toThrow(/강종을 지정/);
  });
});

describe('검사 항목·성분 min/max (REQ-QC-002, MST-002)', () => {
  it('min ≤ max, 경계 포함, 둘 중 하나는 필수', () => {
    expect(() => validateInspectionRange(410, 550)).not.toThrow();
    expect(() => validateInspectionRange(5, 5)).not.toThrow();
    expect(() => validateInspectionRange(null, 2)).not.toThrow();
    expect(() => validateInspectionRange(551, 550)).toThrow(/최소값이 최대값보다/);
    expect(() => validateInspectionRange(null, null)).toThrow();
  });
  it('성분 규격도 min ≤ max이고 성분 기호가 중복되면 안 된다', () => {
    expect(() => validateCompositionInputs([{ elementCode: 'C', maxValue: 0.25 }, { elementCode: 'Si', minValue: 0.1, maxValue: 0.45 }])).not.toThrow();
    expect(() => validateCompositionInputs([{ elementCode: 'C', minValue: 0.3, maxValue: 0.25 }])).toThrow();
    expect(() => validateCompositionInputs([{ elementCode: 'C', maxValue: 0.25 }, { elementCode: 'c', maxValue: 0.2 }])).toThrow(/중복/);
  });
});

describe('기준정보 준비 상태 점검 (MST-001)', () => {
  const ok = (): ReadinessSnapshot => ({
    steelGrades: [{ id: 1, steelGradeCode: 'SS275', isActive: true, compositionSpecCount: 5 }],
    productSpecs: [{ id: 1, specCode: 'SL-1', itemType: 'SLAB', isActive: true }, { id: 2, specCode: 'CL-1', itemType: 'COIL', isActive: true }],
    mappings: [{ id: 1, slabSpecId: 1, coilSpecId: 2, slabSpecCode: 'SL-1', coilSpecCode: 'CL-1', slabWeightTon: D('23.550'), coilWeightTon: D('22.975') }],
    routings: [
      { itemType: 'SLAB', processCode: 'STEELMAKING', plannedYieldRate: D('0.95') }, { itemType: 'SLAB', processCode: 'CASTING', plannedYieldRate: D('0.96') },
      { itemType: 'COIL', processCode: 'STEELMAKING', plannedYieldRate: D('0.95') }, { itemType: 'COIL', processCode: 'CASTING', plannedYieldRate: D('0.96') }, { itemType: 'COIL', processCode: 'HOT_ROLLING', plannedYieldRate: null },
    ],
    rawMaterials: [
      { id: 1, materialCode: 'IO', itemName: '철광석', rawMaterialType: 'IRON_ORE', isActive: true, defaultSupplierId: 1, defaultSupplierActive: true },
      { id: 2, materialCode: 'CL', itemName: '석탄', rawMaterialType: 'COAL', isActive: true, defaultSupplierId: 1, defaultSupplierActive: true },
      { id: 3, materialCode: 'LS', itemName: '석회석', rawMaterialType: 'LIMESTONE', isActive: true, defaultSupplierId: 2, defaultSupplierActive: true },
      { id: 4, materialCode: 'FM', itemName: '합금철 FeMn', rawMaterialType: 'FERROALLOY', isActive: true, defaultSupplierId: 3, defaultSupplierActive: true },
    ],
    consumptions: [
      { rawMaterialId: 1, steelGradeId: null, consumptionRate: D('1.6') }, { rawMaterialId: 2, steelGradeId: null, consumptionRate: D('0.75') },
      { rawMaterialId: 3, steelGradeId: null, consumptionRate: D('0.25') }, { rawMaterialId: 4, steelGradeId: 1, consumptionRate: D('6') },
    ],
    inspectionItems: [{ processCode: 'CASTING', steelGradeId: null }, { processCode: 'HOT_ROLLING', steelGradeId: 1 }],
    productionSetting: { heatCapacityTon: D('250'), deliveryRiskDays: 3 },
  });

  it('모두 갖추면 문제가 없다', () => {
    expect(evaluateReadiness(ok())).toEqual([]);
  });
  it('매핑 없는 슬래브 규격, 열연 검사 항목 없는 강종, 성분 규격 없는 강종을 찾는다', () => {
    const s = ok();
    s.mappings = [];
    s.inspectionItems = [{ processCode: 'CASTING', steelGradeId: null }];
    s.steelGrades[0].compositionSpecCount = 0;
    const msgs = evaluateReadiness(s).map((p) => p.message).join('\n');
    expect(msgs).toContain('슬래브 규격 SL-1에 대응 코일 규격 매핑이 없습니다');
    expect(msgs).toContain('코일 규격 CL-1에 대응 슬래브 규격 매핑이 없습니다');
    expect(msgs).toContain('열연(코일) 검사 항목이 없습니다');
    expect(msgs).toContain('성분 규격이 없습니다');
  });
  it('라우팅 수율 누락·범위 초과, 코일 열연 공정 누락을 찾는다', () => {
    const s = ok();
    s.routings = s.routings.filter((r) => r.processCode !== 'HOT_ROLLING');
    s.routings.find((r) => r.itemType === 'SLAB' && r.processCode === 'CASTING')!.plannedYieldRate = null;
    s.routings.find((r) => r.itemType === 'COIL' && r.processCode === 'STEELMAKING')!.plannedYieldRate = D('1.2');
    const msgs = evaluateReadiness(s).map((p) => p.message).join('\n');
    expect(msgs).toContain('슬래브 라우팅의 연주 계획 수율');
    expect(msgs).toContain('코일 라우팅의 제강 계획 수율');
    expect(msgs).toContain('코일 라우팅에 열연 공정이 없습니다');
  });
  it('합금철 강종별 원단위 누락, 기본 공급업체 없는 원료를 찾는다', () => {
    const s = ok();
    s.consumptions = s.consumptions.filter((c) => c.rawMaterialId !== 4 && c.rawMaterialId !== 1);
    s.rawMaterials[2].defaultSupplierId = null;
    const msgs = evaluateReadiness(s).map((p) => p.message).join('\n');
    expect(msgs).toContain('원료 합금철 FeMn(FM)의 SS275 원단위');
    expect(msgs).toContain('철광석의 공통 원단위');
    expect(msgs).toContain('석회석(LS)에 기본 공급업체가 없습니다');
  });
  it('사용 중지된 강종은 점검하지 않는다', () => {
    const s = ok();
    s.steelGrades[0].isActive = false;
    s.steelGrades[0].compositionSpecCount = 0;
    s.consumptions = s.consumptions.filter((c) => c.rawMaterialId !== 4);
    expect(evaluateReadiness(s)).toEqual([]);
  });
});
