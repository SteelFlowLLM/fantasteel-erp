// 밀시트 종이 계산 (순수 함수, Vitest). 저장된 스냅샷만 쓴다 (REQ-SHP-003).
import type { MillSheetInspectionSnapshot, MillSheetItemSnapshot, MillSheetLotSnapshot } from '@/api/millSheets';
import { trimNum } from '@/lib/format';

/** 판정 기준: "0.1~0.25" / "≤0.25" / "≥270" / "—" (경계 포함, 측정값처럼 소수 끝의 0은 지운다) */
export function rangeText(minValue: string | null, maxValue: string | null): string {
  if (minValue !== null && maxValue !== null) return `${trimNum(minValue)}~${trimNum(maxValue)}`;
  if (maxValue !== null) return `≤${trimNum(maxValue)}`;
  if (minValue !== null) return `≥${trimNum(minValue)}`;
  return '—';
}

export interface InspectionColumn {
  inspectionItemCode: string;
  inspectionItemName: string;
  unit: string | null;
}

/** 검사 항목(열): 여러 검사의 항목을 나온 순서대로 한 번씩 모은다. 열 머리(이름·단위)만 — 기준은 행 묶음마다 `inspectionRangeGroups`가 만든다. */
export function inspectionColumns(inspections: readonly (MillSheetInspectionSnapshot | null)[]): InspectionColumn[] {
  const columns: InspectionColumn[] = [];
  for (const inspection of inspections) {
    for (const value of inspection?.values ?? []) {
      if (!columns.some((c) => c.inspectionItemCode === value.inspectionItemCode)) {
        columns.push({ inspectionItemCode: value.inspectionItemCode, inspectionItemName: value.inspectionItemName, unit: value.unit });
      }
    }
  }
  return columns;
}

export interface InspectionRangeGroup<T> {
  key: string;
  /** 항목 코드 → 기준 글자 (이 묶음 검사값에 저장된 min/max, 경계 포함). 비어 있으면 기준 행을 그리지 않는다. */
  ranges: Readonly<Record<string, string>>;
  /** 기준 코드 + 버전 */
  standard: string;
  rows: T[];
}

/**
 * 기준이 같은 행끼리 묶는다 (REQ-SHP-003, 14.1-9). 강종이 다르면 성분 기준이(SS275 C ≤0.25 · SM355A C ≤0.20),
 * 코일 두께 구간이 다르면 두께 허용차·항복강도·연신율 기준이 달라서 묶음마다 '기준' 행을 따로 그린다.
 * 기준은 각 검사값 스냅샷의 min/max 그대로다. 묶음 순서 = 처음 나온 순서, 묶음 안 행 순서 = 원래 순서.
 */
export function inspectionRangeGroups<T extends { inspection: MillSheetInspectionSnapshot | null }>(rows: readonly T[]): InspectionRangeGroup<T>[] {
  const groups = new Map<string, InspectionRangeGroup<T>>();
  for (const row of rows) {
    const values = row.inspection?.values ?? [];
    const ranges: Record<string, string> = {};
    for (const v of values) ranges[v.inspectionItemCode] = rangeText(v.minValue, v.maxValue);
    const standard = standardText(row.inspection);
    const key = `${standard}|${Object.entries(ranges)
      .map(([code, range]) => `${code}=${range}`)
      .sort()
      .join(';')}`;
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { key, ranges, standard, rows: [row] });
  }
  return [...groups.values()];
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
