import { Prisma } from '../../generated/prisma/client';

// MRP 계산 (업무 프로세스 4.4, REQ-PRD-005, BP-PRD-01, docs/backend/mrp.md 4장). DB 없이 Decimal로만 계산한다.
//   필요 용선(t) = 히트 톤 ÷ 제강 계획 수율
//   철광석·석탄·석회석(t) = 필요 용선 × 용선 1t당 원단위(t/t)
//   합금철(t) = 히트 톤 × 강종별 원단위(kg/t) ÷ 1,000
//   순소요(t) = max(0, 소요량 − 원료 LOT 잔량 − 입고예정)
// 중간값은 반올림하지 않고 소요량에서 한 번만 소수 3자리로 반올림한다(mrp.md 4장 권장).

type DecimalLike = Prisma.Decimal | string;

const D = (v: DecimalLike) => new Prisma.Decimal(v);
const ZERO = new Prisma.Decimal(0);
const round3 = (v: Prisma.Decimal) => v.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
export const tonText = (v: Prisma.Decimal): string => round3(v).toFixed(3);

export interface MaterialRate {
  itemId: number;
  /** 합금철이면 kg/t(용강 1t당), 아니면 t/t(용선 1t당) */
  isFerroalloy: boolean;
  consumptionRate: DecimalLike;
}

/** 계획 1건의 필요 용선과 원료별 소요량. 원단위가 없는 원료는 소요 0 */
export function planRequirements(heatTon: DecimalLike, steelmakingYieldRate: DecimalLike, rates: readonly MaterialRate[]): { requiredHotMetalTon: Prisma.Decimal; materials: { itemId: number; requiredTon: Prisma.Decimal }[] } {
  const hotMetal = D(heatTon).div(D(steelmakingYieldRate));
  return {
    requiredHotMetalTon: round3(hotMetal),
    materials: rates.map((r) => ({
      itemId: r.itemId,
      requiredTon: round3(r.isFerroalloy ? D(heatTon).mul(D(r.consumptionRate)).div(1000) : hotMetal.mul(D(r.consumptionRate))),
    })),
  };
}

export interface MrpDemand {
  productionPlanId: number;
  itemId: number;
  /** YYYY-MM-DD */
  requiredDate: string;
  requiredTon: Prisma.Decimal;
}

export interface MrpSupply {
  /** REMAINING = 원료 LOT 잔량(지금 있음), SCHEDULED = 확정 발주의 미입고량 */
  kind: 'REMAINING' | 'SCHEDULED';
  itemId: number;
  ton: Prisma.Decimal;
  /** 입고예정일. 없으면 필요일까지 도착한다고 보지 않는다. 잔량은 null */
  availableDate: string | null;
  /** 이 입고예정을 먼저 쓸 계획 (구매요청의 production_plan_id) */
  reservedForPlanId: number | null;
  /** 원료 LOT id 또는 발주 품목 id (같은 날짜끼리 순서) */
  sourceId: number;
}

export interface MrpNetLine extends MrpDemand {
  usedRemainingTon: Prisma.Decimal;
  usedScheduledReceiptTon: Prisma.Decimal;
  netRequirementTon: Prisma.Decimal;
}

/**
 * 시점별 순소요. 소요를 필요일 → 계획 id 순으로 보고, 공급은 (1) 그 계획 몫 입고예정 (2) 원료 LOT 잔량
 * (3) 누구 몫도 아닌 입고예정 순서로 쓴다. 입고예정은 필요일까지(이하) 도착하는 것만 쓴다.
 * 아직 소요가 남은 다른 계획 몫 입고예정은 쓰지 않는다(REQ-PRD-005: 수주에 연결된 계획의 공급을 다른 수주가 쓰지 않음).
 * 쓴 공급은 다음 소요에서 다시 쓰지 않는다(같은 공급을 두 계획에서 중복 차감하지 않음).
 */
export function netRequirements(demands: readonly MrpDemand[], supplies: readonly MrpSupply[]): MrpNetLine[] {
  const openPlanIds = new Set(demands.filter((d) => d.requiredTon.gt(0)).map((d) => d.productionPlanId));
  const pool = supplies.map((s) => ({ ...s, left: s.ton }));
  const scheduledOrder = (a: MrpSupply, b: MrpSupply) => (a.availableDate ?? '').localeCompare(b.availableDate ?? '') || a.sourceId - b.sourceId;
  const usableBy = (s: MrpSupply, d: MrpDemand) =>
    s.availableDate !== null && s.availableDate <= d.requiredDate && (s.reservedForPlanId === null || s.reservedForPlanId === d.productionPlanId || !openPlanIds.has(s.reservedForPlanId));

  return [...demands]
    .sort((a, b) => a.requiredDate.localeCompare(b.requiredDate) || a.productionPlanId - b.productionPlanId || a.itemId - b.itemId)
    .map((d) => {
      let need = d.requiredTon;
      let usedRemaining = ZERO;
      let usedScheduled = ZERO;
      const take = (s: (typeof pool)[number]) => {
        if (need.lte(0) || s.left.lte(0)) return;
        const used = Prisma.Decimal.min(need, s.left);
        s.left = s.left.minus(used);
        need = need.minus(used);
        if (s.kind === 'REMAINING') usedRemaining = usedRemaining.plus(used);
        else usedScheduled = usedScheduled.plus(used);
      };
      const same = pool.filter((s) => s.itemId === d.itemId);
      same.filter((s) => s.kind === 'SCHEDULED' && s.reservedForPlanId === d.productionPlanId && usableBy(s, d)).sort(scheduledOrder).forEach(take);
      same.filter((s) => s.kind === 'REMAINING').sort((a, b) => a.sourceId - b.sourceId).forEach(take);
      same.filter((s) => s.kind === 'SCHEDULED' && s.reservedForPlanId !== d.productionPlanId && usableBy(s, d)).sort(scheduledOrder).forEach(take);
      return { ...d, usedRemainingTon: usedRemaining, usedScheduledReceiptTon: usedScheduled, netRequirementTon: need };
    });
}

export interface MrpMaterialTotal {
  itemId: number;
  requiredTon: Prisma.Decimal;
  remainingTon: Prisma.Decimal;
  scheduledReceiptTon: Prisma.Decimal;
  usedRemainingTon: Prisma.Decimal;
  usedScheduledReceiptTon: Prisma.Decimal;
  netRequirementTon: Prisma.Decimal;
  firstShortageDate: string | null;
}

const sum = (values: readonly Prisma.Decimal[]) => values.reduce((a, b) => a.plus(b), ZERO);

/** 원료별 합계: 소요·쓴 공급·순소요는 보이는 줄(lines)만, 잔량·입고예정은 원료 전체 */
export function materialTotals(itemIds: readonly number[], lines: readonly MrpNetLine[], supplies: readonly MrpSupply[]): MrpMaterialTotal[] {
  return itemIds.map((itemId) => {
    const mine = lines.filter((l) => l.itemId === itemId);
    const own = supplies.filter((s) => s.itemId === itemId);
    const shortageDates = mine.filter((l) => l.netRequirementTon.gt(0)).map((l) => l.requiredDate).sort();
    return {
      itemId,
      requiredTon: sum(mine.map((l) => l.requiredTon)),
      remainingTon: sum(own.filter((s) => s.kind === 'REMAINING').map((s) => s.ton)),
      scheduledReceiptTon: sum(own.filter((s) => s.kind === 'SCHEDULED').map((s) => s.ton)),
      usedRemainingTon: sum(mine.map((l) => l.usedRemainingTon)),
      usedScheduledReceiptTon: sum(mine.map((l) => l.usedScheduledReceiptTon)),
      netRequirementTon: sum(mine.map((l) => l.netRequirementTon)),
      firstShortageDate: shortageDates[0] ?? null,
    };
  });
}
