import type { InspectionResult, QualityInspectionDetail } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';
import { isItemApplicable, judgeMeasuredValue } from './inspection-judge';
import { toInspectedLotSummary } from './quality-inspection-list';
import type { QualityInspectionDetailRecord } from './quality.repository';

const toValueText = (value: Prisma.Decimal | null) => value?.toFixed(4) ?? null;
const toThicknessText = (value: Prisma.Decimal | null) => value?.toFixed(2) ?? null;

/** 검사 상세 응답 (API-116). 항목은 판정에 쓴 기준 버전에서 LOT 두께에 적용되는 것만 */
export function toQualityInspectionDetail(record: QualityInspectionDetailRecord): QualityInspectionDetail {
  const thicknessMm = record.lot.item?.thicknessMm ?? null;
  const measuredByItemId = new Map(record.qualityInspectionValues.map((v) => [v.inspectionStandardItemId, v.measuredValue]));
  const standard = record.inspectionStandard;

  return {
    ...toInspectedLotSummary(record.lot),
    qualityInspectionId: record.id,
    inspectionStandardId: standard.id,
    inspectionStandardCode: standard.inspectionStandardCode,
    versionNo: standard.versionNo,
    inspectionResult: record.inspectionResult as InspectionResult,
    inspectorEmployeeId: record.inspectorEmployee.id,
    inspectorEmployeeName: record.inspectorEmployee.employeeName,
    inspectedAt: record.inspectedAt.toISOString(),
    items: standard.inspectionStandardItems
      .filter((item) => isItemApplicable(item, thicknessMm))
      .map((item) => {
        const measuredValue = measuredByItemId.get(item.id) ?? null;
        return {
          inspectionStandardItemId: item.id,
          inspectionItemCode: item.inspectionItemCode,
          inspectionItemName: item.inspectionItemName,
          unit: item.unit,
          minValue: toValueText(item.minValue),
          maxValue: toValueText(item.maxValue),
          thicknessOverMm: toThicknessText(item.thicknessOverMm),
          thicknessUptoMm: toThicknessText(item.thicknessUptoMm),
          isRequired: item.isRequired,
          measuredValue: toValueText(measuredValue),
          isPassed: judgeMeasuredValue(item, measuredValue),
        };
      }),
  };
}
