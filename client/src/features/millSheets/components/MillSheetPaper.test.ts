// 밀시트 종이 렌더 확인: 시드로 저장된 측정값("0.180", "10.000")과 화면에서 입력해 저장한 값("0.18", "10")이
// 같은 글자로 보이는지 본다 (측정값 숫자 표시 통일). 브라우저 없이 Vitest node 환경에서 서버 렌더한다.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MillSheetHeatSnapshot, MillSheetSnapshot } from '@/api/millSheets';
import { MillSheetPaper } from '@/features/millSheets/components/MillSheetPaper';

type MeasuredRow = { code: string; name: string; unit: string; min: string | null; max: string | null; measured: string | null };

const heat = (id: number, heatNo: string, rows: MeasuredRow[]): MillSheetHeatSnapshot => ({
  heatLotId: id,
  heatNo,
  converterCode: 'BOF-1',
  producedDate: '2026-09-05',
  steelGradeCode: 'SS275',
  inspection: {
    lotNo: heatNo,
    processType: 'STEELMAKING',
    inspectionStandardCode: 'QS-SS275-ST',
    version: 1,
    inspectionResult: 'PASS',
    inspectedAt: '2026-09-05T03:00:00.000Z',
    values: rows.map((r) => ({
      inspectionItemCode: r.code,
      inspectionItemName: r.name,
      unit: r.unit,
      minValue: r.min,
      maxValue: r.max,
      measuredValue: r.measured,
      isPassed: r.measured === null ? null : true,
    })),
  },
});

const snapshotOf = (heats: MillSheetHeatSnapshot[]): MillSheetSnapshot => ({
  millSheetNo: 'MS-0001-1',
  issuedAt: '2026-09-10T05:00:00.000Z',
  issuedDate: '2026-09-10',
  customer: { customerId: 1, customerCode: 'CU-001', customerName: '한성철강' },
  salesOrder: { salesOrderId: 1, salesOrderNo: 'SO-2609-001' },
  shipmentRequest: { shipmentRequestId: 1, shipmentRequestNo: 'SR-2609-0001', requestedShipDate: '2026-09-10', issuedAt: '2026-09-10T05:00:00.000Z', issuedEmployeeName: '김출하' },
  items: [],
  heats,
  totalQty: 0,
  totalWeightTon: '23.550',
  lotIds: heats.map((h) => h.heatLotId),
});

/** 표의 줄마다 칸 글자(태그를 뗀 것) */
const rowsOf = (html: string): string[][] =>
  [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((tr) => [...(tr[1] ?? '').matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((td) => (td[1] ?? '').replace(/<[^>]+>/g, '')));

const SEEDED: MeasuredRow[] = [
  { code: 'C', name: '탄소(C)', unit: '%', min: null, max: '0.250', measured: '0.180' },
  { code: 'CEQ', name: '탄소당량(Ceq)', unit: '%', min: '10.000', max: null, measured: '10.000' },
  { code: 'W', name: '폭 편차', unit: 'mm', min: null, max: null, measured: '0.000' },
];
const TYPED: MeasuredRow[] = [
  { code: 'C', name: '탄소(C)', unit: '%', min: null, max: '0.25', measured: '0.18' },
  { code: 'CEQ', name: '탄소당량(Ceq)', unit: '%', min: '10', max: null, measured: '10' },
  { code: 'W', name: '폭 편차', unit: 'mm', min: null, max: null, measured: '0' },
];

describe('밀시트 종이: 측정값 숫자 표시', () => {
  it('시드 값(0.180 · 10.000)과 입력한 값(0.18 · 10)이 같은 글자로 보인다', () => {
    const html = renderToStaticMarkup(createElement(MillSheetPaper, { snapshot: snapshotOf([heat(1, 'HT-BOF1-260905-001', SEEDED), heat(2, 'HT-BOF1-260905-002', TYPED)]) }));
    const heatRows = rowsOf(html).filter((cells) => cells[0]?.startsWith('HT-BOF1-'));
    expect(heatRows).toHaveLength(2);
    // 칸: 히트 · C · Ceq · 폭 편차 · 판정 · 기준 코드
    expect(heatRows[0]?.slice(1, 4)).toEqual(['0.18', '10', '0']);
    expect(heatRows[1]?.slice(1, 4)).toEqual(['0.18', '10', '0']);
    expect(html).not.toContain('0.180');
    expect(html).not.toContain('10.000');
    expect(html).not.toContain('0.000');
  });

  it('기준 행도 자리수가 다른 값("0.250" 과 "0.25")을 한 묶음의 같은 글자로 보인다', () => {
    const html = renderToStaticMarkup(createElement(MillSheetPaper, { snapshot: snapshotOf([heat(1, 'HT-BOF1-260905-001', SEEDED), heat(2, 'HT-BOF1-260905-002', TYPED)]) }));
    const limitRows = rowsOf(html).filter((cells) => cells[0] === '기준');
    expect(limitRows).toHaveLength(1);
    expect(limitRows[0]?.slice(1, 4)).toEqual(['≤0.25', '≥10', '—']);
  });

  it('측정값이 비어 있으면 줄표', () => {
    const html = renderToStaticMarkup(createElement(MillSheetPaper, { snapshot: snapshotOf([heat(1, 'HT-BOF1-260905-001', [{ ...SEEDED[0]!, measured: null }])]) }));
    const heatRow = rowsOf(html).find((cells) => cells[0]?.startsWith('HT-BOF1-'));
    expect(heatRow?.[1]).toBe('—');
  });
});
