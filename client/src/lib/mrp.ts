// MRP 계산 (업무 프로세스 4.4, REQ-PRD-005, BP-PRD-01).
//   필요 용선(t) = 히트 톤 ÷ 제강 계획 수율
//   철광석·석탄·석회석(t) = 필요 용선 × 용선 1t당 원단위(t/t)
//   합금철(t) = 히트 톤 × 강종별 원단위(kg/t) ÷ 1,000
//   순소요(t) = max(0, 총소요 − 원료 LOT 잔량 − 입고예정)
// 입고예정은 필요일까지 도착하는 확정 발주의 미입고량만 쓰고, 같은 공급을 계획마다 두 번 빼지 않는다(시점별 차감).
// 원료 안전재고는 없다. 수주에 연결된 계획의 입고예정은 그 계획이 먼저 쓰고 다른 수주가 쓰지 않는다.
import { decAdd, decCmp, decDiv, decMin, decMul, decSub, TON_DIGITS } from '@/lib/decimal';

export const hotMetalTonFor = (heatTon: string, steelmakingYieldRate: string): string => decDiv(heatTon, steelmakingYieldRate, TON_DIGITS);

/** 철광석·석탄·석회석: 용선 1t당 원단위(t/t) */
export const rawMaterialTonFor = (hotMetalTon: string, tonPerTon: string): string => decMul(hotMetalTon, tonPerTon, TON_DIGITS);

/** 합금철: 용강(히트) 1t당 원단위(kg/t) ÷ 1,000 */
export const ferroalloyTonFor = (heatTon: string, kgPerTon: string): string => decDiv(decMul(heatTon, kgPerTon, 6), '1000', TON_DIGITS);

export interface MrpRequirement {
  /** 소요를 낸 생산계획 id */
  planId: number;
  materialId: number;
  /** 필요일 YYYY-MM-DD */
  needDate: string;
  grossTon: string;
}

export interface MrpSupply {
  kind: 'ON_HAND' | 'SCHEDULED';
  materialId: number;
  /** 입고예정이면 발주 납기(입고예정일). 날짜가 없으면 필요일까지 도착한다고 보지 않는다. 잔량은 null(지금 있음). */
  availableDate: string | null;
  ton: string;
  /** 이 공급을 먼저 쓸 계획 (구매요청 품목의 production_plan_id). 없으면 누구나 쓴다. */
  reservedForPlanId: number | null;
  /** 원료 LOT id 또는 발주 품목 id */
  sourceId: number;
}

export interface MrpNetLine extends MrpRequirement {
  /** 원료 LOT 잔량으로 채운 톤 */
  coveredOnHandTon: string;
  /** 입고예정으로 채운 톤 */
  coveredScheduledTon: string;
  /** 순소요 */
  netTon: string;
}

export interface MrpSupplyUsage {
  kind: MrpSupply['kind'];
  sourceId: number;
  materialId: number;
  usedTon: string;
  remainingTon: string;
}

/**
 * 시점별 순소요. 소요를 필요일 → 계획 id 순으로 보고, 공급은 (1) 그 계획 몫의 입고예정 (2) 원료 LOT 잔량 (3) 누구 몫도 아닌 입고예정
 * 순서로 쓴다. 입고예정은 필요일까지(이하) 도착하는 것만 쓴다. 쓴 공급은 다음 소요에서 다시 쓰지 않는다.
 * openPlanIds: 아직 소요가 남은 계획. 그 밖의 계획 몫 입고예정은 누구나 쓴다.
 */
export function netRequirements(
  requirements: readonly MrpRequirement[],
  supplies: readonly MrpSupply[],
): { lines: MrpNetLine[]; usage: MrpSupplyUsage[] } {
  const openPlanIds = new Set(requirements.filter((r) => decCmp(r.grossTon, 0) > 0).map((r) => r.planId));
  const pool = supplies.map((s) => ({ ...s, remaining: decMul(s.ton, '1', TON_DIGITS), used: '0.000' }));
  const ordered = [...requirements].sort((a, b) => a.needDate.localeCompare(b.needDate) || a.planId - b.planId || a.materialId - b.materialId);
  const scheduledOrder = (a: (typeof pool)[number], b: (typeof pool)[number]) =>
    (a.availableDate ?? '').localeCompare(b.availableDate ?? '') || a.sourceId - b.sourceId;

  const lines: MrpNetLine[] = ordered.map((req) => {
    let need = decMul(req.grossTon, '1', TON_DIGITS);
    let onHand = '0.000';
    let scheduled = '0.000';
    const take = (supply: (typeof pool)[number]) => {
      if (decCmp(need, 0) <= 0 || decCmp(supply.remaining, 0) <= 0) return;
      const used = decMin(need, supply.remaining);
      supply.remaining = decSub(supply.remaining, used);
      supply.used = decAdd(supply.used, used);
      need = decSub(need, used);
      if (supply.kind === 'ON_HAND') onHand = decAdd(onHand, used);
      else scheduled = decAdd(scheduled, used);
    };
    const arrivesInTime = (s: (typeof pool)[number]) => s.availableDate !== null && s.availableDate <= req.needDate;
    const sameMaterial = pool.filter((s) => s.materialId === req.materialId);
    sameMaterial.filter((s) => s.kind === 'SCHEDULED' && s.reservedForPlanId === req.planId && arrivesInTime(s)).sort(scheduledOrder).forEach(take);
    sameMaterial.filter((s) => s.kind === 'ON_HAND').sort((a, b) => a.sourceId - b.sourceId).forEach(take);
    sameMaterial
      .filter((s) => s.kind === 'SCHEDULED' && (s.reservedForPlanId === null || !openPlanIds.has(s.reservedForPlanId)) && arrivesInTime(s))
      .sort(scheduledOrder)
      .forEach(take);
    return { ...req, grossTon: decMul(req.grossTon, '1', TON_DIGITS), coveredOnHandTon: onHand, coveredScheduledTon: scheduled, netTon: need };
  });

  const usage = pool.map((s) => ({ kind: s.kind, sourceId: s.sourceId, materialId: s.materialId, usedTon: s.used, remainingTon: s.remaining }));
  return { lines, usage };
}
