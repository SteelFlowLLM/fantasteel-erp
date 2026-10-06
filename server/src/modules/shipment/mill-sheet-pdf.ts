import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { formatTon, type MillSheetInspectionSnapshot, type MillSheetSnapshot } from '@fantasteel/shared';

// 밀시트 PDF 렌더링 (REQ-SHP-004, 업무 프로세스 13.3 generatePdf). 저장된 스냅샷만 읽고 DB·현재 값은 읽지 않는다.

/** 한글 폰트. 환경변수로 바꿀 수 있고, 기본은 저장소에 포함한 Noto Sans KR (server/assets/fonts) */
export const millSheetFontPath = (): string => process.env.MILL_SHEET_FONT ?? join(process.cwd(), 'assets', 'fonts', 'NotoSansKR-VF.ttf');

const PAGE_MARGIN = 40;
const PAGE_BOTTOM = 800;
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2;
const GRAY = '#555555';
const LINE = '#bbbbbb';

type Column = { header: string; width: number; align?: 'left' | 'right' | 'center' };

const dash = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? '-' : v);
const dateTime = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;

/** 스냅샷을 A4 PDF로 그린다. 폰트를 못 읽으면 pdfkit이 던지고, 호출한 쪽이 SHP-001로 바꾼다 */
export function renderMillSheetPdf(snapshot: MillSheetSnapshot, fontPath: string = millSheetFontPath()): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, info: { Title: snapshot.millSheetNo, Producer: 'FantaSteel ERP' } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      doc.registerFont('body', fontPath);
      doc.font('body');
      draw(doc, snapshot);
      doc.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** 남은 높이가 모자라면 새 쪽 */
function ensureSpace(doc: PDFKit.PDFDocument, height: number) {
  if (doc.y + height > PAGE_BOTTOM) doc.addPage();
}

function heading(doc: PDFKit.PDFDocument, text: string, size = 11) {
  ensureSpace(doc, 40);
  doc.moveDown(0.8).fontSize(size).fillColor('#000000').text(text, PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH });
  doc.moveTo(PAGE_MARGIN, doc.y + 2).lineTo(PAGE_MARGIN + CONTENT_WIDTH, doc.y + 2).strokeColor(LINE).lineWidth(0.5).stroke();
  doc.moveDown(0.4);
}

function table(doc: PDFKit.PDFDocument, columns: Column[], rows: string[][]) {
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

function inspectionTable(doc: PDFKit.PDFDocument, title: string, inspection: MillSheetInspectionSnapshot | null) {
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
    inspection.values.map((v) => [`${v.inspectionItemName} (${v.inspectionItemCode})`, dash(v.unit), dash(v.minValue), dash(v.maxValue), v.measuredValue, v.isPassed === null ? '-' : v.isPassed ? '적합' : '부적합']),
  );
}

function draw(doc: PDFKit.PDFDocument, s: MillSheetSnapshot) {
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
