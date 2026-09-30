import { CONSUMPTION_UNIT, RAW_MATERIAL_TYPE, type ConsumptionUnit } from '@fantasteel/shared';
import { badInput } from '../../common/errors/app.exception';

/**
 * 배합 원단위 규칙 (REQ-MST-006).
 * 철광석·석탄·석회석: 용선 1t당 t, 강종 무관(공통). 합금철: 용강(히트) 1t당 kg, 강종별.
 * 단위는 원료 종류로 정해지므로 클라이언트가 보내지 않는다.
 */
export function consumptionRuleFor(rawMaterialType: string, steelGradeId: number | null | undefined): { unit: ConsumptionUnit; steelGradeId: number | null } {
  if (rawMaterialType === RAW_MATERIAL_TYPE.FERROALLOY) {
    if (steelGradeId === null || steelGradeId === undefined) throw badInput('합금철 원단위는 강종을 지정해야 합니다');
    return { unit: CONSUMPTION_UNIT.KG_PER_TON, steelGradeId };
  }
  if (steelGradeId !== null && steelGradeId !== undefined) throw badInput('철광석·석탄·석회석 원단위는 강종과 무관한 공통값입니다 (강종을 지정하지 마세요)');
  return { unit: CONSUMPTION_UNIT.TON_PER_TON, steelGradeId: null };
}
