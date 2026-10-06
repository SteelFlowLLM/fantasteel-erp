// 품질 모듈 응답 타입 (docs/backend/quality.md). 서버 매퍼와 화면이 함께 쓴다.
import type { InspectionResult, LotType, ProcessType } from './codes';

/** 검사 목록 구분 (API-125): pending = 검사 대기, done = 판정 끝(PASS·FAIL) */
export const QUALITY_INSPECTION_LIST_STATUS = {
  PENDING: 'pending',
  DONE: 'done',
} as const;
export type QualityInspectionListStatus =
  (typeof QUALITY_INSPECTION_LIST_STATUS)[keyof typeof QUALITY_INSPECTION_LIST_STATUS];

/** 검사 대상 LOT 정보. 목록·상세가 같이 쓴다 */
export interface InspectedLotSummary {
  lotId: number;
  lotNo: string;
  lotType: LotType;
  processType: ProcessType;
  steelGradeId: number | null;
  steelGradeCode: string | null;
  /** 규격 두께(mm, 소수 2자리 문자열). 히트는 두께가 없어 null */
  thicknessMm: string | null;
  /** 상위 히트. 히트 자신이면 null */
  heatLotId: number | null;
  heatLotNo: string | null;
  /** 상위 히트의 판정. 히트 검사 행이 없으면 null */
  heatInspectionResult: InspectionResult | null;
}

/** 검사 대기·검사 목록의 한 행 (GET /quality-inspections) */
export interface QualityInspectionListItem extends InspectedLotSummary {
  /** 검사 행이 아직 없는 검사 대기 LOT이면 null */
  qualityInspectionId: number | null;
  /** 검사 행이 있으면 판정에 쓴 기준, 없으면 지금 적용될 최신 버전. 기준이 없으면 null */
  inspectionStandardId: number | null;
  inspectionStandardCode: string | null;
  versionNo: number | null;
  /** 검사 행이 없으면 null */
  inspectionResult: InspectionResult | null;
  /** ISO 8601. 검사 행이 없으면 null */
  inspectedAt: string | null;
}

/** 검사 상세의 항목 한 줄. 판정에 쓴 기준 버전의 항목 중 LOT 두께에 적용되는 것만 */
export interface QualityInspectionDetailItem {
  inspectionStandardItemId: number;
  inspectionItemCode: string;
  inspectionItemName: string;
  unit: string | null;
  /** 이상 (경계 포함). 소수 4자리 문자열 */
  minValue: string | null;
  /** 이하 (경계 포함). 소수 4자리 문자열 */
  maxValue: string | null;
  /** 적용 두께 초과 (mm, 소수 2자리) */
  thicknessOverMm: string | null;
  /** 적용 두께 이하 (mm, 소수 2자리) */
  thicknessUptoMm: string | null;
  isRequired: boolean;
  /** 소수 4자리 문자열. 미입력이면 null */
  measuredValue: string | null;
  /** 항목 판정. 미입력이면 null (저장하지 않고 계산) */
  isPassed: boolean | null;
}

/** 검사 상세 (GET /quality-inspections/:id, API-116) */
export interface QualityInspectionDetail extends InspectedLotSummary {
  qualityInspectionId: number;
  /** 판정에 쓴 기준 버전 */
  inspectionStandardId: number;
  inspectionStandardCode: string;
  versionNo: number;
  inspectionResult: InspectionResult;
  inspectorEmployeeId: number;
  inspectorEmployeeName: string;
  /** ISO 8601 */
  inspectedAt: string;
  /** ISO 8601. 측정값 수정(PATCH) 때 expectedUpdatedAt으로 돌려보낸다 */
  updatedAt: string;
  items: QualityInspectionDetailItem[];
}

/**
 * 판정 뒤 재고 반영 결과 (검사 등록·측정값 수정 응답). 히트면 하위 슬래브·코일까지 합친 값이다.
 * 측정값을 고쳐도 판정이 그대로면 재고를 다시 맞추지 않아 모두 0이다.
 */
export interface InspectionStockSync {
  /** 적격이 되어 합격 재고에 들어간 매수 */
  eligibleAddedQty: number;
  /** 그중 원래 수주 품목에 자동 예약한 매수. 나머지는 여재 */
  autoReservedQty: number;
  /** 적격에서 빠져 합격 재고에서 나간 매수 */
  eligibleRemovedQty: number;
  /** 가용이 줄어 해제한 예약 매수 */
  releasedReservationQty: number;
  /** 해제한 확정 배정 수 */
  releasedAllocationCount: number;
}

/** 검사 등록·측정값 수정 응답 (POST·PATCH /quality-inspections): 검사 상세 + 판정 뒤 재고 반영 결과 */
export interface QualityInspectionSaveResult extends QualityInspectionDetail {
  stockSync: InspectionStockSync;
}
