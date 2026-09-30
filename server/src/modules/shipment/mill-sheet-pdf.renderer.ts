import { Injectable } from '@nestjs/common';
import { existsSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import { INSPECTION_RESULT_LABEL, ITEM_TYPE_LABEL, PROCESS_CODE_LABEL, type InspectionResult, type ProcessCode } from '@fantasteel/shared';
import type { MillSheetInspection, MillSheetInspectionValue, MillSheetSnapshot } from './mill-sheet.snapshot';

// 한글을 그리려면 한글 글꼴 파일이 있어야 한다. MILL_SHEET_FONT_PATH가 있으면 그것만 쓰고, 없으면 아래 순서로 찾는다.
const FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/AppleGothic.ttf',
  '/Library/Fonts/Arial Unicode.ttf',
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/usr/share/fonts/truetype/nanum/NanumGothic.ttf',
];
const FONT = 'mill-sheet';
const MARGIN = 40;
const ROW_H = 16;

type Doc = InstanceType<typeof PDFDocument>;
interface Column { title: string; width: number; align?: 'left' | 'center' | 'right' }

/** 저장된 스냅샷만으로 밀시트 PDF를 만든다 (REQ-SHP-004). DB를 읽지 않는다. */
@Injectable()
export class MillSheetPdfRenderer {
  /** 쓸 수 있는 한글 글꼴 경로. 없으면 null. */
  resolveFontPath(): string | null {
    const fromEnv = process.env.MILL_SHEET_FONT_PATH?.trim();
    if (fromEnv) return existsSync(fromEnv) ? fromEnv : null;
    return FONT_CANDIDATES.find((p) => existsSync(p)) ?? null;
  }

  async render(snapshot: MillSheetSnapshot): Promise<Buffer> {
    const fontPath = this.resolveFontPath();
    if (!fontPath) throw new Error('한글 글꼴 파일을 찾을 수 없습니다 (MILL_SHEET_FONT_PATH)');
    return new Promise<Buffer>((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: MARGIN, info: { Title: `밀시트 ${snapshot.millSheetNo}`, Subject: 'Mill Test Certificate' } });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.registerFont(FONT, fontPath);
        doc.font(FONT);
        this.draw(doc, snapshot);
        doc.end();
      } catch (e) {
        reject(e as Error);
      }
    });
  }

  private draw(doc: Doc, s: MillSheetSnapshot): void {
    const width = doc.page.width - MARGIN * 2;
    doc.fontSize(18).text('검사증명서 (밀시트)', { align: 'center' });
    doc.fontSize(9).fillColor('#555').text('MILL TEST CERTIFICATE', { align: 'center' }).fillColor('#000');
    doc.moveDown(0.8);

    const spec = s.productSpec;
    const half = width / 2;
    this.pairs(doc, half, [
      ['밀시트 번호', s.millSheetNo, '발행일', this.date(s.issuedAt)],
      ['고객사', s.customer.customerName, '수주번호', `${s.salesOrder.salesOrderNo} #${s.salesOrder.lineNo}`],
      ['출하번호', s.shipment.shipmentRequestNo, '출고번호', s.shipment.goodsIssueNo],
      ['품목', ITEM_TYPE_LABEL[spec.itemType], '강종', `${spec.steelGradeCode} (${spec.steelGradeName})`],
      ['규격', spec.specCode, '적용 규격', spec.standardNo ?? '-'],
      ['치수 (두께×폭×길이 mm)', `${spec.thicknessMm} × ${spec.widthMm} × ${spec.lengthMm}`, '1매 이론중량', `${spec.theoreticalWeightTon} t`],
      ['출고 수량', `${s.qty} ${s.qtyUnit}`, '출고 중량 (이론중량)', `${s.weightTon} t`],
    ]);

    this.heading(doc, '1. 화학성분 (히트 성분 검사)');
    for (const heat of s.heats) {
      this.note(doc, `히트 ${heat.heatNo}${heat.composition ? ` · 검사 ${heat.composition.qualityInspectionNo} · ${this.resultLabel(heat.composition.inspectionResult)}` : ' · 검사 기록 없음'}`);
      if (heat.composition) this.valueTable(doc, width, heat.composition.values);
    }

    this.heading(doc, `2. 제품 검사 (LOT ${s.lots.length}${s.qtyUnit})`);
    for (const lot of s.lots) {
      this.note(doc, `${lot.lotNo} · 히트 ${lot.heatNo ?? '-'} · 생산완료 ${this.date(lot.producedAt)}`);
      this.inspection(doc, width, lot.inspection);
      if (lot.parentSlab) {
        this.note(doc, `  └ 압연 전 슬래브 ${lot.parentSlab.lotNo}`);
        this.inspection(doc, width, lot.parentSlab.inspection);
      }
    }

    doc.moveDown(1);
    this.ensure(doc, 30);
    doc.fontSize(8).fillColor('#555').text('이 문서는 출고 확정 시점의 검사값을 그대로 보존한 기록입니다. 중량은 이론중량(매수 × 1매 이론중량)입니다.', MARGIN, doc.y, { width });
    doc.fillColor('#000');
  }

  private inspection(doc: Doc, width: number, inspection: MillSheetInspection | null): void {
    if (!inspection) {
      this.note(doc, '    검사 기록 없음');
      return;
    }
    const process = PROCESS_CODE_LABEL[inspection.processCode as ProcessCode] ?? inspection.processCode;
    this.note(doc, `    ${process} 검사 ${inspection.qualityInspectionNo} · ${this.resultLabel(inspection.inspectionResult)}${inspection.inspectedAt ? ` · ${this.date(inspection.inspectedAt)}` : ''}`);
    this.valueTable(doc, width, inspection.values);
  }

  private valueTable(doc: Doc, width: number, values: MillSheetInspectionValue[]): void {
    const cols: Column[] = [
      { title: '항목', width: width * 0.34 },
      { title: '단위', width: width * 0.1, align: 'center' },
      { title: '기준 하한', width: width * 0.14, align: 'right' },
      { title: '기준 상한', width: width * 0.14, align: 'right' },
      { title: '측정값', width: width * 0.16, align: 'right' },
      { title: '판정', width: width * 0.12, align: 'center' },
    ];
    this.row(doc, cols, cols.map((c) => c.title), true);
    for (const v of values) {
      const name = v.inspectionItemName === v.inspectionItemCode ? v.inspectionItemCode : `${v.inspectionItemName} (${v.inspectionItemCode})`;
      this.row(doc, cols, [name, v.unit ?? '-', v.minValue ?? '-', v.maxValue ?? '-', v.measuredValue ?? '-', v.isPassed === null ? '-' : v.isPassed ? '합격' : '불합격']);
    }
    doc.moveDown(0.4);
  }

  private pairs(doc: Doc, half: number, rows: [string, string, string, string][]): void {
    const cols: Column[] = [{ title: '', width: half * 0.42 }, { title: '', width: half * 0.58 }, { title: '', width: half * 0.42 }, { title: '', width: half * 0.58 }];
    for (const r of rows) this.row(doc, cols, r, false, [0, 2]);
  }

  private row(doc: Doc, cols: Column[], cells: string[], header = false, shaded: number[] = []): void {
    this.ensure(doc, ROW_H);
    const y = doc.y;
    let x = MARGIN;
    doc.fontSize(8);
    cols.forEach((c, i) => {
      if (header || shaded.includes(i)) doc.rect(x, y, c.width, ROW_H).fill('#eef1f4').fillColor('#000');
      doc.rect(x, y, c.width, ROW_H).lineWidth(0.5).stroke('#9aa3ad');
      doc.text(cells[i] ?? '', x + 4, y + 4, { width: c.width - 8, height: ROW_H - 4, align: header ? 'center' : (c.align ?? 'left'), lineBreak: false, ellipsis: true });
      x += c.width;
    });
    doc.x = MARGIN;
    doc.y = y + ROW_H;
  }

  private heading(doc: Doc, text: string): void {
    this.ensure(doc, 40);
    doc.moveDown(0.8);
    doc.fontSize(11).text(text, MARGIN, doc.y);
    doc.moveDown(0.3);
  }

  private note(doc: Doc, text: string): void {
    this.ensure(doc, ROW_H * 2);
    doc.fontSize(8.5).text(text, MARGIN, doc.y);
    doc.moveDown(0.2);
  }

  /** 남은 공간이 모자라면 새 쪽으로 넘긴다. */
  private ensure(doc: Doc, height: number): void {
    if (doc.y + height > doc.page.height - MARGIN) {
      doc.addPage();
      doc.font(FONT);
    }
  }

  private resultLabel(result: string): string {
    return INSPECTION_RESULT_LABEL[result as InspectionResult] ?? result;
  }

  /** ISO 일시 → YYYY-MM-DD (Asia/Seoul). */
  private date(iso: string): string {
    return new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  }
}
