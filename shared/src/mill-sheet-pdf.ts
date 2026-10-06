// 밀시트 PDF 그리기 (REQ-SHP-004, 업무 프로세스 13.3 generatePdf). 저장된 스냅샷만 읽고 DB·현재 값은 읽지 않는다.
// 서버(pdfkit)와 화면(pdfkit 브라우저 빌드)이 같은 그림을 그리도록 레이아웃을 한 곳에 둔다.
// pdfkit 자체는 가져오지 않고, 쓰는 메서드만 모은 모양(PdfDocLike)을 받아서 어느 쪽 pdfkit이든 그대로 넘길 수 있다.
import type { MillSheetInspectionSnapshot, MillSheetSnapshot } from './shipment';
import { formatTon } from './weight';

export interface PdfTextOptions {
  width?: number;
  align?: 'left' | 'right' | 'center';
  lineBreak?: boolean;
  ellipsis?: boolean;
}

/** 밀시트 그리기에 쓰는 pdfkit 문서 메서드만 모은 모양 */
export interface PdfDocLike {
  y: number;
  fontSize(size: number): PdfDocLike;
  fillColor(color: string): PdfDocLike;
  strokeColor(color: string): PdfDocLike;
  lineWidth(width: number): PdfDocLike;
  moveDown(lines?: number): PdfDocLike;
  moveTo(x: number, y: number): PdfDocLike;
  lineTo(x: number, y: number): PdfDocLike;
  stroke(): PdfDocLike;
  addPage(): PdfDocLike;
  text(text: string, x: number, y: number, options?: PdfTextOptions): PdfDocLike;
  text(text: string, options?: PdfTextOptions): PdfDocLike;
}

/** pdfkit 문서를 만들 때 쓰는 값. 서버·화면이 같은 용지·여백으로 만든다 */
export const MILL_SHEET_PDF_PAGE = { size: 'A4', margin: 40 } as const;

const PAGE_MARGIN = MILL_SHEET_PDF_PAGE.margin;
const PAGE_BOTTOM = 800;
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2;
const GRAY = '#555555';
const LINE = '#bbbbbb';

type Column = { header: string; width: number; align?: 'left' | 'right' | 'center' };

const dash = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? '-' : v);
const dateTime = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;

/** 남은 높이가 모자라면 새 쪽 */
function ensureSpace(doc: PdfDocLike, height: number) {
  if (doc.y + height > PAGE_BOTTOM) doc.addPage();
}

function heading(doc: PdfDocLike, text: string, size = 11) {
  ensureSpace(doc, 40);
  doc.moveDown(0.8).fontSize(size).fillColor('#000000').text(text, PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH });
  doc.moveTo(PAGE_MARGIN, doc.y + 2).lineTo(PAGE_MARGIN + CONTENT_WIDTH, doc.y + 2).strokeColor(LINE).lineWidth(0.5).stroke();
  doc.moveDown(0.4);
}

function table(doc: PdfDocLike, columns: Column[], rows: string[][]) {
  const rowHeight = 15;
  const drawRow = (cells: string[], bold: boolean) => {
    ensureSpace(doc, rowHeight);
    const y = doc.y;
    let x = PAGE_MARGIN;
    doc.fontSize(8).fillColor(bold ? GRAY : '#000000');
    columns.forEach((column, index) => {
      doc.text(cells[index] ?? '', x + 2, y + 3, { width: column.width - 4, align: column.align ?? 'left', lineBreak: false, ellipsis: true });
      x += column.width;
    });
    doc.moveTo(PAGE_MARGIN, y + rowHeight).lineTo(PAGE_MARGIN + CONTENT_WIDTH, y + rowHeight).strokeColor(LINE).lineWidth(0.3).stroke();
    doc.y = y + rowHeight;
  };
  drawRow(columns.map((c) => c.header), true);
  rows.forEach((row) => drawRow(row, false));
}

function inspectionTable(doc: PdfDocLike, title: string, inspection: MillSheetInspectionSnapshot | null) {
  ensureSpace(doc, 50);
  doc.fontSize(9).fillColor('#000000').text(title, PAGE_MARGIN, doc.y + 4, { width: CONTENT_WIDTH });
  if (!inspection) {
    doc.fontSize(8).fillColor(GRAY).text('검사 기록 없음', PAGE_MARGIN, doc.y + 2);
    return;
  }
  doc.fontSize(8).fillColor(GRAY).text(`${inspection.inspectionStandardCode} v${inspection.version} · 판정 ${inspection.inspectionResult} · ${dateTime(inspection.inspectedAt)}`, PAGE_MARGIN, doc.y + 1);
  doc.moveDown(0.2);
  table(
    doc,
    [
      { header: '검사 항목', width: 200 },
      { header: '단위', width: 55 },
      { header: '하한', width: 70, align: 'right' },
      { header: '상한', width: 70, align: 'right' },
      { header: '측정값', width: 70, align: 'right' },
      { header: '판정', width: CONTENT_WIDTH - 465, align: 'center' },
    ],
    inspection.values.map((v) => [
      `${v.inspectionItemName} (${v.inspectionItemCode})`,
      dash(v.unit),
      dash(v.minValue),
      dash(v.maxValue),
      v.measuredValue,
      v.isPassed === null ? '-' : v.isPassed ? '적합' : '부적합',
    ]),
  );
}

/** 스냅샷을 문서에 그린다. 글꼴(한글 지원)은 부른 쪽이 먼저 정해 둔다 */
export function drawMillSheet(doc: PdfDocLike, s: MillSheetSnapshot): void {
  doc.fontSize(18).fillColor('#000000').text('밀시트', PAGE_MARGIN, PAGE_MARGIN, { width: CONTENT_WIDTH, align: 'center' });
  doc.fontSize(9).fillColor(GRAY).text('Mill Test Certificate', { width: CONTENT_WIDTH, align: 'center' });
  doc.moveDown(0.8);

  const info: [string, string][] = [
    ['밀시트 번호', s.millSheetNo],
    ['발행일', s.issuedDate],
    ['고객사', `${s.customer.customerName} (${s.customer.customerCode})`],
    ['수주 번호', s.salesOrder.salesOrderNo],
    ['출하요청 번호', s.shipmentRequest.shipmentRequestNo],
    ['출하 예정일', dash(s.shipmentRequest.shipDate)],
    ['출고 확정', `${dash(s.shipmentRequest.issuedEmployeeName)} · ${s.shipmentRequest.issuedAt ? dateTime(s.shipmentRequest.issuedAt) : '-'}`],
    ['총 수량·중량', `${s.totalQty}매 · ${formatTon(s.totalWeightTon)} t`],
  ];
  const top = doc.y;
  info.forEach(([label, value], index) => {
    const x = PAGE_MARGIN + (index % 2) * (CONTENT_WIDTH / 2);
    const y = top + Math.floor(index / 2) * 16;
    doc.fontSize(8).fillColor(GRAY).text(label, x, y, { width: 70, lineBreak: false });
    doc.fontSize(9).fillColor('#000000').text(value, x + 75, y - 1, { width: CONTENT_WIDTH / 2 - 80, lineBreak: false, ellipsis: true });
  });
  doc.y = top + Math.ceil(info.length / 2) * 16 + 4;

  for (const item of s.items) {
    heading(doc, `${item.itemCode} · ${item.itemName}`);
    doc
      .fontSize(8)
      .fillColor(GRAY)
      .text(
        `강종 ${dash(item.steelGradeCode)} · 규격 ${dash(item.standardNo)} · 치수 ${dash(item.thicknessMm)} × ${dash(item.widthMm)} × ${dash(item.lengthMm)} mm · 1매 ${formatTon(item.theoreticalWeightTon)} t · 출고 ${item.qty}매 ${formatTon(item.totalWeightTon)} t`,
        PAGE_MARGIN,
        doc.y,
        { width: CONTENT_WIDTH },
      );
    doc.moveDown(0.3);
    table(
      doc,
      [
        { header: 'LOT 번호', width: 150 },
        { header: '구분', width: 50 },
        { header: '생산일', width: 75 },
        { header: '슬래브', width: 120 },
        { header: '히트', width: CONTENT_WIDTH - 395 },
      ],
      item.lots.map((l) => [l.lotNo, l.lotType, dash(l.producedDate), dash(l.slabNo), dash(l.heatNo)]),
    );
    for (const lot of item.lots) inspectionTable(doc, `${lot.lotNo} 검사`, lot.productInspection);
  }

  heading(doc, '히트 성분 검사');
  if (s.heats.length === 0) doc.fontSize(8).fillColor(GRAY).text('히트 기록 없음', PAGE_MARGIN, doc.y);
  for (const heat of s.heats) {
    inspectionTable(doc, `${heat.heatNo} · 전로 ${dash(heat.converterCode)} · 강종 ${dash(heat.steelGradeCode)}`, heat.inspection);
  }
}
