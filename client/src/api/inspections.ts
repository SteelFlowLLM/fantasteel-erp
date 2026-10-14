// 검사 입력 API (REQ-QC-001·003, REQ-INV-004·007, BP-QC-01, 14.1 4~6단계).
// 서버를 부른다 (api/server/inspections.ts). 권한·판정·자동 예약·여재·히트 불합격 연쇄·재고 반영·작업 로그는 서버가 한다.
import type { TimelineEvent } from '@/api/businessEvents';
import { serverInspectionApi } from '@/api/server/inspections';
import { type InspectionResult, type LotStatus, type LotType, type ProductItemType, type SalesOrderItemStatus } from '@/codes';
import type { ItemShortage } from '@/lib/inventoryMath';

export const inspectionKeys = {
  all: ['quality-inspections'] as const,
  queue: () => ['quality-inspections', 'queue'] as const,
  detail: (lotId: number) => ['quality-inspections', 'detail', lotId] as const,
};

export interface InspectionQueueRow {
  lotId: number;
  lotNo: string;
  lotType: LotType;
  lotStatus: LotStatus;
  processType: string;
  itemId: number | null;
  itemCode: string | null;
  itemName: string | null;
  steelGradeCode: string | null;
  thicknessMm: string | null;
  producedDate: string;
  heatLotId: number | null;
  heatNo: string | null;
  heatResult: InspectionResult | null;
  productionPlanNo: string | null;
  qualityInspectionId: number | null;
  inspectionResult: InspectionResult;
  inspectionStandardCode: string | null;
  inspectionStandardVersion: number | null;
  inspectedAt: string | null;
  inspectorName: string | null;
  locked: boolean;
}

export interface InspectionFormItem {
  inspectionStandardItemId: number;
  inspectionItemCode: string;
  inspectionItemName: string;
  unit: string | null;
  minValue: string | null;
  maxValue: string | null;
  minThicknessMm: string | null;
  maxThicknessMm: string | null;
  isRequired: boolean;
  sortOrder: number;
  measuredValue: string | null;
  isPassed: boolean | null;
}

export interface InspectionFormView {
  lot: InspectionQueueRow;
  qualityInspectionId: number | null;
  /** 이 검사 행의 수정 시각 (registerInspection의 expectedUpdatedAt) */
  updatedAt: string | null;
  inspectionResult: InspectionResult;
  /** 판정에 쓰는(쓴) 기준 버전. 값을 넣은 적이 없으면 현재 버전 */
  standard: { id: number; inspectionStandardCode: string; version: number; isCurrent: boolean } | null;
  currentStandard: { id: number; inspectionStandardCode: string; version: number } | null;
  /** 두께 구간(초과~이하)으로 거른 적용 항목 (샤르피는 SM 강종·6mm 초과 코일만) */
  items: InspectionFormItem[];
  locked: boolean;
  lockedMillSheetNos: string[];
}

export interface RegisterInspectionInput {
  lotId: number;
  /** 입력한 항목 값. 빈 값(null·'')은 지운다. 넘기지 않은 항목은 그대로 둔다. */
  values: readonly { inspectionStandardItemId: number; measuredValue: string | null }[];
  /** 화면을 연 시점의 quality_inspection.updatedAt (없으면 확인 안 함) */
  expectedUpdatedAt?: string | null;
}

/** 검사 대상 LOT이 만들어진 계획의 수주 품목과 그 부족 (4.5). 재생산 필요 = 14.1-6 */
export interface LinkedSalesOrderItem {
  salesOrderId: number;
  salesOrderNo: string;
  salesOrderItemId: number;
  lineNo: number;
  customerName: string;
  itemCode: string;
  /** 수주 품목의 제품 유형. 매수 단위(슬래브 매 · 코일 개)를 정한다 */
  itemType: ProductItemType;
  orderedQty: number;
  dueDate: string;
  salesOrderItemStatus: SalesOrderItemStatus;
  shortage: ItemShortage;
}

export interface InspectionDetail extends InspectionFormView {
  productionPlanId: number | null;
  heatLotId: number | null;
  salesOrderItem: LinkedSalesOrderItem | null;
  /** 이 LOT의 작업 로그 (시간순) */
  history: TimelineEvent[];
  /** 작업 로그의 검사 등록에 나온 항목 코드 → 검사 항목명 (inspection_standard_item.inspection_item_name) */
  inspectionItemNames: Record<string, string>;
}

export interface RegisterInspectionOutcome {
  lotId: number;
  lotNo: string;
  inspectionResult: InspectionResult;
  /** 원래 수주 품목에 자동 예약한 매수 (SYSTEM) */
  autoReservedQty: number;
  /** 여재로 표시한 LOT 번호 */
  surplusLotNos: string[];
  /** 여재가 된 매수. 서버는 LOT 번호 없이 매수만 준다 */
  surplusQty: number;
  /** 불합격으로 적격에서 빠진 LOT 수 (히트면 하위 슬래브·코일 포함) */
  excludedLotQty: number;
  /** 적격에서 빠진 LOT의 확정 배정을 해제한 건수 */
  releasedAllocationCount: number;
  /** 가용이 줄어 해제한 예약 매수 */
  releasedReservationQty: number;
  salesOrderItem: LinkedSalesOrderItem | null;
}

export const inspectionApi = {
  /** 검사 대상 목록: 판정 대기 먼저(생산완료일 → LOT 번호), 그다음 최근 판정 */
  queue: (): Promise<InspectionQueueRow[]> => serverInspectionApi.queue(),

  /** 입력 폼: 판정에 쓰는 기준 버전, 두께 구간으로 거른 항목, 현재 값, 잠금, 연결 수주의 부족, 작업 로그 */
  detail: (lotId: number): Promise<InspectionDetail> => serverInspectionApi.detail(lotId),

  /**
   * 측정값 등록·수정 (같은 검사 기록). 필수 누락이면 판정 대기, 밀시트 발행 뒤에는 막힌다.
   * 오류: COM-002(검사 입력 사용 권한), COM-003(LOT 없음), COM-001(연 뒤 바뀜), MST-001(검사 기준 없음), 입력 오류(형식·기준에 없는 항목·잠금)
   */
  register: (input: RegisterInspectionInput): Promise<RegisterInspectionOutcome> => serverInspectionApi.register(input),
};

