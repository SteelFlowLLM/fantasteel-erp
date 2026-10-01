// 밀시트 종이 계산 (순수 함수, Vitest). 저장된 스냅샷만 쓴다 (REQ-SHP-003).
import type { MillSheetInspectionSnapshot, MillSheetItemSnapshot, MillSheetLotSnapshot } from '@/api/millSheets';

export type InspectionValueSnapshot = MillSheetInspectionSnapshot['values'][number];

/** 판정 기준: "0.10~0.25" / "≤0.25" / "≥270" / "—" (경계 포함) */
export function rangeText(minValue: string | null, maxValue: string | null): string {
  if (minValue !== null && maxValue !== null) return `${minValue}~${maxValue}`;
  if (maxValue !== null) return `≤${maxValue}`;
  if (minValue !== null) return `≥${minValue}`;
  return '—';
}

/** 검사 항목(열): 여러 검사의 항목을 나온 순서대로 모은다. 기준은 그 항목이 처음 나온 검사의 값. */
export function inspectionColumns(inspections: readonly (MillSheetInspectionSnapshot | null)[]): InspectionValueSnapshot[] {
  const columns: InspectionValueSnapshot[] = [];
  for (const inspection of inspections) {
    for (const value of inspection?.values ?? []) {
      if (!columns.some((c) => c.inspectionItemCode === value.inspectionItemCode)) columns.push(value);
    }
  }
  return columns;
}

export interface LotRowOnPaper {
  no: number;
  lineNo: number;
  itemCode: string;
  itemType: string;
  lot: MillSheetLotSnapshot;
}

/** 제품 LOT 표의 행 (품목 순서 → LOT 순서, 1부터 번호) */
export function lotRowsOf(items: readonly MillSheetItemSnapshot[]): LotRowOnPaper[] {
  let no = 0;
  return items.flatMap((item) => item.lots.map((lot) => ({ no: ++no, lineNo: item.lineNo, itemCode: item.itemCode, itemType: item.itemType, lot })));
}

/** 제품 검사를 공정별로 묶는다 (슬래브 = 연주 검사, 코일 = 열연 검사). 검사가 없는 LOT은 lotType으로 묶는다. */
export function productInspectionGroups(rows: readonly LotRowOnPaper[]): { processType: string; rows: LotRowOnPaper[] }[] {
  const groups = new Map<string, LotRowOnPaper[]>();
  for (const row of rows) {
    const key = row.lot.productInspection?.processType ?? (row.lot.lotType === 'COIL' ? 'HOT_ROLLING' : 'CONTINUOUS_CASTING');
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([processType, groupRows]) => ({ processType, rows: groupRows }));
}

/** 기준 표시: "QS-SS275-ST v1" */
export function standardText(inspection: MillSheetInspectionSnapshot | null): string {
  if (!inspection?.inspectionStandardCode) return '—';
  return inspection.version === null ? inspection.inspectionStandardCode : `${inspection.inspectionStandardCode} v${inspection.version}`;
}
