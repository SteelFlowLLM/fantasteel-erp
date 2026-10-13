// 검사 기준 화면 그리기 테스트의 고정 데이터: 공정마다 기준 하나인 목록과 제강 기준 상세(SS275 히트 성분, KS 상한).
// 가짜 DB 시드를 읽지 않는다. 값은 서버 시드의 검사 기준 v1 모양을 따른다(docs/backend/seed.md).
import type { InspectionStandardDetailView, InspectionStandardItemView, InspectionStandardSummaryView } from '@/api/inspectionStandards';

const summary = (id: number, processType: InspectionStandardSummaryView['processType'], suffix: string, version: number, itemCount: number): InspectionStandardSummaryView => ({
  id,
  inspectionStandardCode: `QS-SS275-${suffix}`,
  version,
  processType,
  steelGradeId: 1,
  steelGradeCode: 'SS275',
  itemCount,
  versionCount: version,
  createdAt: '2026-10-01T00:00:00.000Z',
});

/** 검사 기준 목록: 열연 → 제강 → 연주 순으로 섞어 두어 화면이 공정 순서로 묶는지 본다 */
export const STANDARD_SUMMARIES: readonly InspectionStandardSummaryView[] = [
  summary(3, 'HOT_ROLLING', 'HR', 1, 5),
  summary(1, 'STEELMAKING', 'ST', 1, 2),
  summary(2, 'CONTINUOUS_CASTING', 'CC', 2, 3),
];

const item = (id: number, inspectionItemCode: string, inspectionItemName: string, maxValue: string): InspectionStandardItemView => ({
  id,
  inspectionItemCode,
  inspectionItemName,
  unit: '%',
  minValue: null,
  maxValue,
  minThicknessMm: null,
  maxThicknessMm: null,
  isRequired: true,
  sortOrder: id,
});

/** 제강 기준 상세: 모든 항목이 최소 없음·전체 두께·필수·KS라 최대만 다르다 */
export function steelmakingStandardDetail(): InspectionStandardDetailView {
  return {
    ...summary(1, 'STEELMAKING', 'ST', 1, 2),
    isCurrent: true,
    standardNo: 'KS D 3503:2026',
    items: [item(11, 'P', '인(P)', '0.050'), item(12, 'S', '황(S)', '0.050')],
    previousItems: null,
    versions: [{ id: 1, version: 1, isCurrent: true, createdAt: '2026-10-01T00:00:00.000Z', itemCount: 2, inspectionCount: 0 }],
    currentId: 1,
    inspectionCount: 0,
  };
}
