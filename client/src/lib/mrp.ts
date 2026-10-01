// MRP 계산 (업무 프로세스 4.4, REQ-PRD-005, BP-PRD-01).
//   필요 용선(t) = 히트 톤 ÷ 제강 계획 수율
//   철광석·석탄·석회석(t) = 필요 용선 × 용선 1t당 원단위(t/t)
//   합금철(t) = 히트 톤 × 강종별 원단위(kg/t) ÷ 1,000
//   순소요(t) = max(0, 총소요 − 원료 LOT 잔량 − 입고예정)
// 입고예정은 필요일까지 도착하는 확정 발주의 미입고량만 쓰고, 같은 공급을 계획마다 두 번 빼지 않는다(시점별 차감).
// 원료 안전재고는 없다. 수주에 연결된 계획의 입고예정은 그 계획이 먼저 쓰고 다른 수주가 쓰지 않는다.
import { decAdd, decCmp, decDiv, decMin, decMul, decSub, decSum, TON_DIGITS } from '@/lib/decimal';

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

/** 소요 한 줄이 쓴 공급 하나 (kind + sourceId = 원료 LOT 또는 발주 품목) */
export interface MrpLineTake {
  kind: MrpSupply['kind'];
  sourceId: number;
  ton: string;
}

export interface MrpNetLine extends MrpRequirement {
  /** 원료 LOT 잔량으로 채운 톤 */
  coveredOnHandTon: string;
  /** 입고예정으로 채운 톤 */
  coveredScheduledTon: string;
  /** 순소요 */
  netTon: string;
  /** 이 소요가 쓴 공급 (쓴 순서) */
  takes: MrpLineTake[];
}

export interface MrpSupplyUsage {
  kind: MrpSupply['kind'];
  sourceId: number;
  materialId: number;
  usedTon: string;
  remainingTon: string;
}

/** 아직 소요가 남은 계획 (총소요 > 0인 소요가 있는 계획). 이 계획 몫 입고예정은 그 계획만 쓴다. */
const openPlanIdsOf = (requirements: readonly MrpRequirement[]): Set<number> =>
  new Set(requirements.filter((r) => decCmp(r.grossTon, 0) > 0).map((r) => r.planId));

/** 이 소요가 이 입고예정을 쓸 수 있는지: 필요일까지(이하) 도착하고, 다른 열린 계획 몫이 아니다 */
function scheduledUsableBy(supply: MrpSupply, line: MrpRequirement, openPlanIds: ReadonlySet<number>): boolean {
  const arrivesInTime = supply.availableDate !== null && supply.availableDate <= line.needDate;
  const free = supply.reservedForPlanId === null || supply.reservedForPlanId === line.planId || !openPlanIds.has(supply.reservedForPlanId);
  return arrivesInTime && free;
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
  const openPlanIds = openPlanIdsOf(requirements);
  const pool = supplies.map((s) => ({ ...s, remaining: decMul(s.ton, '1', TON_DIGITS), used: '0.000' }));
  const ordered = [...requirements].sort((a, b) => a.needDate.localeCompare(b.needDate) || a.planId - b.planId || a.materialId - b.materialId);
  const scheduledOrder = (a: (typeof pool)[number], b: (typeof pool)[number]) =>
    (a.availableDate ?? '').localeCompare(b.availableDate ?? '') || a.sourceId - b.sourceId;

  const lines: MrpNetLine[] = ordered.map((req) => {
    let need = decMul(req.grossTon, '1', TON_DIGITS);
    let onHand = '0.000';
    let scheduled = '0.000';
    const takes: MrpLineTake[] = [];
    const take = (supply: (typeof pool)[number]) => {
      if (decCmp(need, 0) <= 0 || decCmp(supply.remaining, 0) <= 0) return;
      const used = decMin(need, supply.remaining);
      supply.remaining = decSub(supply.remaining, used);
      supply.used = decAdd(supply.used, used);
      need = decSub(need, used);
      takes.push({ kind: supply.kind, sourceId: supply.sourceId, ton: used });
      if (supply.kind === 'ON_HAND') onHand = decAdd(onHand, used);
      else scheduled = decAdd(scheduled, used);
    };
    const sameMaterial = pool.filter((s) => s.materialId === req.materialId);
    sameMaterial.filter((s) => s.kind === 'SCHEDULED' && s.reservedForPlanId === req.planId && scheduledUsableBy(s, req, openPlanIds)).sort(scheduledOrder).forEach(take);
    sameMaterial.filter((s) => s.kind === 'ON_HAND').sort((a, b) => a.sourceId - b.sourceId).forEach(take);
    sameMaterial
      .filter((s) => s.kind === 'SCHEDULED' && s.reservedForPlanId !== req.planId && scheduledUsableBy(s, req, openPlanIds))
      .sort(scheduledOrder)
      .forEach(take);
    return { ...req, grossTon: decMul(req.grossTon, '1', TON_DIGITS), coveredOnHandTon: onHand, coveredScheduledTon: scheduled, netTon: need, takes };
  });

  const usage = pool.map((s) => ({ kind: s.kind, sourceId: s.sourceId, materialId: s.materialId, usedTon: s.used, remainingTon: s.remaining }));
  return { lines, usage };
}

/** 원료 1종의 공급 내역 (MRP 표 한 줄, supplyBreakdownOf) */
export interface MrpSupplyBreakdown {
  /** 원료 LOT 잔량 합계 */
  onHandTon: string;
  /** 보이는 소요가 쓸 수 있는 원료 LOT 잔량 (합계 − onHandEarlierPlansTon) */
  usableOnHandTon: string;
  /** 보이지 않는 앞선 소요가 먼저 쓴 원료 LOT 잔량 */
  onHandEarlierPlansTon: string;
  /** 입고예정 합계 (확정 발주의 미입고량) */
  scheduledTon: string;
  /** 보이는 소요가 필요일까지 받아 쓴 입고예정 */
  scheduledUsedTon: string;
  /** 다른 계획 몫으로 빼 둔 입고예정 */
  scheduledOtherPlansTon: string;
  /** 필요일 뒤에 도착하는(또는 납기가 없는) 입고예정 */
  scheduledAfterNeedDateTon: string;
  /** 보이지 않는 앞선 소요가 먼저 쓴 입고예정 */
  scheduledEarlierPlansTon: string;
  /** 소요가 이미 채워져 쓰지 않고 남는 입고예정 */
  scheduledSpareTon: string;
}

/**
 * 원료 1종의 공급 내역 (MRP 표 한 줄). 보이는 소요(isShown, 예: 기간 안 계획)를 기준으로 나눠
 * "총소요 − 원료 LOT 잔량 − 입고예정 = 순소요(0보다 작으면 0)"가 그 줄의 숫자로 그대로 맞게 한다. 계산 규칙(차감)은 바꾸지 않는다.
 * - 원료 LOT 잔량: 보이는 소요가 쓸 수 있는 몫 = 합계 − 보이지 않는 앞선 소요(필요일이 더 이른 계획)가 먼저 쓴 몫.
 * - 입고예정: 보이는 소요가 실제로 받아 쓴 몫. 쓰지 않은 나머지는 이유별로 나눈다(합 = 입고예정 합계).
 *   다른 계획 몫(수주에 연결된 다른 열린 계획 전용, REQ-PRD-005) · 필요일 뒤 도착(또는 납기 없음, 4.4)
 *   · 앞선 소요가 먼저 씀 · 남는 몫(소요가 이미 채워짐).
 *   순소요가 남은 줄이 있으면 그 줄들을 기준으로 이유를 정한다(그 줄들이 쓰지 못한 까닭). 이때 '남는 몫'은 생기지 않는다.
 * lines: netRequirements가 돌려준 소요 전부(차감 순서 그대로), supplies: 같은 공급.
 */
export function supplyBreakdownOf(
  materialId: number,
  lines: readonly MrpNetLine[],
  supplies: readonly MrpSupply[],
  isShown: (line: MrpNetLine) => boolean,
): MrpSupplyBreakdown {
  const openPlanIds = openPlanIdsOf(lines);
  const mine = lines.filter((l) => l.materialId === materialId);
  const lastShownIndex = mine.reduce((last, line, index) => (isShown(line) ? index : last), -1);
  const shown = mine.filter((l) => isShown(l));
  const earlier = mine.filter((l, index) => !isShown(l) && index < lastShownIndex);
  const short = shown.filter((l) => decCmp(l.netTon, 0) > 0);
  const target = short.length > 0 ? short : shown;
  const takenBy = (group: readonly MrpNetLine[], supply: MrpSupply): string =>
    decSum(group.flatMap((l) => l.takes.filter((t) => t.kind === supply.kind && t.sourceId === supply.sourceId).map((t) => t.ton)));

  const sum = { onHand: '0.000', onHandEarlier: '0.000', scheduled: '0.000', used: '0.000', otherPlans: '0.000', afterNeedDate: '0.000', earlier: '0.000', spare: '0.000' };
  for (const supply of supplies.filter((s) => s.materialId === materialId)) {
    const ton = decMul(supply.ton, '1', TON_DIGITS);
    const usedByShown = takenBy(shown, supply);
    const usedByEarlier = takenBy(earlier, supply);
    if (supply.kind === 'ON_HAND') {
      sum.onHand = decAdd(sum.onHand, ton);
      sum.onHandEarlier = decAdd(sum.onHandEarlier, usedByEarlier);
      continue;
    }
    sum.scheduled = decAdd(sum.scheduled, ton);
    sum.used = decAdd(sum.used, usedByShown);
    sum.earlier = decAdd(sum.earlier, usedByEarlier);
    const rest = decSub(decSub(ton, usedByShown), usedByEarlier);
    if (decCmp(rest, 0) <= 0) continue;
    const ownerPlanId = supply.reservedForPlanId;
    if (ownerPlanId !== null && openPlanIds.has(ownerPlanId) && !target.some((l) => l.planId === ownerPlanId)) sum.otherPlans = decAdd(sum.otherPlans, rest);
    else if (target.length > 0 && !target.some((l) => scheduledUsableBy(supply, l, openPlanIds))) sum.afterNeedDate = decAdd(sum.afterNeedDate, rest);
    else sum.spare = decAdd(sum.spare, rest);
  }
  return {
    onHandTon: sum.onHand,
    usableOnHandTon: decSub(sum.onHand, sum.onHandEarlier),
    onHandEarlierPlansTon: sum.onHandEarlier,
    scheduledTon: sum.scheduled,
    scheduledUsedTon: sum.used,
    scheduledOtherPlansTon: sum.otherPlans,
    scheduledAfterNeedDateTon: sum.afterNeedDate,
    scheduledEarlierPlansTon: sum.earlier,
    scheduledSpareTon: sum.spare,
  };
}
