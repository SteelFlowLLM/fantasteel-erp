import { ERROR_CODE, ITEM_TYPE, PROCESS_CODE, RAW_MATERIAL_TYPE, RAW_MATERIAL_TYPE_LABEL, type RawMaterialType } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';

/** 문제가 있는 기준정보 영역. 화면이 해당 탭으로 안내할 때 쓴다. */
export const MASTER_AREA = {
  PRODUCT_SPEC: 'PRODUCT_SPEC', SPEC_MAPPING: 'SPEC_MAPPING', ROUTING: 'ROUTING', SPECIFIC_CONSUMPTION: 'SPECIFIC_CONSUMPTION',
  RAW_MATERIAL: 'RAW_MATERIAL', STEEL_GRADE: 'STEEL_GRADE', INSPECTION_ITEM: 'INSPECTION_ITEM', PRODUCTION_SETTING: 'PRODUCTION_SETTING',
} as const;
export type MasterArea = (typeof MASTER_AREA)[keyof typeof MASTER_AREA];

export interface ReadinessProblem {
  code: string;
  area: MasterArea;
  targetId: number | null;
  targetNo: string | null;
  message: string;
}

type Dec = Prisma.Decimal;
export interface ReadinessSnapshot {
  steelGrades: { id: number; steelGradeCode: string; isActive: boolean; compositionSpecCount: number }[];
  productSpecs: { id: number; specCode: string; itemType: string; isActive: boolean }[];
  mappings: { id: number; slabSpecId: number; coilSpecId: number; slabSpecCode: string; coilSpecCode: string; slabWeightTon: Dec; coilWeightTon: Dec }[];
  routings: { itemType: string; processCode: string; plannedYieldRate: Dec | null }[];
  rawMaterials: { id: number; materialCode: string; itemName: string; rawMaterialType: string; isActive: boolean; defaultSupplierId: number | null; defaultSupplierActive: boolean | null }[];
  consumptions: { rawMaterialId: number; steelGradeId: number | null; consumptionRate: Dec }[];
  inspectionItems: { processCode: string; steelGradeId: number | null }[];
  productionSetting: { heatCapacityTon: Dec; deliveryRiskDays: number } | null;
}

/**
 * 업무 계산(수주 → 히트 편성 → MRP)을 막는 기준정보 누락·오류를 찾는다 (MST-001).
 * 사용 중지된 강종·규격·원료는 검사하지 않는다.
 */
export function evaluateReadiness(s: ReadinessSnapshot): ReadinessProblem[] {
  const out: ReadinessProblem[] = [];
  const add = (area: MasterArea, targetId: number | null, targetNo: string | null, message: string) =>
    out.push({ code: ERROR_CODE.MST_001, area, targetId, targetNo, message });

  // 생산 설정값
  const setting = s.productionSetting;
  if (!setting) add(MASTER_AREA.PRODUCTION_SETTING, null, null, '생산 설정값(히트 용량·납기 위험 기준일)이 등록되어 있지 않습니다');
  else {
    if (setting.heatCapacityTon.lte(0)) add(MASTER_AREA.PRODUCTION_SETTING, 1, null, '히트 용량은 0보다 커야 합니다');
    if (setting.deliveryRiskDays < 0) add(MASTER_AREA.PRODUCTION_SETTING, 1, null, '납기 위험 기준일은 0 이상이어야 합니다');
  }

  // 강종: 성분 규격, 연주·열연 검사 항목 (강종 전용 또는 공통 항목)
  const activeGrades = s.steelGrades.filter((g) => g.isActive);
  for (const g of activeGrades) {
    if (g.compositionSpecCount === 0) add(MASTER_AREA.STEEL_GRADE, g.id, g.steelGradeCode, `강종 ${g.steelGradeCode}에 성분 규격이 없습니다`);
    for (const [process, name] of [[PROCESS_CODE.HOT_ROLLING, '열연(코일)'], [PROCESS_CODE.CASTING, '연주(슬래브)']] as const) {
      if (!s.inspectionItems.some((i) => i.processCode === process && (i.steelGradeId === g.id || i.steelGradeId === null))) {
        add(MASTER_AREA.INSPECTION_ITEM, g.id, g.steelGradeCode, `강종 ${g.steelGradeCode}에 ${name} 검사 항목이 없습니다`);
      }
    }
  }

  // 규격 매핑: 슬래브·코일 규격마다 상대 규격 1개
  const mappedSlab = new Set(s.mappings.map((m) => m.slabSpecId));
  const mappedCoil = new Set(s.mappings.map((m) => m.coilSpecId));
  for (const spec of s.productSpecs.filter((p) => p.isActive)) {
    if (spec.itemType === ITEM_TYPE.SLAB && !mappedSlab.has(spec.id)) add(MASTER_AREA.SPEC_MAPPING, spec.id, spec.specCode, `슬래브 규격 ${spec.specCode}에 대응 코일 규격 매핑이 없습니다`);
    if (spec.itemType === ITEM_TYPE.COIL && !mappedCoil.has(spec.id)) add(MASTER_AREA.SPEC_MAPPING, spec.id, spec.specCode, `코일 규격 ${spec.specCode}에 대응 슬래브 규격 매핑이 없습니다`);
  }
  for (const m of s.mappings) {
    if (m.coilWeightTon.gt(m.slabWeightTon)) {
      add(MASTER_AREA.SPEC_MAPPING, m.id, `${m.slabSpecCode}→${m.coilSpecCode}`, `코일 이론중량이 슬래브 이론중량보다 큽니다 (${m.coilSpecCode})`);
    }
  }

  // 라우팅: 제강·연주 계획 수율(0 초과 1 이하), 코일은 열연 공정
  for (const itemType of [ITEM_TYPE.SLAB, ITEM_TYPE.COIL]) {
    const rows = s.routings.filter((r) => r.itemType === itemType);
    const name = itemType === ITEM_TYPE.COIL ? '코일' : '슬래브';
    if (!rows.length) {
      add(MASTER_AREA.ROUTING, null, itemType, `${name} 라우팅이 없습니다`);
      continue;
    }
    for (const [code, label] of [[PROCESS_CODE.STEELMAKING, '제강'], [PROCESS_CODE.CASTING, '연주']] as const) {
      const row = rows.find((r) => r.processCode === code);
      if (!row) add(MASTER_AREA.ROUTING, null, itemType, `${name} 라우팅에 ${label} 공정이 없습니다`);
      else if (!row.plannedYieldRate || row.plannedYieldRate.lte(0) || row.plannedYieldRate.gt(1)) add(MASTER_AREA.ROUTING, null, itemType, `${name} 라우팅의 ${label} 계획 수율이 없거나 0 초과 1 이하가 아닙니다`);
    }
    if (itemType === ITEM_TYPE.COIL && !rows.some((r) => r.processCode === PROCESS_CODE.HOT_ROLLING)) add(MASTER_AREA.ROUTING, null, itemType, '코일 라우팅에 열연 공정이 없습니다');
  }

  // 원료: 기본 공급업체, 배합 원단위
  const activeRaw = s.rawMaterials.filter((r) => r.isActive);
  for (const type of [RAW_MATERIAL_TYPE.IRON_ORE, RAW_MATERIAL_TYPE.COAL, RAW_MATERIAL_TYPE.LIMESTONE]) {
    if (!activeRaw.some((r) => r.rawMaterialType === type)) add(MASTER_AREA.RAW_MATERIAL, null, type, `${RAW_MATERIAL_TYPE_LABEL[type as RawMaterialType]} 원료가 등록되어 있지 않습니다`);
  }
  for (const r of activeRaw) {
    if (r.defaultSupplierId === null) add(MASTER_AREA.RAW_MATERIAL, r.id, r.materialCode, `원료 ${r.itemName}(${r.materialCode})에 기본 공급업체가 없습니다`);
    else if (r.defaultSupplierActive === false) add(MASTER_AREA.RAW_MATERIAL, r.id, r.materialCode, `원료 ${r.itemName}(${r.materialCode})의 기본 공급업체가 사용 중지 상태입니다`);

    if (r.rawMaterialType === RAW_MATERIAL_TYPE.FERROALLOY) {
      for (const g of activeGrades) {
        const rate = s.consumptions.find((c) => c.rawMaterialId === r.id && c.steelGradeId === g.id);
        if (!rate || rate.consumptionRate.lte(0)) add(MASTER_AREA.SPECIFIC_CONSUMPTION, r.id, `${r.materialCode}-${g.steelGradeCode}`, `원료 ${r.itemName}(${r.materialCode})의 ${g.steelGradeCode} 원단위(kg/t)가 없습니다`);
      }
    } else {
      const rate = s.consumptions.find((c) => c.rawMaterialId === r.id && c.steelGradeId === null);
      if (!rate || rate.consumptionRate.lte(0)) add(MASTER_AREA.SPECIFIC_CONSUMPTION, r.id, r.materialCode, `원료 ${r.itemName}의 공통 원단위(t/t)가 없습니다`);
    }
  }
  return out;
}
