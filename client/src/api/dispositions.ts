// 불합격 관리 API (REQ-QC-004, REQ-INV-007, REQ-PRD-006, BP-QC-01, 14.1-6).
// 불합격 LOT(히트 포함)과 불합격 히트의 하위 LOT에 불합격 상태(보류·격하·폐기)와 사유를 기록한다. 후속 처리(재판정·재작업·폐기 처리)는 없다.
// 재생산 계획은 사람이 만든다(자동 없음): 생산계획·히트 편성 사용 권한이 있어야 한다.
// 목록·상세·상태 지정·재생산 계획은 서버를 부른다 (api/server/dispositions.ts).
import { type InspectionFormView, type LinkedSalesOrderItem } from '@/api/inspections';
import type { TimelineEvent } from '@/api/businessEvents';
import { serverDispositionApi } from '@/api/server/dispositions';
import { type DispositionStatus, type LotStatus, type LotType, type ProductionPlanStatus } from '@/codes';

export interface RejectedLotRow {
  lotId: number;
  lotNo: string;
  lotType: LotType;
  lotStatus: LotStatus;
  /** FAILED = 이 LOT 불합격, HEAT_FAILED = 상위 히트 불합격으로 제외 */
  reason: 'FAILED' | 'HEAT_FAILED';
  itemCode: string | null;
  itemName: string | null;
  steelGradeCode: string | null;
  heatNo: string | null;
  producedDate: string;
  productionPlanNo: string | null;
  inspectedAt: string | null;
  failedItems: { inspectionItemCode: string; inspectionItemName: string; unit: string | null; minValue: string | null; maxValue: string | null; measuredValue: string | null }[];
  dispositionStatus: DispositionStatus | null;
  dispositionReason: string | null;
  dispositionAt: string | null;
  updatedAt: string;
}

export const dispositionKeys = {
  all: ['rejected-lots'] as const,
  list: () => ['rejected-lots', 'list'] as const,
  detail: (lotId: number) => ['rejected-lots', 'detail', lotId] as const,
};

export interface RejectedLotListRow extends RejectedLotRow {
  productionPlanId: number | null;
  salesOrderItem: LinkedSalesOrderItem | null;
}

export interface LinkedPlan {
  productionPlanId: number;
  productionPlanNo: string;
  productionPlanStatus: ProductionPlanStatus;
  isReproduction: boolean;
  shortageQty: number;
}

export interface RejectedLotDetail {
  row: RejectedLotListRow;
  /** 판정 근거 검사: 이 LOT의 검사, 히트 불합격 하위 LOT이면 상위 히트의 성분 검사 */
  evidence: InspectionFormView | null;
  /** 같은 수주 품목의 생산계획 (재생산 포함, 등록 순) */
  plans: LinkedPlan[];
  history: TimelineEvent[];
  /** 작업 로그의 검사 등록에 나온 항목 코드 → 검사 항목명. 하위 LOT이면 근거(히트 성분)와 달리 이 LOT 자신의 검사 항목도 들어 있다 */
  inspectionItemNames: Record<string, string>;
}

export interface SetDispositionInput {
  lotId: number;
  dispositionStatus: DispositionStatus;
  dispositionReason: string;
  /** 화면을 연 시점의 lot.updatedAt */
  expectedUpdatedAt?: string | null;
}

/** 불합격 상태 지정 결과 (서버의 불합격 LOT 목록 행에서 이 값만 쓴다) */
export interface SetDispositionResult {
  lotNo: string;
  dispositionStatus: DispositionStatus | null;
  dispositionReason: string | null;
  /** 다음 지정의 expectedUpdatedAt */
  updatedAt: string;
}

export interface ReproductionOutcome {
  /** 재생산 전에 같은 규격 여재로 예약한 매수 */
  reservedFromSurplusQty: number;
  productionPlanNo: string | null;
  shortageQty: number | null;
}

export const dispositionApi = {
  /** 불합격 LOT 목록 (최근 생산 순) + 영향받는 수주 품목의 부족·재생산 필요 */
  list: (): Promise<RejectedLotListRow[]> => serverDispositionApi.list(),

  /** 불합격 LOT 하나: 근거 검사값, 같은 수주 품목의 계획, 작업 로그. 불합격 목록에 없으면 null */
  detail: (lotId: number): Promise<RejectedLotDetail | null> => serverDispositionApi.detail(lotId),

  /** 불합격 상태 지정 (REQ-QC-004). 오류: COM-002(불합격 처리 상태 지정 사용 권한), COM-003, COM-001, 입력 오류(불합격 LOT 아님·상태·사유 500자) */
  set: (input: SetDispositionInput): Promise<SetDispositionResult> => serverDispositionApi.set(input),

  /**
   * 재생산 계획 만들기 (REQ-PRD-006, 14.1-6). 같은 규격 여재로 먼저 예약하고, 그래도 부족할 때만 is_reproduction 계획.
   * 오류: COM-002(생산계획·히트 편성 사용 권한), COM-003, MST-001(수율·배합 원단위·매핑 누락), 입력 오류(재생산할 매수 없음)
   */
  createReproductionPlan: (input: { salesOrderItemId: number }): Promise<ReproductionOutcome> => serverDispositionApi.createReproductionPlan(input),
};
