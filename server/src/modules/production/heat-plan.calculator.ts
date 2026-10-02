import { Prisma } from '../../generated/prisma/client';

// 히트 편성 계산 (업무 프로세스 4.4, REQ-PRD-002). Decimal로만 계산하고(컨벤션 7-2) mrp 모듈도 이 함수를 쓴다.

export interface HeatPlanInput {
  shortageQty: number;
  /** 제품 1매 이론중량(t) */
  theoreticalWeightTon: Prisma.Decimal | string;
  /** 연주 계획 수율 */
  castingYieldRate: Prisma.Decimal | string;
  /** 열연 수율 = 코일 이론중량 ÷ 대응 슬래브 이론중량. 슬래브 수주는 null */
  hotRollingYieldRate: Prisma.Decimal | string | null;
  /** 제강 계획 수율 */
  steelmakingYieldRate: Prisma.Decimal | string;
  /** 히트 용량(t, 용강 기준) */
  heatCapacityTon: Prisma.Decimal | string;
}

export interface HeatPlan {
  targetTon: string;
  requiredMoltenSteelTon: string;
  heatCount: number;
  heatTon: string;
  requiredHotMetalTon: string;
}

const D = (v: Prisma.Decimal | string) => new Prisma.Decimal(v);
const ton = (v: Prisma.Decimal) => v.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP).toFixed(3);

/**
 *   목표중량 = 부족 매수 × 1매 이론중량
 *   필요 용강 = 목표중량 ÷ 누적 계획수율(연주 × 열연)   ← 슬래브는 연주만
 *   히트 수 = ceil(필요 용강 ÷ 히트 용량),  히트 톤 = 히트 수 × 히트 용량
 *   필요 용선 = 히트 톤 ÷ 제강 계획 수율   ← 같은 수율을 두 번 적용하지 않는다
 */
export function calcHeatPlan(input: HeatPlanInput): HeatPlan {
  const targetTon = D(input.theoreticalWeightTon).mul(input.shortageQty);
  const cumulativeYield = input.hotRollingYieldRate === null ? D(input.castingYieldRate) : D(input.castingYieldRate).mul(D(input.hotRollingYieldRate));
  const requiredMoltenSteelTon = targetTon.div(cumulativeYield);
  const capacity = D(input.heatCapacityTon);
  const heatCount = requiredMoltenSteelTon.div(capacity).ceil().toNumber();
  const heatTon = capacity.mul(heatCount);
  return {
    targetTon: ton(targetTon),
    requiredMoltenSteelTon: ton(requiredMoltenSteelTon),
    heatCount,
    heatTon: ton(heatTon),
    requiredHotMetalTon: ton(heatTon.div(D(input.steelmakingYieldRate))),
  };
}

/** 열연 수율 = 코일 이론중량 ÷ 슬래브 이론중량 (저장하지 않음) */
export function hotRollingYieldRateOf(coilTheoreticalWeightTon: Prisma.Decimal | string, slabTheoreticalWeightTon: Prisma.Decimal | string): Prisma.Decimal {
  return D(coilTheoreticalWeightTon).div(D(slabTheoreticalWeightTon));
}
