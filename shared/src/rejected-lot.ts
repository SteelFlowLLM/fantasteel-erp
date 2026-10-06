// 불합격 LOT 응답 타입 (docs/backend/quality.md, TRM-078·079). 서버 매퍼와 화면이 함께 쓴다.
import type { DispositionStatus, InspectionResult } from './codes';
import type { InspectedLotSummary } from './quality';

/**
 * 불합격 LOT 목록의 한 행 (GET /quality-inspections/rejected-lots, API-123).
 * 자기 검사 FAIL이면 inspectionResult = FAIL, 불합격 히트의 하위 LOT이면 heatInspectionResult = FAIL (TRM-078)
 */
export interface RejectedLotListItem extends InspectedLotSummary {
  /** 자기 검사 행. 아직 없으면 null */
  qualityInspectionId: number | null;
  /** 자기 검사 판정. 검사 행이 없으면 null */
  inspectionResult: InspectionResult | null;
  /** 불합격 처리 상태 (DISPOSITION_STATUS). 지정 전이면 null(미지정) */
  dispositionStatus: DispositionStatus | null;
  dispositionReason: string | null;
}
