import { describe, expect, it } from 'vitest';
import type { MillSheetInspectionSnapshot, MillSheetItemSnapshot, MillSheetLotSnapshot } from '@/api/millSheets';
import { inspectionColumns, inspectionRangeGroups, lotRowsOf, productInspectionGroups, rangeText, standardText } from '@/features/millSheets/lib/millSheetView';

const value = (code: string, measured: string, min: string | null, max: string | null) => ({
  inspectionItemCode: code,
  inspectionItemName: code,
  unit: '%',
  minValue: min,
  maxValue: max,
  measuredValue: measured,
  isPassed: true,
});

const inspection = (processType: string, values: ReturnType<typeof value>[], inspectionStandardCode = 'QS-SS275-ST'): MillSheetInspectionSnapshot => ({
  lotNo: 'X',
  processType,
  inspectionStandardCode,
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

  it('강종이 다른 히트는 기준을 묶음마다 따로 둔다 (SS275 C ≤0.25 · SM355A C ≤0.20)', () => {
    const heat = (key: string, standardCode: string, c: [string, string], p: [string, string]) => ({
      key,
      inspection: inspection('STEELMAKING', [value('C', c[0], null, c[1]), value('P', p[0], null, p[1])], standardCode),
    });
    const groups = inspectionRangeGroups([
      heat('H1', 'QS-SS275-ST', ['0.18', '0.25'], ['0.020', '0.050']),
      heat('H2', 'QS-SM355A-ST', ['0.17', '0.20'], ['0.020', '0.035']),
      heat('H3', 'QS-SS275-ST', ['0.21', '0.25'], ['0.030', '0.050']),
    ]);
    expect(groups.map((g) => [g.standard, g.rows.map((r) => r.key), g.ranges])).toEqual([
      ['QS-SS275-ST v1', ['H1', 'H3'], { C: '≤0.25', P: '≤0.050' }],
      ['QS-SM355A-ST v1', ['H2'], { C: '≤0.20', P: '≤0.035' }],
    ]);
  });

  it('코일 두께 구간이 다르면 같은 기준 코드라도 기준을 따로 둔다, 검사가 없는 행은 기준 없이', () => {
    const coil = (key: string, tol: string, yieldMin: string) => ({
      key,
      inspection: inspection('HOT_ROLLING', [value('THICKNESS_TOL', '0.10', `-${tol}`, tol), value('YIELD_STRENGTH', '320', yieldMin, null)], 'QS-SS275-HR'),
    });
    const groups = inspectionRangeGroups([coil('C-2.3a', '0.20', '275'), coil('C-4.5', '0.28', '265'), coil('C-2.3b', '0.20', '275'), { key: 'C-none', inspection: null }]);
    expect(groups.map((g) => [g.rows.map((r) => r.key), g.ranges])).toEqual([
      [['C-2.3a', 'C-2.3b'], { THICKNESS_TOL: '-0.20~0.20', YIELD_STRENGTH: '≥275' }],
      [['C-4.5'], { THICKNESS_TOL: '-0.28~0.28', YIELD_STRENGTH: '≥265' }],
      [['C-none'], {}],
    ]);
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
