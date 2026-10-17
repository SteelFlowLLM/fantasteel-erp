import PDFDocument from 'pdfkit';

/** 시험용 작은 PDF (쪽마다 글 한 줄, 압축 없음). 표준 글꼴이라 한글은 쓰지 않는다 */
export function tinyPdf(pages: readonly string[], title?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ compress: false, autoFirstPage: false, info: title ? { Title: title } : {} });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    for (const text of pages) doc.addPage().text(text);
    doc.end();
  });
}
