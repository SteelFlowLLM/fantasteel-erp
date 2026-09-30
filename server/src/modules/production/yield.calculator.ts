import { Injectable } from '@nestjs/common';
import { ERROR_CODE } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { AppException, notFound } from '../../common/errors/app.exception';
import type { Tx } from '../../prisma/prisma.service';

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);

export interface HeatPlanCalc {
  /** 목표 제품 규격 */
  productSpecId: number;
  itemType: 'SLAB' | 'COIL';
  /** 연주에서 만들 슬래브 규격 (코일이면 매핑된 슬래브 규격) */
  slabSpecId: number;
  steelGradeId: number;
  /** 새로 생산할 슬래브 매수 (= 부족 매수 − 여재 사용 매수) */
  targetQty: number;
  /** 목표중량(t) = 매수 × 제품 1매 이론중량 */
  targetTon: Prisma.Decimal;
  steelmakingYieldRate: Prisma.Decimal;
  castingYieldRate: Prisma.Decimal;
  /** 열연 계획 수율 = 코일 1개 이론중량 ÷ 슬래브 1매 이론중량 (슬래브 제품이면 1) */
  hotRollingYieldRate: Prisma.Decimal;
  /** 용강 → 제품 누적 계획수율 = 연주 × 열연 */
  cumulativeYieldRate: Prisma.Decimal;
  /** 필요 투입량(용강 t) = 목표중량 ÷ 누적 계획수율 */
  requiredInputTon: Prisma.Decimal;
  heatCapacityTon: Prisma.Decimal;
  /** 히트 수 = ceil(필요 투입량 ÷ 히트 용량) */
  heatCount: number;
  /** 히트 톤 = 히트 수 × 히트 용량 */
  heatTon: Prisma.Decimal;
  /** 필요 용선(t) = 히트 톤 ÷ 제강 수율 */
  hotMetalTon: Prisma.Decimal;
  /** 히트 1개에서 나오는 슬래브 계획 매수 = floor(히트 용량 × 연주 수율 ÷ 슬래브 1매 이론중량) */
  slabQtyPerHeat: number;
  /** 계획 슬래브 매수 합계와 예상 여재 */
  plannedSlabQty: number;
  expectedSurplusQty: number;
}

/**
 * 히트 편성·MRP 공통 계산 (업무 프로세스 정의서 4.4).
 * 히트 용량(250t)은 용강(히트) 산출 기준으로 보고, 누적 계획수율은 용강에서 시작한다(연주 × 열연).
 * 제강 수율은 용선 → 용강 환산에만 한 번 쓴다 (같은 수율을 두 번 적용하지 않는다).
 */
@Injectable()
export class YieldCalculator {
  async heatCapacityTon(tx: Tx): Promise<Prisma.Decimal> {
    const s = await tx.productionSetting.findUnique({ where: { id: 1 } });
    if (!s) throw new AppException(ERROR_CODE.MST_001, '생산 설정값(히트 용량)이 없습니다');
    return s.heatCapacityTon;
  }

  /** 품목 유형의 공정별 계획 수율. 없으면 MST-001. */
  async routingYields(tx: Tx, itemType: 'SLAB' | 'COIL') {
    const rows = await tx.routing.findMany({ where: { itemType }, orderBy: { processSeq: 'asc' } });
    const of = (code: string) => rows.find((r) => r.processCode === code);
    const steel = of('STEELMAKING')?.plannedYieldRate;
    const cast = of('CASTING')?.plannedYieldRate;
    if (!steel || !cast || steel.lte(0) || steel.gt(1) || cast.lte(0) || cast.gt(1)) throw new AppException(ERROR_CODE.MST_001, '라우팅의 제강·연주 계획 수율이 없거나 범위를 벗어났습니다');
    if (itemType === 'COIL' && !of('HOT_ROLLING')) throw new AppException(ERROR_CODE.MST_001, '코일 라우팅에 열연 공정이 없습니다');
    return { steelmaking: steel, casting: cast, processes: rows.map((r) => r.processCode) };
  }

  /** 제품 규격과 새로 생산할 매수로 히트 편성을 계산한다. */
  async calcHeatPlan(tx: Tx, productSpecId: number, targetQty: number): Promise<HeatPlanCalc> {
    const spec = await tx.productSpec.findUnique({ where: { id: productSpecId }, include: { item: true, coilMapping: { include: { slabSpec: true } } } });
    if (!spec) throw notFound('제품 규격');
    const itemType = spec.item.itemType as 'SLAB' | 'COIL';
    let slabSpec = spec;
    let hotRolling = D(1);
    if (itemType === 'COIL') {
      if (!spec.coilMapping) throw new AppException(ERROR_CODE.MST_001, '코일 규격에 대응하는 슬래브 규격 매핑이 없습니다');
      slabSpec = { ...spec.coilMapping.slabSpec, item: spec.item, coilMapping: null } as typeof spec;
      hotRolling = spec.theoreticalWeightTon.div(spec.coilMapping.slabSpec.theoreticalWeightTon).toDecimalPlaces(4);
    }
    const y = await this.routingYields(tx, itemType);
    const cap = await this.heatCapacityTon(tx);
    const cumulative = y.casting.mul(hotRolling).toDecimalPlaces(4);
    const targetTon = spec.theoreticalWeightTon.mul(targetQty);
    const requiredInputTon = targetQty > 0 ? targetTon.div(cumulative).toDecimalPlaces(3) : D(0);
    const slabQtyPerHeat = cap.mul(y.casting).div(slabSpec.theoreticalWeightTon).floor().toNumber();
    if (slabQtyPerHeat < 1) throw new AppException(ERROR_CODE.MST_001, '히트 용량이 슬래브 1매 중량보다 작습니다');
    // 히트당 슬래브 매수는 내림이라 톤 기준 히트 수만으로는 목표 매수에 못 미칠 수 있다 → 매수 기준도 함께 본다
    const heatCount = targetQty > 0 ? Math.max(requiredInputTon.div(cap).ceil().toNumber(), Math.ceil(targetQty / slabQtyPerHeat)) : 0;
    const heatTon = cap.mul(heatCount);
    const plannedSlabQty = slabQtyPerHeat * heatCount;
    return {
      productSpecId, itemType, slabSpecId: slabSpec.id, steelGradeId: spec.steelGradeId, targetQty, targetTon,
      steelmakingYieldRate: y.steelmaking, castingYieldRate: y.casting, hotRollingYieldRate: hotRolling, cumulativeYieldRate: cumulative,
      requiredInputTon, heatCapacityTon: cap, heatCount, heatTon,
      hotMetalTon: heatCount ? heatTon.div(y.steelmaking).toDecimalPlaces(3) : D(0),
      slabQtyPerHeat, plannedSlabQty, expectedSurplusQty: Math.max(0, plannedSlabQty - targetQty),
    };
  }

  /**
   * 용선 톤과 강종별 히트 톤에서 원료 총소요(t)를 계산한다.
   * 철광석·석탄·석회석 = 용선(t) × 원단위(t/t), 합금철 = 히트 톤 × 강종별 원단위(kg/t) ÷ 1,000.
   */
  async rawMaterialRequirements(tx: Tx, hotMetalTon: Prisma.Decimal, heatTonBySteelGrade: Map<number, Prisma.Decimal>): Promise<Map<number, Prisma.Decimal>> {
    const rates = await tx.specificConsumption.findMany();
    const out = new Map<number, Prisma.Decimal>();
    const add = (id: number, v: Prisma.Decimal) => out.set(id, (out.get(id) ?? D(0)).add(v));
    for (const r of rates) {
      if (r.consumptionUnit === 'TON_PER_TON' && r.steelGradeId === null) add(r.rawMaterialId, hotMetalTon.mul(r.consumptionRate));
      if (r.consumptionUnit === 'KG_PER_TON' && r.steelGradeId !== null) {
        const heatTon = heatTonBySteelGrade.get(r.steelGradeId);
        if (heatTon) add(r.rawMaterialId, heatTon.mul(r.consumptionRate).div(1000));
      }
    }
    for (const [k, v] of out) out.set(k, v.toDecimalPlaces(3));
    return out;
  }
}
