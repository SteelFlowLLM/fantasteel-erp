import {
  LOT_TYPE,
  PROCESS_TYPE,
  type InspectionResult,
  type LotType,
  type ProcessType,
  type QualityInspectionListItem,
} from '@fantasteel/shared';
import type { QualityInspectionListLot } from './quality.repository';

/** LOT 유형 → 검사 공정 (quality.md 4장 "기준 고르기", REQ-QC-001) */
export const INSPECTION_PROCESS_BY_LOT_TYPE = {
  [LOT_TYPE.HEAT]: PROCESS_TYPE.STEELMAKING,
  [LOT_TYPE.SLAB]: PROCESS_TYPE.CONTINUOUS_CASTING,
  [LOT_TYPE.COIL]: PROCESS_TYPE.HOT_ROLLING,
} as const satisfies Partial<Record<LotType, ProcessType>>;

export type InspectedLotType = keyof typeof INSPECTION_PROCESS_BY_LOT_TYPE;
export const INSPECTED_LOT_TYPES = Object.keys(INSPECTION_PROCESS_BY_LOT_TYPE) as InspectedLotType[];

export function lotTypesForProcess(processType?: ProcessType): InspectedLotType[] {
  if (!processType) return INSPECTED_LOT_TYPES;
  return INSPECTED_LOT_TYPES.filter((lotType) => INSPECTION_PROCESS_BY_LOT_TYPE[lotType] === processType);
}

export interface InspectionStandardVersion {
  id: number;
  inspectionStandardCode: string;
  versionNo: number;
  processType: string;
  steelGradeId: number;
}

const standardKey = (processType: string, steelGradeId: number) => `${processType}:${steelGradeId}`;

/** 공정·강종마다 최신 버전 하나 (quality.md 4장: "그 공정·강종의 최신 버전을 쓴다") */
export function pickLatestStandards(standards: InspectionStandardVersion[]): Map<string, InspectionStandardVersion> {
  const latest = new Map<string, InspectionStandardVersion>();
  for (const standard of standards) {
    const key = standardKey(standard.processType, standard.steelGradeId);
    const current = latest.get(key);
    if (!current || standard.versionNo > current.versionNo || (standard.versionNo === current.versionNo && standard.id > current.id)) {
      latest.set(key, standard);
    }
  }
  return latest;
}

/** 히트는 자기 강종, 슬래브·코일은 규격의 강종 (quality.md 4장) */
function steelGradeOf(lot: QualityInspectionListLot) {
  return lot.lotType === LOT_TYPE.HEAT ? lot.steelGrade : (lot.item?.steelGrade ?? null);
}

/** 슬래브는 부모 히트, 코일은 부모 슬래브의 부모 히트 */
function heatOf(lot: QualityInspectionListLot) {
  for (const { parentLot } of lot.lotRelationsAsChildLot) {
    if (parentLot.lotType === LOT_TYPE.HEAT) return parentLot;
    if (parentLot.lotType === LOT_TYPE.SLAB) {
      const heat = parentLot.lotRelationsAsChildLot[0]?.parentLot;
      if (heat) return heat;
    }
  }
  return null;
}

export function toQualityInspectionListItem(
  lot: QualityInspectionListLot,
  latestStandards: Map<string, InspectionStandardVersion>,
): QualityInspectionListItem {
  const processType = INSPECTION_PROCESS_BY_LOT_TYPE[lot.lotType as InspectedLotType];
  const steelGrade = steelGradeOf(lot);
  const heat = lot.lotType === LOT_TYPE.HEAT ? null : heatOf(lot);
  const inspection = lot.qualityInspection;
  const standard =
    inspection?.inspectionStandard ?? (steelGrade ? latestStandards.get(standardKey(processType, steelGrade.id)) : undefined) ?? null;

  return {
    qualityInspectionId: inspection?.id ?? null,
    lotId: lot.id,
    lotNo: lot.lotNo,
    lotType: lot.lotType as LotType,
    processType,
    steelGradeId: steelGrade?.id ?? null,
    steelGradeCode: steelGrade?.steelGradeCode ?? null,
    thicknessMm: lot.item?.thicknessMm?.toFixed(2) ?? null,
    heatLotId: heat?.id ?? null,
    heatLotNo: heat?.lotNo ?? null,
    heatInspectionResult: (heat?.qualityInspection?.inspectionResult as InspectionResult | undefined) ?? null,
    inspectionStandardId: standard?.id ?? null,
    inspectionStandardCode: standard?.inspectionStandardCode ?? null,
    versionNo: standard?.versionNo ?? null,
    inspectionResult: (inspection?.inspectionResult as InspectionResult | undefined) ?? null,
    inspectedAt: inspection?.inspectedAt.toISOString() ?? null,
  };
}
