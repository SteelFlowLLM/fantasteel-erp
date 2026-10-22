import PDFDocument from 'pdfkit';
import type { AiResearchChart } from '@fantasteel/shared';
import { millSheetFontPath } from '../shipment/mill-sheet-pdf';
import { urlKey } from '../ai-assistant/web/web-text';

// 심층 조사 보고서 PDF (이슈 #521). 한글 글꼴은 밀시트 PDF와 같은 server/assets/fonts의 Noto Sans KR(MILL_SHEET_FONT로 바꿈)을 쓴다.
// 보고서 마크다운은 제목·문단·목록·인용·표만 그리고, 굵게·링크 같은 줄 안 표시는 글자만 남긴다. 차트는 그림 대신 숫자 표로 넣는다(가정).

export interface ResearchPdfInput {
  id: number;
  title: string;
  question: string;
  /** 보고서를 쓴 시각 (판이면 그 판을 만든 시각) */
  writtenAt: Date;
  /** '2판' 같은 판 표시. 판이 없으면 null */
  versionLabel: string | null;
  /** 대체본 표시 (이슈 #521). 보고서 LLM이 쓴 것이면 null */
  fallbackLabel: string | null;
  report: string;
  charts: AiResearchChart[];
  sources: { id: number; title: string; url: string }[];
}

export type PdfBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'table'; rows: string[][] };

const HEADING = /^(#{1,6})[ \t]+(.*)$/;
const BULLET = /^[ \t]*[-*+][ \t]+(.*)$/;
const ORDERED = /^[ \t]*(\d{1,3})[.)][ \t]+(.*)$/;
const QUOTE = /^>[ \t]?(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
/** 서버가 붙인 출처 목록 (PDF에는 출처 절을 따로 그린다) */
const SOURCE_HEADING = /^##[ \t]*출처[ \t]*$/m;

/** 줄 안 마크다운 표시를 글자만 남긴다: 그림은 빼고, 링크는 글만, 굵게·기울임·코드 표시는 뗀다 */
export function plainInline(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .trim();
}

const tableCells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => plainInline(cell));

/** 보고서 마크다운 → PDF 블록. 끝의 서버 출처 목록(## 출처)은 뗀다 */
export function pdfBlocks(report: string): PdfBlock[] {
  const cut = report.search(SOURCE_HEADING);
  const lines = (cut >= 0 ? report.slice(0, cut) : report).split(/\r?\n/);
  const blocks: PdfBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line || line.startsWith('```') || RULE.test(line)) {
      flush();
      continue;
    }
    if (TABLE_ROW.test(line)) {
      flush();
      const rows: string[][] = [];
      for (; i < lines.length && TABLE_ROW.test(lines[i].trim()); i += 1) if (!TABLE_SEPARATOR.test(lines[i].trim())) rows.push(tableCells(lines[i]));
      i -= 1;
      if (rows.length) blocks.push({ kind: 'table', rows });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', level: Math.min(heading[1].length, 4), text: plainInline(heading[2]) });
      continue;
    }
    const bullet = BULLET.exec(raw);
    const ordered = ORDERED.exec(raw);
    if (bullet || ordered) {
      flush();
      const isOrdered = !bullet;
      const text = plainInline((bullet ?? ordered)?.[bullet ? 1 : 2] ?? '');
      const last = blocks.at(-1);
      if (last?.kind === 'list' && last.ordered === isOrdered) last.items.push(text);
      else blocks.push({ kind: 'list', ordered: isOrdered, items: [text] });
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote) {
      flush();
      const last = blocks.at(-1);
      const text = plainInline(quote[1]);
      if (last?.kind === 'quote') last.text = `${last.text}\n${text}`;
      else blocks.push({ kind: 'quote', text });
      continue;
    }
    paragraph.push(plainInline(line));
  }
  flush();
  return blocks.filter((b) => (b.kind === 'paragraph' || b.kind === 'heading' || b.kind === 'quote' ? b.text.length > 0 : true));
}

/** 차트 → 숫자 표 (가로축 한 줄, 계열마다 한 칸, 값 뒤에 출처 번호) */
export function chartRows(chart: AiResearchChart): string[][] {
  const xs: string[] = [];
  for (const s of chart.series) for (const p of s.points) if (!xs.includes(p.x)) xs.push(p.x);
  const header = [chart.xLabel || '항목', ...chart.series.map((s) => (chart.unit ? `${s.name} (${chart.unit})` : s.name))];
  return [header, ...xs.map((x) => [x, ...chart.series.map((s) => {
    const point = s.points.find((p) => p.x === x);
    return point ? `${point.y.toLocaleString('ko-KR')} [${point.sourceId}]` : '';
  })])];
}

/** 서울 시각 'YYYY-MM-DD HH:mm' */
export const seoulDateTime = (at: Date): string => new Date(at.getTime() + 9 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');

/** 내려받는 파일 이름: 심층조사-12-제목-2판.pdf (파일 이름에 못 쓰는 글자는 _) */
export function researchPdfFileName(input: Pick<ResearchPdfInput, 'id' | 'title' | 'versionLabel'>): string {
  const title = input.title.replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, '_').slice(0, 40).replace(/^_+|_+$/g, '');
  return `심층조사-${input.id}${title ? `-${title}` : ''}${input.versionLabel ? `-${input.versionLabel}` : ''}.pdf`;
}

const PAGE = { size: 'A4', margins: { top: 50, bottom: 56, left: 50, right: 50 } } as const;
const INK = '#1f2328';
const MUTED = '#5b6470';
const LINE = '#c9d0d8';
const HEAD_FILL = '#eef1f4';
const HEADING_SIZE = [17, 14, 12, 11];
const BODY_SIZE = 10.5;
const CELL_SIZE = 9;
const CELL_PAD = 4;

type Doc = PDFKit.PDFDocument;

/** 보고서 PDF를 그린다. 글꼴을 읽지 못하면 pdfkit이 던지고, 부르는 쪽이 RES-010으로 바꾼다 */
export function renderResearchPdf(input: ResearchPdfInput, fontPath: string = millSheetFontPath()): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ ...PAGE, bufferPages: true, info: { Title: input.title, Subject: input.question.slice(0, 200), Producer: 'FantaSteel ERP' } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      doc.registerFont('body', fontPath);
      doc.font('body').fillColor(INK);
      drawReport(doc, input);
      drawPageNumbers(doc, input.id);
      doc.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

const contentWidth = (doc: Doc): number => doc.page.width - doc.page.margins.left - doc.page.margins.right;
const bottom = (doc: Doc): number => doc.page.height - doc.page.margins.bottom;

/** 남은 자리가 모자라면 새 쪽 */
function ensureRoom(doc: Doc, height: number): void {
  if (doc.y + height > bottom(doc)) doc.addPage();
}

function drawReport(doc: Doc, input: ResearchPdfInput): void {
  const left = doc.page.margins.left;
  doc.fontSize(18).fillColor(INK).text(input.title, { width: contentWidth(doc) });
  doc.moveDown(0.3);
  const meta = [`작성 ${seoulDateTime(input.writtenAt)} (서울)`, input.versionLabel, `심층 조사 #${input.id}`].filter(Boolean).join(' · ');
  doc.fontSize(9).fillColor(MUTED).text(meta);
  if (input.fallbackLabel) doc.fontSize(9).fillColor('#9a6700').text(input.fallbackLabel);
  doc.moveDown(0.6);
  doc.fontSize(9).fillColor(MUTED).text('질문');
  doc.fontSize(BODY_SIZE).fillColor(INK).text(input.question, { width: contentWidth(doc), lineGap: 2 });
  doc.moveDown(0.5);
  rule(doc);

  for (const block of pdfBlocks(input.report)) drawBlock(doc, block);

  if (input.charts.length) heading(doc, 2, '차트 (숫자 표)');
  for (const chart of input.charts) {
    heading(doc, 3, chart.title);
    table(doc, chartRows(chart));
  }

  if (input.sources.length) {
    heading(doc, 2, '출처');
    for (const source of input.sources) {
      const web = urlKey(source.url) !== null;
      ensureRoom(doc, 28);
      doc.fontSize(9).fillColor(INK).text(`[${source.id}] ${source.title}`, left, doc.y, { width: contentWidth(doc), lineGap: 1 });
      // 웹 출처만 주소를 적고 누를 수 있게 한다 (ERP 조회·사내 지식은 주소가 없다)
      if (web) doc.fontSize(8).fillColor('#0b5cad').text(source.url, left + 14, doc.y, { width: contentWidth(doc) - 14, link: source.url, underline: false });
      doc.moveDown(0.25);
    }
  }
  doc.fillColor(INK);
}

function rule(doc: Doc): void {
  const left = doc.page.margins.left;
  doc.moveTo(left, doc.y).lineTo(left + contentWidth(doc), doc.y).lineWidth(0.6).strokeColor(LINE).stroke();
  doc.moveDown(0.6);
}

function heading(doc: Doc, level: number, text: string): void {
  const size = HEADING_SIZE[Math.min(level, HEADING_SIZE.length) - 1];
  // 제목만 쪽 끝에 남지 않게 다음 줄 몇 개 자리를 함께 본다
  ensureRoom(doc, size * 3 + 24);
  doc.moveDown(level <= 2 ? 0.6 : 0.4);
  doc.fontSize(size).fillColor(INK).text(text, doc.page.margins.left, doc.y, { width: contentWidth(doc) });
  doc.moveDown(0.25);
}

function drawBlock(doc: Doc, block: PdfBlock): void {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  switch (block.kind) {
    case 'heading':
      return heading(doc, block.level, block.text);
    case 'paragraph':
      doc.fontSize(BODY_SIZE).fillColor(INK).text(block.text, left, doc.y, { width, lineGap: 3 });
      doc.moveDown(0.5);
      return;
    case 'quote': {
      doc.fontSize(BODY_SIZE - 0.5).fillColor(MUTED);
      const height = doc.heightOfString(block.text, { width: width - 14, lineGap: 2 });
      ensureRoom(doc, Math.min(height, 200));
      const top = doc.y;
      doc.text(block.text, left + 12, top, { width: width - 14, lineGap: 2 });
      // 한 쪽 안에 있을 때만 왼쪽 줄을 긋는다 (쪽을 넘긴 인용은 줄 없이)
      if (doc.y > top) doc.moveTo(left + 3, top).lineTo(left + 3, doc.y).lineWidth(2).strokeColor(LINE).stroke();
      doc.fillColor(INK);
      doc.moveDown(0.5);
      return;
    }
    case 'list':
      block.items.forEach((item, index) => {
        const mark = block.ordered ? `${index + 1}.` : '•';
        doc.fontSize(BODY_SIZE).fillColor(INK);
        ensureRoom(doc, BODY_SIZE * 2);
        const top = doc.y;
        doc.text(mark, left + 4, top, { width: 18 });
        doc.text(item, left + 22, top, { width: width - 22, lineGap: 2 });
        doc.moveDown(0.15);
      });
      doc.moveDown(0.4);
      return;
    case 'table':
      table(doc, block.rows);
      return;
  }
}

/** 칸 너비: 칸마다 가장 긴 글에 맞춰 나누되 한 칸이 너무 좁거나 넓지 않게 */
function columnWidths(rows: string[][], total: number): number[] {
  const count = Math.max(...rows.map((r) => r.length));
  const weights = Array.from({ length: count }, (_, c) => Math.min(40, Math.max(4, ...rows.map((r) => (r[c] ?? '').length))));
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (total * w) / sum);
}

/** 표: 첫 줄은 머리줄(쪽이 넘어가면 다시 그린다). 칸 글은 줄을 바꿔 넣는다 */
function table(doc: Doc, rows: string[][]): void {
  if (!rows.length) return;
  const left = doc.page.margins.left;
  const widths = columnWidths(rows, contentWidth(doc));
  const count = widths.length;
  doc.fontSize(CELL_SIZE);
  const heightOf = (row: string[]) => Math.max(...widths.map((w, c) => doc.heightOfString(row[c] ?? '', { width: w - CELL_PAD * 2 }))) + CELL_PAD * 2;
  const drawRow = (row: string[], header: boolean) => {
    const height = heightOf(row);
    const top = doc.y;
    let x = left;
    for (let c = 0; c < count; c += 1) {
      if (header) doc.rect(x, top, widths[c], height).fill(HEAD_FILL);
      doc.rect(x, top, widths[c], height).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.fillColor(INK).fontSize(CELL_SIZE).text(row[c] ?? '', x + CELL_PAD, top + CELL_PAD, { width: widths[c] - CELL_PAD * 2 });
      x += widths[c];
    }
    doc.x = left;
    doc.y = top + height;
  };
  const [head, ...body] = rows;
  ensureRoom(doc, heightOf(head) + (body[0] ? heightOf(body[0]) : 0));
  drawRow(head, true);
  for (const row of body) {
    if (doc.y + heightOf(row) > bottom(doc)) {
      doc.addPage();
      drawRow(head, true);
    }
    drawRow(row, false);
  }
  doc.moveDown(0.6);
}

/** 쪽 아래 가운데 'FantaSteel ERP 심층 조사 #12 · 1/3' */
function drawPageNumbers(doc: Doc, id: number): void {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    const y = doc.page.height - doc.page.margins.bottom + 20;
    // 아래 여백에 쓰면 pdfkit이 새 쪽을 만들지 않게 여백을 잠깐 없앤다
    const margin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fontSize(8).fillColor(MUTED).text(`FantaSteel ERP 심층 조사 #${id} · ${i + 1}/${range.count}`, doc.page.margins.left, y, { width: contentWidth(doc), align: 'center', lineBreak: false });
    doc.page.margins.bottom = margin;
  }
}
