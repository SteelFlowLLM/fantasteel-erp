import {
  calcWeightTon,
  INSPECTION_RESULT_LABEL,
  LOT_STATUS_LABEL,
  LOT_TYPE_LABEL,
  RAW_MATERIAL_TYPE_LABEL,
  type InspectionResult,
  type LotStatus,
  type LotType,
} from '@fantasteel/shared';
import type { LotInspectionSummary } from './lot.types';
import type { LotViewRow } from './lot.repository';

/** 목록·상세·추적 노드가 공통으로 쓰는 LOT 필드. */
export type LotCore = Pick<
  LotViewRow,
  'id' | 'lotNo' | 'lotType' | 'lotStatus' | 'isPassed' | 'rawMaterial' | 'productSpec' | 'steelGrade' | 'heatLot' | 'qualityInspections' | 'blastFurnaceNo' | 'converterNo' | 'initialTon' | 'remainingTon' | 'producedAt'
>;

export const lotTypeLabel = (t: string): string => LOT_TYPE_LABEL[t as LotType] ?? t;
export const lotStatusLabel = (s: string): string => LOT_STATUS_LABEL[s as LotStatus] ?? s;

/** 히트·슬래브·코일만 검사 대상이다. */
export const isInspectable = (lotType: string): boolean => lotType === 'HEAT' || lotType === 'SLAB' || lotType === 'COIL';
export const isProduct = (lotType: string): boolean => lotType === 'SLAB' || lotType === 'COIL';

export function inspectionResultOf(lot: Pick<LotCore, 'lotType' | 'isPassed'>): InspectionResult | null {
  if (!isInspectable(lot.lotType)) return null;
  if (lot.isPassed === null) return 'PENDING';
  return lot.isPassed ? 'PASS' : 'FAIL';
}

export const inspectionResultLabel = (r: InspectionResult | null): string | null => (r ? INSPECTION_RESULT_LABEL[r] : null);

export function toInspectionSummary(lot: Pick<LotCore, 'qualityInspections'>): LotInspectionSummary | null {
  const qi = lot.qualityInspections[0];
  if (!qi) return null;
  const result = qi.inspectionResult as InspectionResult;
  return {
    qualityInspectionId: qi.id,
    qualityInspectionNo: qi.qualityInspectionNo,
    processCode: qi.processCode,
    result,
    resultLabel: INSPECTION_RESULT_LABEL[result] ?? result,
    inspectedAt: qi.inspectedAt,
    itemCount: qi.values.length,
    failedItemCount: qi.values.filter((v) => v.isPassed === false).length,
  };
}

/** 슬래브·코일 1개 = 규격 1매(개) 이론중량 (REQ-SO-002 계산값). */
export function weightTonOf(lot: Pick<LotCore, 'lotType' | 'productSpec'>): string | null {
  if (!isProduct(lot.lotType) || !lot.productSpec) return null;
  return calcWeightTon(1, lot.productSpec.theoreticalWeightTon.toString());
}

/** 화면 한 줄 표시용 이름. 번호를 파싱하지 않고 컬럼 값으로 만든다. */
export function lotTitle(lot: Pick<LotCore, 'lotType' | 'rawMaterial' | 'productSpec' | 'steelGrade' | 'blastFurnaceNo' | 'converterNo'>): string {
  switch (lot.lotType) {
    case 'RAW_MATERIAL':
      return lot.rawMaterial ? `${lot.rawMaterial.item.itemName} (${lot.rawMaterial.materialCode})` : '원료';
    case 'HOT_METAL':
      return lot.blastFurnaceNo ? `용선 · ${lot.blastFurnaceNo}고로` : '용선';
    case 'HEAT':
      return `히트${lot.converterNo ? ` · ${lot.converterNo}전로` : ''}${lot.steelGrade ? ` · ${lot.steelGrade.steelGradeCode}` : ''}`;
    default:
      return [lot.steelGrade?.steelGradeCode, lot.productSpec?.specCode].filter(Boolean).join(' · ') || lotTypeLabel(lot.lotType);
  }
}

export const rawMaterialTypeLabel = (t: string): string => RAW_MATERIAL_TYPE_LABEL[t as keyof typeof RAW_MATERIAL_TYPE_LABEL] ?? t;
