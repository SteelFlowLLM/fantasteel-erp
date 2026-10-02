// 품질 모듈 응답 타입 (docs/backend/quality.md). 서버 매퍼와 화면이 함께 쓴다.
import type { InspectionResult, LotType, ProcessType } from './codes';

/** 검사 목록 구분 (API-125): pending = 검사 대기, done = 판정 끝(PASS·FAIL) */
export const QUALITY_INSPECTION_LIST_STATUS = {
  PENDING: 'pending',
  DONE: 'done',
} as const;
export type QualityInspectionListStatus =
  (typeof QUALITY_INSPECTION_LIST_STATUS)[keyof typeof QUALITY_INSPECTION_LIST_STATUS];

/** 검사 대기·검사 목록의 한 행 (GET /quality-inspections) */
export interface QualityInspectionListItem {
  /** 검사 행이 아직 없는 검사 대기 LOT이면 null */
  qualityInspectionId: number | null;
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
  /** 검사 행이 있으면 판정에 쓴 기준, 없으면 지금 적용될 최신 버전. 기준이 없으면 null */
  inspectionStandardId: number | null;
  inspectionStandardCode: string | null;
  versionNo: number | null;
  /** 검사 행이 없으면 null */
  inspectionResult: InspectionResult | null;
  /** ISO 8601. 검사 행이 없으면 null */
  inspectedAt: string | null;
}
