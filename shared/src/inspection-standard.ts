// 검사 기준 응답 타입 (docs/backend/quality.md, TRM-110·075). 서버 매퍼와 화면이 함께 쓴다.
import type { ProcessType } from './codes';

/** 검사 기준의 항목 한 줄 (inspection_standard_item). 제강 기준의 항목이 강종 성분 규격(TRM-020) */
export interface InspectionStandardItemView {
  inspectionStandardItemId: number;
  inspectionItemCode: string;
  inspectionItemName: string;
  unit: string | null;
  /** 이상 (경계 포함). 소수 4자리 문자열 */
  minValue: string | null;
  /** 이하 (경계 포함). 소수 4자리 문자열 */
  maxValue: string | null;
  /** 적용 두께 초과 (mm, 소수 2자리). 둘 다 null이면 모든 두께에 적용 */
  thicknessOverMm: string | null;
  /** 적용 두께 이하 (mm, 소수 2자리) */
  thicknessUptoMm: string | null;
  isRequired: boolean;
}

/** 검사 기준 목록의 한 행 (GET /inspection-standards, API-221). 공정·강종마다 최신 버전 하나 */
export interface InspectionStandardListItem {
  inspectionStandardId: number;
  inspectionStandardCode: string;
  versionNo: number;
  processType: ProcessType;
  steelGradeId: number;
  steelGradeCode: string;
  /** 이 버전을 만든 시각. ISO 8601 */
  createdAt: string;
  /** 등록 순서(id). ERD에 표시 순서 컬럼이 없다 */
  items: InspectionStandardItemView[];
}

/** 검사 기준 상세 (GET /inspection-standards/:id, API-120): 기준 버전 1건과 항목. 옛 버전도 같은 모양 */
export type InspectionStandardDetail = InspectionStandardListItem;

/** 검사 기준 삭제 결과 (DELETE /inspection-standards/:id): 지운 기준 코드와 그 코드의 모든 버전 */
export interface InspectionStandardDeleteResult {
  inspectionStandardCode: string;
  deletedVersionNos: number[];
}
