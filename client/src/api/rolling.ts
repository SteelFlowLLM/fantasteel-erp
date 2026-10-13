// 열연 투입 배정·열연 실적 API (REQ-PRD-004, REQ-INV-006·008·009, BP-INV-01, 14.2).
// - 코일 계획 → 대응 슬래브 규격·필요 매수. FIFO 추천(생산완료일 → LOT 번호)은 저장하지 않고 확정 때 작업 로그로 남긴다(서버).
// - 판매 ACTIVE 예약 몫은 침범하지 않는다(예약 가용 안에서만). '귀속' 단계는 없다.
// - 배정 확정·변경·해제 = HOT_ROLLING_ALLOCATE 사용 권한. 열연 실적(슬래브 소비 → 코일) = PRODUCTION_RESULT_CONFIRM 사용 권한.
// 서버를 부른다 (api/server/production.ts).
import { type LotStatus, type ProductionPlanStatus } from '@/codes';
import { serverRollingApi } from '@/api/server/production';
import { type LotQuality, type ProductionResultView } from '@/api/production';

export interface RollingLotView {
  lotId: number;
  lotNo: string;
  producedDate: string;
  heatNo: string | null;
  sourcePlanNo: string | null;
  surplusAt: string | null;
}

export interface RollingAllocationView extends RollingLotView {
  allocationId: number;
  confirmedAt: string;
  confirmedEmployeeName: string | null;
}

/** 슬래브 규격의 예약 풀 (4.2) */
export interface ReservationPool {
  itemId: number;
  /** 미소진 합격 제품 매수 */
  eligibleQty: number;
  /** ACTIVE 예약 매수 합계 (= inventory.reserved_qty) */
  activeReservedQty: number;
  /** 열연용 CONFIRMED 배정 매수 (적격 슬래브). 판매 예약과 겹치지 않으므로 모두 예약으로 커버되지 않는 배정이다 */
  hotRollingConfirmedQty: number;
  /** 출하용 CONFIRMED 배정 매수 (ACTIVE 예약의 일부라 다시 빼지 않는다) */
  shipmentConfirmedQty: number;
  /** 예약 가용 = 적격 − ACTIVE 예약 − 열연 배정 (4.2). 불변조건상 0 이상 */
  availableQty: number;
}

export interface RollingPlanView {
  productionPlanId: number;
  productionPlanNo: string;
  productionPlanStatus: ProductionPlanStatus;
  salesOrderNo: string | null;
  dueDate: string | null;
  coilItem: { id: number; itemCode: string; itemName: string; theoreticalWeightTon: string };
  slabItem: { id: number; itemCode: string; itemName: string; theoreticalWeightTon: string };
  shortageQty: number;
  /** 이미 만든 코일 = 합격 + 판정 대기 (불합격·히트 불합격 코일은 세지 않는다) */
  rolledQty: number;
  /** 불합격(히트 불합격 포함) 코일 — 필요 매수에서 빼지 않는다 */
  failedCoilQty: number;
  /** CONFIRMED 열연 배정 */
  allocatedQty: number;
  /** 더 배정해야 할 슬래브 = max(0, 부족 − 코일(불합격 제외) − 배정) */
  neededQty: number;
  /** 슬래브 규격 풀 (예약 가용 = 판매 예약 몫을 뺀 수) */
  slabPool: ReservationPool;
  /** 지금 추천할 수 있는 매수 = min(필요, 예약 가용) */
  recommendableQty: number;
  allocations: RollingAllocationView[];
  /** 수주 연결이 있어야 열연한다 */
  rollable: boolean;
  notRollableReason: string | null;
}

export const rollingKeys = {
  all: ['hot-rolling'] as const,
  plans: () => ['hot-rolling', 'plans'] as const,
  detail: (planId: number) => ['hot-rolling', 'detail', planId] as const,
};

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
  /** 불합격(히트 불합격 포함) 코일 수 — rolledQty에는 들어 있지 않다 */
  failedCoilQty: number;
  allocatedQty: number;
  neededQty: number;
  rollable: boolean;
}

export interface RollingCandidate {
  lotId: number;
  lotNo: string;
  producedDate: string;
  heatNo: string | null;
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
  slabNo: string | null;
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
  plans: (): Promise<RollingPlanListRow[]> => serverRollingApi.plans(),

  /** 코일 계획 하나: 필요 매수·슬래브 풀·FIFO 추천·확정 배정·열연 실적·코일 */
  detail: (productionPlanId: number): Promise<RollingDetail> => serverRollingApi.detail(productionPlanId),

  /** 배정 확정 (HOT_ROLLING CONFIRMED). INV-001 필요·예약 가용 초과 / INV-002 미합격 / INV-003 이미 배정 / INV-004 소진 */
  confirm: (input: ConfirmRollingInput): Promise<{ allocatedQty: number }> => serverRollingApi.confirm(input),

  /** 배정 변경: 기존 배정 해제 + 새 LOT 배정을 한 번에, 사유 필수 (BP-INV-01) */
  change: (input: ChangeRollingInput): Promise<{ allocationId: number }> => serverRollingApi.change(input),

  /** 배정 해제 (소진된 배정은 INV-004) */
  release: (input: { allocationId: number; reasonText?: string | null }): Promise<{ allocationId: number }> => serverRollingApi.release(input),

  /** 열연 실적: 배정 슬래브 소비 → 슬래브 1매 = 코일 1개 `C+슬래브번호`(HT- 제외), 코일 검사 대상 */
  registerHotRolling: (input: HotRollingResultInput): Promise<{ productionResultId: number; coilNos: string[] }> => serverRollingApi.registerHotRolling(input),
};

