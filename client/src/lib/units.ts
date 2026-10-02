// 배합 원단위 단위는 공통 코드가 아니라 원료 유형으로 정한다 (PLAN 4장: CONSUMPTION_UNIT 그룹을 없앰).
// 합금철 = kg/t (용강 1t당), 그 밖의 원료 = t/t (용선 1t당) — REQ-MST-006
import type { RawMaterialType } from '@/codes';

export type SpecificConsumptionUnit = 'kg/t' | 't/t';

export const specificConsumptionUnitOf = (rawMaterialType: RawMaterialType): SpecificConsumptionUnit =>
  rawMaterialType === 'FERROALLOY' ? 'kg/t' : 't/t';
