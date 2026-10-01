import { describe, expect, it } from 'vitest';
import type { MillSheetInspectionSnapshot, MillSheetItemSnapshot, MillSheetLotSnapshot } from '@/api/millSheets';
import { inspectionColumns, lotRowsOf, productInspectionGroups, rangeText, standardText } from '@/features/millSheets/lib/millSheetView';

const value = (code: string, measured: string, min: string | null, max: string | null) => ({
  inspectionItemCode: code,
  inspectionItemName: code,
  unit: '%',
  minValue: min,
  maxValue: max,
  measuredValue: measured,
  isPassed: true,
});

const inspection = (processType: string, values: ReturnType<typeof value>[]): MillSheetInspectionSnapshot => ({
  lotNo: 'X',
  processType,
  inspectionStandardCode: 'QS-SS275-ST',
  version: 1,
  inspectionResult: 'PASS',
  inspectedAt: null,
  values,
});

const lot = (lotNo: string, lotType: string, productInspection: MillSheetInspectionSnapshot | null): MillSheetLotSnapshot => ({
  lotId: 1,
  lotNo,
  lotType,
  producedDate: '2026-09-05',
  theoreticalWeightTon: '23.550',
  heatLotId: 1,
  heatLotNo: 'HT-BOF1-260905-001',
  slabLotNo: null,
  productInspection,
});

const item = (lineNo: number, lots: MillSheetLotSnapshot[]): MillSheetItemSnapshot => ({
  salesOrderItemId: lineNo,
  lineNo,
  itemId: 1,
  itemCode: 'SL-SS275',
  itemName: 'SS275 슬래브',
  itemType: 'SLAB',
  steelGradeCode: 'SS275',
  standardNo: 'KS D 3503',
  thicknessMm: '250',
  widthMm: '1200',
  lengthMm: '10000',
  theoreticalWeightTon: '23.550',
  qty: lots.length,
  totalWeightTon: '0',
  lots,
});

describe('밀시트 종이 계산', () => {
  it('기준 범위 글자 (경계 포함)', () => {
    expect(rangeText('0.10', '0.25')).toBe('0.10~0.25');
    expect(rangeText(null, '0.25')).toBe('≤0.25');
    expect(rangeText('270', null)).toBe('≥270');
    expect(rangeText(null, null)).toBe('—');
  });

  it('여러 히트의 항목을 나온 순서대로 한 번씩 모은다', () => {
    const a = inspection('STEELMAKING', [value('C', '0.18', null, '0.25'), value('Mn', '1.20', null, '1.60')]);
    const b = inspection('STEELMAKING', [value('C', '0.20', null, '0.25'), value('P', '0.020', null, '0.040')]);
    expect(inspectionColumns([a, null, b]).map((c) => c.inspectionItemCode)).toEqual(['C', 'Mn', 'P']);
  });

  it('제품 LOT 번호 매기기와 공정별 묶음', () => {
    const rows = lotRowsOf([
      item(1, [lot('S-01', 'SLAB', inspection('CONTINUOUS_CASTING', [])), lot('S-02', 'SLAB', null)]),
      item(2, [lot('C-01', 'COIL', inspection('HOT_ROLLING', []))]),
    ]);
    expect(rows.map((r) => [r.no, r.lineNo, r.lot.lotNo])).toEqual([
      [1, 1, 'S-01'],
      [2, 1, 'S-02'],
      [3, 2, 'C-01'],
    ]);
    expect(productInspectionGroups(rows).map((g) => [g.processType, g.rows.length])).toEqual([
      ['CONTINUOUS_CASTING', 2],
      ['HOT_ROLLING', 1],
    ]);
  });

  it('기준 코드와 버전', () => {
    expect(standardText(inspection('STEELMAKING', []))).toBe('QS-SS275-ST v1');
    expect(standardText(null)).toBe('—');
  });
});
