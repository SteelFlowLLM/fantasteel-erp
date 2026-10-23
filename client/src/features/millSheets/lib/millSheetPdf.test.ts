import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { drawMillSheet, millSheetPdfFileName, type PdfDocLike } from '@fantasteel/shared';
import type { MillSheetInspectionSnapshot, MillSheetSnapshot } from '@/api/millSheets';
import { buildMillSheetPdf, toPdfSnapshot } from './millSheetPdf';

const inspection = (lotNo: string, code: string): MillSheetInspectionSnapshot => ({
  lotNo,
  processType: 'STEELMAKING',
  inspectionStandardCode: code,
  version: 1,
  inspectionResult: 'PASS',
  inspectedAt: '2026-10-02T03:00:00.000Z',
  values: [
    { inspectionItemCode: 'C', inspectionItemName: '탄소', unit: '%', minValue: null, maxValue: '0.2000', measuredValue: '0.1000', isPassed: true },
    { inspectionItemCode: 'SI', inspectionItemName: '규소', unit: '%', minValue: null, maxValue: '0.5500', measuredValue: null, isPassed: null },
  ],
});

/** 화면(목업) 스냅샷 모양의 시료. 슬래브 lotCount개, LOT마다 히트가 다르다 */
const sample = (lotCount = 3): MillSheetSnapshot => ({
  millSheetNo: 'MS-2610-0028-1',
  issuedAt: '2026-10-06T05:30:00.000Z',
  issuedDate: '2026-10-06',
  customer: { customerId: 1, customerCode: 'CUS-01', customerName: '나래조선' },
  salesOrder: { salesOrderId: 1, salesOrderNo: 'SO-2610-001' },
  shipmentRequest: { shipmentRequestId: 1, shipmentRequestNo: 'DR-2610-0028', requestedShipDate: '2026-10-20', issuedAt: '2026-10-06T05:30:00.000Z', issuedEmployeeName: '박물류' },
  items: [
    {
      salesOrderItemId: 1,
      lineNo: 1,
      itemId: 1,
      itemCode: 'SL-SM355A-250x1500x10000',
      itemName: '슬래브 SM355A',
      itemType: 'SLAB',
      steelGradeCode: 'SM355A',
      standardNo: 'KS D 3515',
      thicknessMm: '250.00',
      widthMm: '1500.00',
      lengthMm: '10000.00',
      theoreticalWeightTon: '29.438',
      qty: lotCount,
      totalWeightTon: '88.314',
      lots: Array.from({ length: lotCount }, (_, i) => ({
        lotId: i + 1,
        lotNo: `SL-261002-${String(i + 1).padStart(3, '0')}`,
        lotType: 'SLAB',
        producedDate: '2026-10-02',
        theoreticalWeightTon: '29.438',
        heatLotId: 100 + i,
        heatNo: `HT-BOF1-261002-${String(i + 1).padStart(3, '0')}`,
        slabNo: null,
        productInspection: inspection(`SL-261002-${String(i + 1).padStart(3, '0')}`, 'QS-SM355A-CC'),
      })),
    },
  ],
  heats: Array.from({ length: lotCount }, (_, i) => ({
    heatLotId: 100 + i,
    heatNo: `HT-BOF1-261002-${String(i + 1).padStart(3, '0')}`,
    converterCode: 'BOF1',
    producedDate: '2026-10-02',
    steelGradeCode: 'SM355A',
    inspection: inspection(`HT-BOF1-261002-${String(i + 1).padStart(3, '0')}`, 'QS-SM355A-ST'),
  })),
  totalQty: lotCount,
  totalWeightTon: '88.314',
  lotIds: [1, 2, 3, 100, 101, 102],
});

const font = () => new Uint8Array(readFileSync(join(process.cwd(), 'public', 'fonts', 'NotoSansKR-VF.ttf')));
const pageCount = (pdf: Uint8Array) => (Buffer.from(pdf).toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;

describe('밀시트 PDF 직접 생성 (REQ-SHP-004)', () => {
  it('화면 스냅샷을 서버와 같은 모양으로 바꾼다 (출하 예정일 requestedShipDate → shipDate, 빈 검사값은 빈 글자)', () => {
    const converted = toPdfSnapshot(sample());
    expect(converted.shipmentRequest.shipDate).toBe('2026-10-20');
    expect(converted.items[0].lots[0].productInspection?.values[1].measuredValue).toBe('');
    expect(converted.heats[0].inspection?.inspectionStandardCode).toBe('QS-SM355A-ST');
  });

  it('PDF 바이트를 만들고 한글 글꼴을 내장한다', async () => {
    const pdf = await buildMillSheetPdf(toPdfSnapshot(sample()), font());
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe('%PDF-');
    expect(Buffer.from(pdf).toString('latin1')).toContain('/FontFile2');
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(1);
  });

  // 글꼴(약 10MB)을 읽는 데 시간이 걸려서 PDF를 만드는 시험은 최소한으로 둔다 (전체 실행 때 다른 시험의 제한 시간을 넘기지 않게)
  it('LOT이 많으면 여러 쪽으로 넘어간다', async () => {
    const pdf = await buildMillSheetPdf(toPdfSnapshot(sample(25)), font());
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(2);
  }, 20_000);

  it('글꼴 바이트가 잘못되면 오류를 던진다', async () => {
    await expect(buildMillSheetPdf(toPdfSnapshot(sample()), new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });

  it('저장 이름은 서버와 같은 양식이다', () => {
    expect(millSheetPdfFileName(toPdfSnapshot(sample()))).toBe('MS-2610-0028-1_나래조선_20261006.pdf');
  });
});

/** 그린 글자만 모으는 가짜 문서 (글꼴 없이 내용만 본다) */
function drawnTexts(snapshot: MillSheetSnapshot): string[] {
  const texts: string[] = [];
  const doc: PdfDocLike = {
    y: 0,
    fontSize: () => doc,
    fillColor: () => doc,
    strokeColor: () => doc,
    lineWidth: () => doc,
    moveDown: () => doc,
    moveTo: () => doc,
    lineTo: () => doc,
    stroke: () => doc,
    addPage: () => doc,
    text: (value: string) => {
      texts.push(value);
      return doc;
    },
  };
  drawMillSheet(doc, toPdfSnapshot(snapshot));
  return texts;
}

describe('밀시트 PDF 내용 (drawMillSheet)', () => {
  it('출고 확정·검사 시각을 서울 시각으로 찍는다 (스냅샷은 UTC)', () => {
    const texts = drawnTexts(sample(1));
    expect(texts).toContain('박물류 · 2026-10-06 14:30');
    expect(texts.some((t) => t.includes('판정 PASS · 2026-10-02 12:00'))).toBe(true);
    expect(texts.some((t) => t.includes('05:30') || t.includes('03:00'))).toBe(false);
  });

  it('톤 단위는 한 번만 붙인다', () => {
    const texts = drawnTexts(sample(1));
    expect(texts).toContain('1매 · 88.314 t');
    expect(texts.some((t) => t.includes('1매 29.438 t · 출고 1매 88.314 t'))).toBe(true);
    expect(texts.some((t) => /\bt t\b/.test(t))).toBe(false);
  });

  it('항목명에 코드가 이미 들어 있으면 코드를 다시 붙이지 않는다', () => {
    const snapshot = sample(1);
    const heatInspection = snapshot.heats[0].inspection!;
    snapshot.heats[0].inspection = { ...heatInspection, values: [{ ...heatInspection.values[0], inspectionItemName: '규소(Si)', inspectionItemCode: 'SI' }, heatInspection.values[1]] };
    const texts = drawnTexts(snapshot);
    expect(texts).toContain('규소(Si)');
    expect(texts).not.toContain('규소(Si) (SI)');
    expect(texts).toContain('규소 (SI)');
  });
});
