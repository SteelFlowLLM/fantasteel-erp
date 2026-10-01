// 구매 영역 보충 서비스 (parallel-rules: core 서비스를 고치지 않고 새 파일에 둔다. 병합 단계에서 core mrp.ts의 computeMrp에 합친다).
//
// MRP 기간 계산 (REQ-PRD-005, BP-PRD-01, 업무 프로세스 4.4 "같은 공급을 계획별로 중복 차감하지 않는다").
// core computeMrp는 필요일이 [from, to] 밖인 계획을 차감 전에 빼서
//   (1) 기간 전에 필요한(밀린) 계획이 원료 LOT 잔량·입고예정을 쓰지 않은 것처럼 계산하고
//   (2) 기간 밖 계획 몫(구매요청 품목 production_plan_id)의 입고예정을 다른 수주의 계획이 쓰게 하며
//   (3) 같은 데이터인데 고른 기간에 따라 결과가 달라진다.
// 여기서는 계획·진행중이고 남은 히트가 있는 계획 "전부"를 필요일 순으로 차감한 뒤(앞선 소요가 먼저 쓴다, 열린 계획 몫 입고예정은 그 계획 전용),
// 필요일이 기간 끝(to) 이하인 것만 보인다. 기간 시작(from) 전 계획은 밀린 소요로 함께 보이고 beforePeriod로 표시한다.
import { decCmp, decSum } from '@/lib/decimal';
import { netRequirements, type MrpRequirement, type MrpSupply } from '@/lib/mrp';
import type { MockTables } from '@/mock/schema';
import { findById } from '@/mock/services/context';
import { computeMrp, type MrpMaterialRow, type MrpPlanRow, type MrpView } from '@/mock/services/mrp';

type Tables = Readonly<MockTables>;

/** 모든 필요일을 덮는 기간 (차감은 고른 기간과 관계없이 열린 계획 전부로 한다) */
const ALL_DATES = { from: '0000-01-01', to: '9999-12-31' } as const;

export interface MrpPeriodPlanRow extends MrpPlanRow {
  /** 필요일이 기간 시작 전인 미생산 계획(밀린 소요). 기간 안 계획보다 먼저 잔량·입고예정을 쓴다. */
  beforePeriod: boolean;
}

export interface MrpPeriodView extends Omit<MrpView, 'plans'> {
  plans: MrpPeriodPlanRow[];
}

/** 원료 LOT 잔량 + 확정 발주 미입고량 (core computeMrp와 같은 공급) */
function mrpSuppliesOf(tables: Tables): MrpSupply[] {
  return [
    ...tables.lot
      .filter((l) => l.lotType === 'RAW_MATERIAL' && l.lotStatus === 'AVAILABLE' && l.itemId !== null && l.remainingTon !== null && decCmp(l.remainingTon, 0) > 0)
      .map((l): MrpSupply => ({ kind: 'ON_HAND', materialId: l.itemId ?? 0, availableDate: null, ton: l.remainingTon ?? '0', reservedForPlanId: null, sourceId: l.id })),
    ...tables.purchaseOrderItem
      .filter((line) => decCmp(line.scheduledReceiptTon, 0) > 0)
      .flatMap((line): MrpSupply[] => {
        const purchaseOrder = findById(tables, 'purchaseOrder', line.purchaseOrderId);
        if (!purchaseOrder || purchaseOrder.purchaseOrderStatus === 'RECEIVED') return [];
        const planId = findById(tables, 'purchaseRequisitionItem', line.purchaseRequisitionItemId)?.productionPlanId ?? null;
        return [{ kind: 'SCHEDULED', materialId: line.itemId, availableDate: purchaseOrder.dueDate, ton: line.scheduledReceiptTon, reservedForPlanId: planId, sourceId: line.id }];
      }),
  ];
}

/** 기간 MRP: 열린 계획 전부로 시점별 차감 → 필요일 ≤ to 만 보인다 (from 전 = 밀린 소요, beforePeriod) */
export function computeMrpForPeriod(tables: Tables, period: { from: string; to: string }): MrpPeriodView {
  // 계획 행·계획별 순소요·구매요청 줄은 열린 계획 전부를 넣은 core 계산 그대로 쓴다 (차감 순서 = 필요일 → 계획 id → 원료 id)
  const all = computeMrp(tables, ALL_DATES);
  const visible = (needDate: string): boolean => needDate <= period.to;
  const plans: MrpPeriodPlanRow[] = all.plans.filter((p) => visible(p.needDate)).map((p) => ({ ...p, beforePeriod: p.needDate < period.from }));

  // 원료별 "잔량·입고예정으로 채운 톤"은 줄 단위 차감 결과가 필요해 같은 소요·공급으로 다시 차감한다(순서가 같아 결과도 core와 같다).
  const requirements: MrpRequirement[] = all.plans.flatMap((p) =>
    p.materials.map((m) => ({ planId: p.productionPlanId, materialId: m.itemId, needDate: p.needDate, grossTon: m.grossTon })),
  );
  const shownLines = netRequirements(requirements, mrpSuppliesOf(tables)).lines.filter((l) => visible(l.needDate));

  const materials: MrpMaterialRow[] = all.materials.map((row) => {
    const mine = shownLines.filter((l) => l.materialId === row.itemId);
    const shortageDates = mine.filter((l) => decCmp(l.netTon, 0) > 0).map((l) => l.needDate).sort();
    return {
      ...row,
      grossTon: decSum(mine.map((l) => l.grossTon)),
      coveredOnHandTon: decSum(mine.map((l) => l.coveredOnHandTon)),
      coveredScheduledTon: decSum(mine.map((l) => l.coveredScheduledTon)),
      netTon: decSum(mine.map((l) => l.netTon)),
      firstShortageDate: shortageDates[0] ?? null,
    };
  });

  return {
    from: period.from,
    to: period.to,
    heatCapacityTon: all.heatCapacityTon,
    plans,
    materials,
    requisitionLines: all.requisitionLines.filter((l) => visible(l.needDate)),
  };
}
