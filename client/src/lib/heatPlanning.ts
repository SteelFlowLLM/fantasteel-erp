// 히트 편성 (업무 프로세스 4.4, REQ-PRD-002, BP-PRD-01).
//   목표중량(t) = 부족 매수 × 제품 1매 이론중량
//   누적 계획수율 = 연주 (슬래브 수주) 또는 연주 × 열연 (코일 수주, 열연 = 규격 매핑 계산값)
//   필요 용강(t) = 목표중량 ÷ 누적 계획수율
//   히트 수 = ceil(필요 용강 ÷ 히트 용량),  히트 톤 = 히트 수 × 히트 용량 (용강 기준)
// 예상 슬래브: 히트 1개 = floor(히트 용량 × 연주 수율 ÷ 슬래브 1매 이론중량)매 (슬래브는 히트를 넘어 나눌 수 없다).
// 코일은 슬래브 1매 → 코일 1개라 필요한 슬래브 = 부족 매수. 나머지가 예상 슬래브 여재다.
import type { ProductItemType } from '@/codes';
import { decCeilDiv, decDiv, decFloorDiv, decMul, RATE_DIGITS, TON_DIGITS } from '@/lib/decimal';
import { calcWeightTon } from '@/lib/weight';

/** 누적 계획수율 (소수 4자리). 코일은 열연 수율(규격 매핑 계산값)을 곱한다. */
export function cumulativeYieldRate(productType: ProductItemType, castingYieldRate: string, hotRollingYieldRate: string | null): string {
  if (productType === 'SLAB') return decMul(castingYieldRate, '1', RATE_DIGITS);
  if (hotRollingYieldRate === null) throw new RangeError('코일 계획에는 열연 계획 수율(규격 매핑)이 필요해요');
  return decMul(castingYieldRate, hotRollingYieldRate, RATE_DIGITS);
}

/** 히트 하나(용강 heatTon)에서 연주할 수 있는 슬래브 최대 매수 = floor(히트 톤 × 연주 수율 ÷ 슬래브 1매 이론중량) */
export function maxSlabQtyFromHeat(heatTon: string, castingYieldRate: string, slabUnitWeightTon: string): number {
  return decFloorDiv(decMul(heatTon, castingYieldRate, 6), slabUnitWeightTon);
}

export interface HeatFormationInput {
  productType: ProductItemType;
  /** 부족 매수 (1 이상) */
  shortageQty: number;
  /** 생산 대상 제품 1매(1개) 이론중량 */
  unitWeightTon: string;
  /** 연주 계획 수율 */
  castingYieldRate: string;
  /** 열연 계획 수율 = 코일 이론중량 ÷ 대응 슬래브 이론중량 (코일만) */
  hotRollingYieldRate: string | null;
  /** 히트 용량 (용강 기준, production_setting) */
  heatCapacityTon: string;
  /** 연주할 슬래브 규격의 1매 이론중량 (슬래브 수주는 unitWeightTon과 같고, 코일은 대응 슬래브) */
  slabUnitWeightTon: string;
}

export interface HeatFormation {
  shortageQty: number;
  /** 목표중량 = 부족 매수 × 1매 이론중량 (수주 목표) */
  targetWeightTon: string;
  cumulativeYieldRate: string;
  /** 필요 용강량 */
  requiredSteelTon: string;
  heatCount: number;
  heatCapacityTon: string;
  /** 히트 전체 톤 = 히트 수 × 히트 용량 */
  heatTon: string;
  /** 히트 1개에서 나오는 슬래브 매수 */
  slabQtyPerHeat: number;
  /** 편성한 히트 전체에서 나오는 슬래브 매수 */
  plannedSlabQty: number;
  /** 이 계획에 필요한 슬래브 매수 (슬래브 = 부족 매수, 코일 = 부족 매수만큼 열연) */
  neededSlabQty: number;
  /** 예상 슬래브 여재 = max(0, 계획 슬래브 − 필요 슬래브) */
  expectedSurplusSlabQty: number;
  /** 히트를 슬래브로 나눌 때 버려지는 몫 때문에 필요한 슬래브보다 적게 나오는 매수 (보통 0) */
  expectedSlabShortageQty: number;
}

export function formHeats(input: HeatFormationInput): HeatFormation {
  if (!Number.isInteger(input.shortageQty) || input.shortageQty < 1) throw new RangeError(`부족 매수는 1 이상의 정수여야 해요: ${input.shortageQty}`);
  const targetWeightTon = calcWeightTon(input.shortageQty, input.unitWeightTon);
  const yieldRate = cumulativeYieldRate(input.productType, input.castingYieldRate, input.hotRollingYieldRate);
  const requiredSteelTon = decDiv(targetWeightTon, yieldRate, TON_DIGITS);
  const heatCount = decCeilDiv(requiredSteelTon, input.heatCapacityTon);
  const heatTon = decMul(input.heatCapacityTon, heatCount, TON_DIGITS);
  const slabQtyPerHeat = maxSlabQtyFromHeat(input.heatCapacityTon, input.castingYieldRate, input.slabUnitWeightTon);
  const plannedSlabQty = slabQtyPerHeat * heatCount;
  const neededSlabQty = input.shortageQty;
  return {
    shortageQty: input.shortageQty,
    targetWeightTon,
    cumulativeYieldRate: yieldRate,
    requiredSteelTon,
    heatCount,
    heatCapacityTon: decMul(input.heatCapacityTon, '1', TON_DIGITS),
    heatTon,
    slabQtyPerHeat,
    plannedSlabQty,
    neededSlabQty,
    expectedSurplusSlabQty: Math.max(0, plannedSlabQty - neededSlabQty),
    expectedSlabShortageQty: Math.max(0, neededSlabQty - plannedSlabQty),
  };
}
