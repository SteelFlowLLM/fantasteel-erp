// 열연 투입 배정·열연 실적 API (REQ-PRD-004, REQ-INV-006·008·009, BP-INV-01, 14.2).
// - 코일 계획 → 대응 슬래브 규격·필요 매수. FIFO 추천(생산완료일 → LOT 번호)은 저장하지 않고 확정 때 작업 로그로 남긴다(core).
// - 판매 ACTIVE 예약 몫은 침범하지 않는다(예약 가용 안에서만). '귀속' 단계는 없다.
// - 배정 확정·변경·해제 = HOT_ROLLING_ALLOCATE 사용 권한. 열연 실적(슬래브 소비 → 코일) = PRODUCTION_RESULT_CONFIRM 사용 권한.
import { PERMISSION, type LotStatus, type ProductionPlanStatus } from '@/codes';
import { mockMutation, mockQuery } from '@/api/client';
import { requireActor } from '@/api/actor';
import { lotQualityOf, type LotQuality } from '@/api/production';
import { sortFifo } from '@/lib/fifo';
import type { MockTables } from '@/mock/schema';
import { assertNoOpenWorkOnCompletion } from '@/mock/services/ext/production';
import {
  changeAllocation,
  confirmRollingAllocations,
  findById,
  heatOf,
  inputError,
  mustGet,
  productionResultViewsOf,
  registerHotRolling,
  releaseAllocation,
  rollingPlanView,
  rollingRecommendation,
  unallocatedEligibleLotsOf,
  userActor,
  type ProductionResultView,
  type RollingAllocationView,
  type RollingPlanView,
} from '@/mock/services';

type Tables = Readonly<MockTables>;

export const rollingKeys = {
  all: ['hot-rolling'] as const,
  plans: () => ['hot-rolling', 'plans'] as const,
  detail: (planId: number) => ['hot-rolling', 'detail', planId] as const,
};

const ROLLING_VIEW = [PERMISSION.HOT_ROLLING_ALLOCATE] as const;
const ROLLING_USE = [PERMISSION.HOT_ROLLING_ALLOCATE] as const;

export interface RollingPlanListRow {
  productionPlanId: number;
  productionPlanNo: string;
  productionPlanStatus: ProductionPlanStatus;
  salesOrderNo: string | null;
  dueDate: string | null;
  coilItemCode: string;
  slabItemCode: string;
  shortageQty: number;
  rolledQty: number;
  allocatedQty: number;
  neededQty: number;
  rollable: boolean;
}

export interface RollingCandidate {
  lotId: number;
  lotNo: string;
  producedDate: string;
  heatLotNo: string | null;
  sourcePlanNo: string | null;
  /** 이 코일 계획이 만든 슬래브인지 */
  isOwnPlan: boolean;
  surplusAt: string | null;
  yardName: string | null;
  /** FIFO 순위 (1부터) */
  fifoRank: number;
  /** 지금 FIFO 추천에 들어가는지 */
  isRecommended: boolean;
}

export interface RolledCoil {
  lotId: number;
  lotNo: string;
  slabLotNo: string | null;
  producedDate: string;
  quality: LotQuality;
  lotStatus: LotStatus;
  hasConfirmedAllocation: boolean;
}

export interface RollingDetail {
  plan: RollingPlanView;
  /** 연결 수주 (수주 상세 링크용, 연결이 없으면 null) */
  salesOrderId: number | null;
  /** 배정할 수 있는 슬래브 전부 (적격·미소진·미배정, FIFO 순) */
  candidates: RollingCandidate[];
  /** 지금 추천 매수 = min(더 필요한 슬래브, 예약 가용) */
  recommendedLotIds: number[];
  /** 이 계획의 확정 배정 중 열연할 수 있는 것(적격) */
  rollableAllocationIds: number[];
  /** 열연 실적 */
  results: ProductionResultView[];
  /** 만든 코일 */
  coils: RolledCoil[];
}

function rollingDetailOf(tables: Tables, planId: number): RollingDetail {
  const plan = rollingPlanView(tables, planId);
  const recommendation = rollingRecommendation(tables, planId);
  const recommended = new Set(recommendation.lots.map((l) => l.lotId));
  const candidates = sortFifo(unallocatedEligibleLotsOf(tables, plan.slabItem.id)).map((lot, index) => ({
    lotId: lot.id,
    lotNo: lot.lotNo,
    producedDate: lot.producedDate,
    heatLotNo: heatOf(tables, lot)?.lotNo ?? null,
    sourcePlanNo: findById(tables, 'productionPlan', lot.productionPlanId)?.productionPlanNo ?? null,
    isOwnPlan: lot.productionPlanId === planId,
    surplusAt: lot.surplusAt,
    yardName: findById(tables, 'yard', lot.yardId)?.yardName ?? null,
    fifoRank: index + 1,
    isRecommended: recommended.has(lot.id),
  }));
  const rollableAllocationIds = plan.allocations
    .filter((a) => {
      const lot = findById(tables, 'lot', a.lotId);
      return lot !== undefined && lot.lotStatus === 'AVAILABLE' && lotQualityOf(lot, heatOf(tables, lot)) === 'PASS';
    })
    .map((a) => a.allocationId);
  const coils = tables.lot
    .filter((l) => l.productionPlanId === planId && l.lotType === 'COIL')
    .sort((a, b) => a.id - b.id)
    .map((coil) => {
      const slabRelation = tables.lotRelation.find((r) => r.childLotId === coil.id);
      return {
        lotId: coil.id,
        lotNo: coil.lotNo,
        slabLotNo: findById(tables, 'lot', slabRelation?.parentLotId)?.lotNo ?? null,
        producedDate: coil.producedDate,
        quality: lotQualityOf(coil, heatOf(tables, coil)),
        lotStatus: coil.lotStatus,
        hasConfirmedAllocation: tables.allocation.some((a) => a.lotId === coil.id && a.allocationStatus === 'CONFIRMED'),
      };
    });
  const planRow = mustGet(tables, 'productionPlan', planId, '생산계획');
  return {
    plan,
    salesOrderId: findById(tables, 'salesOrderItem', planRow.salesOrderItemId)?.salesOrderId ?? null,
    candidates,
    recommendedLotIds: recommendation.lots.map((l) => l.lotId),
    rollableAllocationIds,
    results: productionResultViewsOf(tables, planId).filter((r) => r.processType === 'HOT_ROLLING'),
    coils,
  };
}

/** 이 배정이 열연 배정인지 확인한다 (출하 배정은 출하요청 화면에서 바꾼다) */
function assertHotRollingAllocation(tables: Tables, allocationId: number): void {
  const allocation = mustGet(tables, 'allocation', allocationId, '배정');
  if (allocation.allocationPurpose !== 'HOT_ROLLING') inputError('allocationId', '열연 투입 배정만 이 화면에서 바꿀 수 있어요');
}

export interface ConfirmRollingInput {
  productionPlanId: number;
  lotIds: number[];
}

export interface ChangeRollingInput {
  allocationId: number;
  newLotId: number;
  /** 사유 필수 (ALLOCATION_CHANGED, 사유 ALLOCATION_CHANGE) */
  reasonText: string;
}

export interface HotRollingResultInput {
  productionPlanId: number;
  /** 열연할 배정 (비우면 이 계획의 확정 배정 전부) */
  allocationIds?: number[] | null;
  startedAt: string;
  completedAt: string;
}

export const rollingApi = {
  /** 코일 계획 목록 (최근 것 먼저). 진행 중(계획·진행중)이 먼저 오도록 화면에서 묶는다. */
  plans: (): Promise<RollingPlanListRow[]> =>
    mockQuery((tables) => {
      requireActor(tables, { view: ROLLING_VIEW });
      const rows: RollingPlanListRow[] = [];
      const coilPlans = tables.productionPlan.filter((p) => findById(tables, 'item', p.itemId)?.itemType === 'COIL').sort((a, b) => b.id - a.id);
      for (const p of coilPlans) {
        try {
          const v = rollingPlanView(tables, p.id);
          rows.push({
            productionPlanId: v.productionPlanId,
            productionPlanNo: v.productionPlanNo,
            productionPlanStatus: v.productionPlanStatus,
            salesOrderNo: v.salesOrderNo,
            dueDate: v.dueDate,
            coilItemCode: v.coilItem.itemCode,
            slabItemCode: v.slabItem.itemCode,
            shortageQty: v.shortageQty,
            rolledQty: v.rolledQty,
            allocatedQty: v.allocatedQty,
            neededQty: v.neededQty,
            rollable: v.rollable,
          });
        } catch {
          // 규격 매핑이 없는 계획은 열연 화면에 나오지 않는다 (MST-001은 기준정보 준비 상태에서 보인다)
        }
      }
      return rows;
    }),

  /** 코일 계획 하나: 필요 매수·슬래브 풀·FIFO 추천·확정 배정·열연 실적·코일 */
  detail: (productionPlanId: number): Promise<RollingDetail> =>
    mockQuery((tables) => {
      requireActor(tables, { view: ROLLING_VIEW });
      return rollingDetailOf(tables, productionPlanId);
    }),

  /** 배정 확정 (HOT_ROLLING CONFIRMED). INV-001 필요·예약 가용 초과 / INV-002 미합격 / INV-003 이미 배정 / INV-004 소진 */
  confirm: (input: ConfirmRollingInput): Promise<{ allocatedQty: number }> =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: ROLLING_USE });
      const rows = confirmRollingAllocations(tx, userActor(actor.employee.id), { productionPlanId: input.productionPlanId, lotIds: input.lotIds });
      return { allocatedQty: rows.length };
    }),

  /** 배정 변경: 기존 배정 해제 + 새 LOT 배정을 한 번에, 사유 필수 (BP-INV-01) */
  change: (input: ChangeRollingInput): Promise<{ allocationId: number }> =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: ROLLING_USE });
      assertHotRollingAllocation(tx.tables, input.allocationId);
      const row = changeAllocation(tx, userActor(actor.employee.id), input);
      return { allocationId: row.id };
    }),

  /** 배정 해제 (소진된 배정은 INV-004) */
  release: (input: { allocationId: number; reasonText?: string | null }): Promise<{ allocationId: number }> =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: ROLLING_USE });
      assertHotRollingAllocation(tx.tables, input.allocationId);
      const row = releaseAllocation(tx, userActor(actor.employee.id), { allocationId: input.allocationId, reasonText: input.reasonText?.trim().slice(0, 500) || null });
      return { allocationId: row.id };
    }),

  /** 열연 실적: 배정 슬래브 소비 → 슬래브 1매 = 코일 1개 `C+슬래브번호`(HT- 제외), 코일 검사 대상 */
  registerHotRolling: (input: HotRollingResultInput): Promise<{ productionResultId: number; coilLotNos: string[] }> =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: [PERMISSION.PRODUCTION_RESULT_CONFIRM] });
      const { coilLots, resultId } = registerHotRolling(tx, userActor(actor.employee.id), {
        productionPlanId: input.productionPlanId,
        allocationIds: input.allocationIds && input.allocationIds.length > 0 ? input.allocationIds : null,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
      });
      assertNoOpenWorkOnCompletion(tx.tables, input.productionPlanId);
      return { productionResultId: resultId, coilLotNos: coilLots.map((c) => c.lotNo) };
    }),
};

export type { RollingAllocationView, RollingPlanView };
