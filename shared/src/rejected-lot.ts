// 불합격 LOT 응답 타입 (docs/backend/quality.md, TRM-078·079). 서버 매퍼와 화면이 함께 쓴다.
import type { DispositionStatus, InspectionResult } from './codes';
import type { InspectedLotSummary, QualityInspectionDetailItem } from './quality';

/** 불합격 근거 검사: 자기 FAIL 검사, 불합격 히트의 하위 LOT이면 상위 히트의 검사 */
export interface RejectedLotEvidence {
  qualityInspectionId: number;
  /** 근거 검사의 LOT (히트 불합격 하위 LOT이면 상위 히트) */
  lotId: number;
  /** ISO 8601 */
  inspectedAt: string;
  /** 기준을 벗어난 항목만 */
  failedItems: QualityInspectionDetailItem[];
}

/**
 * 불합격 LOT 목록의 한 행 (GET /lots/rejected, API-123).
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
  /** LOT의 updated_at (ISO 8601). 처리 상태 지정(POST /lots/:id/disposition) 때 expectedUpdatedAt으로 돌려보낸다 */
  updatedAt: string;
  /** 근거 검사. 근거 검사 행이 없으면 null */
  evidence: RejectedLotEvidence | null;
}
