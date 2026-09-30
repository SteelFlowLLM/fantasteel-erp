// 검사·자동 판정·불합격 처리 API — docs/api/quality.md 의 모양 그대로.
// Decimal(기준·측정값)은 문자열, 시각은 ISO 문자열이다.
import type { DispositionStatus } from '@fantasteel/shared';
import { api } from './client';

export type InspectionProcessCode = 'STEELMAKING' | 'CASTING' | 'HOT_ROLLING';
export type InspectionLotType = 'HEAT' | 'SLAB' | 'COIL';

export interface InspectionLot {
  id: number;
  lotNo: string;
  lotType: InspectionLotType;
  /** "히트" | "슬래브" | "코일" */
  lotTypeName: string;
  lotStatus: 'IN_STOCK' | 'CONSUMED' | 'SHIPPED';
  /** null = 검사 전 */
  isPassed: boolean | null;
  steelGradeId: number | null;
  steelGradeCode: string | null;
  /** 히트는 null */
  productSpecId: number | null;
  specCode: string | null;
  /** 슬래브·코일의 상위 히트 (히트 자신은 null) */
  heatLotId: number | null;
  heatLotNo: string | null;
  /** 상위 히트 성분 검사 결과. null = 아직 판정 전 (또는 히트 자신) */
  heatIsPassed: boolean | null;
  productionPlanId: number | null;
  productionPlanNo: string | null;
  /** LOT의 수주 품목. 히트처럼 LOT에 없으면 생산계획의 수주 품목 */
  salesOrderItemId: number | null;
  salesOrderId: number | null;
  salesOrderNo: string | null;
  customerName: string | null;
  producedAt: string;
}

/** 측정할 항목 1개와 기준 */
export interface InspectionSpecItem {
  inspectionItemCode: string;
  inspectionItemName: string;
  unit: string | null;
  /** null = 하한 없음 */
  minValue: string | null;
  /** null = 상한 없음 */
  maxValue: string | null;
  isRequired: boolean;
  sortOrder: number;
}

/** GET /quality-inspections?status=pending 의 한 줄 */
export interface PendingInspection {
  inspectionResult: 'PENDING';
  processCode: InspectionProcessCode;
  /** "성분 검사" | "슬래브 검사" | "코일 검사" */
  inspectionName: string;
  lot: InspectionLot;
  items: InspectionSpecItem[];
}

export interface InspectionValue {
  inspectionItemCode: string;
  inspectionItemName: string;
  unit: string | null;
  minValue: string | null;
  maxValue: string | null;
  /** 입력하지 않은 선택 항목은 null */
  measuredValue: string | null;
  /** 입력하지 않은 선택 항목은 null */
  isPassed: boolean | null;
  sortOrder: number;
}

/** 등록된 검사. 판정에 쓴 기준이 값과 함께 저장돼 있다. */
export interface Inspection {
  id: number;
  qualityInspectionNo: string;
  processCode: InspectionProcessCode;
  inspectionName: string;
  inspectionResult: 'PASS' | 'FAIL';
  /** null = 시스템(실적 시뮬레이션·시드) */
  inspectorEmployeeId: number | null;
  inspectorEmployeeName: string | null;
  inspectedAt: string;
  memo: string | null;
  lot: InspectionLot;
  values: InspectionValue[];
}

export interface RegisterInspectionBody {
  lotId: number;
  /** 1개 이상. 숫자, 소수 4자리까지 */
  values: { inspectionItemCode: string; measuredValue: number | string }[];
  memo?: string;
}

export interface RejectedFailedItem {
  inspectionItemCode: string;
  inspectionItemName: string;
  unit: string | null;
  minValue: string | null;
  maxValue: string | null;
  measuredValue: string | null;
}

export interface RejectedLot {
  id: number;
  lotNo: string;
  lotType: InspectionLotType;
  lotStatus: string;
  /** 히트 때문에 못 쓰는 LOT은 true(자기 검사는 합격)나 null(검사 전)일 수 있다 */
  isPassed: boolean | null;
  /** OWN = 자기 검사 불합격, HEAT = 상위 히트 성분 불합격으로 사용 불가 */
  rejectedBy: 'OWN' | 'HEAT';
  steelGradeCode: string | null;
  specCode: string | null;
  heatLotId: number | null;
  heatLotNo: string | null;
  productionPlanId: number | null;
  productionPlanNo: string | null;
  /** 불합격의 근거가 된 검사. rejectedBy = HEAT 이면 상위 히트의 성분 검사 */
  failedInspection: {
    id: number;
    qualityInspectionNo: string;
    processCode: InspectionProcessCode;
    inspectedAt: string;
    failedItems: RejectedFailedItem[];
  } | null;
  /** null = 미지정 */
  dispositionStatus: DispositionStatus | null;
  dispositionReason: string | null;
  dispositionAt: string | null;
  /** 영향받는 수주 품목: LOT의 수주 품목, 없으면(히트 등) 생산계획의 수주 품목 */
  affectedSalesOrderItem: {
    salesOrderItemId: number;
    salesOrderId: number;
    salesOrderNo: string;
    lineNo: number;
    customerName: string;
    dueDate: string;
    orderedQty: number;
    salesOrderItemStatus: string;
  } | null;
  /** 그 수주 품목에 취소되지 않은 재생산 계획이 있는지 (가장 최근 것) */
  hasReproductionPlan: boolean;
  reproductionPlan: { id: number; productionPlanNo: string; productionPlanStatus: string; shortageQty: number } | null;
  producedAt: string;
}

export interface SetDispositionBody {
  dispositionStatus: DispositionStatus;
  /** 필수, 500자 이내 */
  reason: string;
}

export const qualityApi = {
  /** 검사 대기 LOT (생산 시각 순) */
  pending: () => api.get<PendingInspection[]>('/quality-inspections', { status: 'pending' }),
  /** 등록된 검사 (검사 시각 최신순, 최대 300건). lotId를 주면 그 LOT의 검사만 */
  done: (q: { processCode?: InspectionProcessCode; lotId?: number } = {}) => api.get<Inspection[]>('/quality-inspections', { status: 'done', ...q }),
  get: (id: number) => api.get<Inspection>(`/quality-inspections/${id}`),
  /** 측정값 등록 → 시스템이 자동 판정한다 (201) */
  register: (body: RegisterInspectionBody) => api.post<Inspection>('/quality-inspections', body),
  /** GET /lots/rejected 와 같은 응답. /lots/:id 에 가려지지 않는 이 경로를 쓴다. */
  rejectedLots: () => api.get<RejectedLot[]>('/quality-inspections/rejected-lots'),
  setDisposition: ({ lotId, ...body }: SetDispositionBody & { lotId: number }) => api.post<RejectedLot>(`/lots/${lotId}/disposition`, body),
};
