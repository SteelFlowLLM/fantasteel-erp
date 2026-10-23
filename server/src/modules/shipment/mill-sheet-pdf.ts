import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { MILL_SHEET_PDF_PAGE, drawMillSheet, type MillSheetSnapshot, type PdfDocLike } from '@fantasteel/shared';

// 밀시트 PDF 렌더링 (REQ-SHP-004, 업무 프로세스 13.3 generatePdf). 저장된 스냅샷만 읽고 DB·현재 값은 읽지 않는다.
// 레이아웃은 화면(브라우저 pdfkit)과 같은 코드를 쓰려고 shared의 drawMillSheet에 있다.

/** 한글 폰트. 환경변수로 바꿀 수 있고, 기본은 저장소에 포함한 Noto Sans KR (server/assets/fonts) */
export const millSheetFontPath = (): string => process.env.MILL_SHEET_FONT ?? join(process.cwd(), 'assets', 'fonts', 'NotoSansKR-VF.ttf');

/** 스냅샷을 A4 PDF로 그린다. 폰트를 못 읽으면 pdfkit이 던지고, 호출한 쪽이 SHP-001로 바꾼다 */
export function renderMillSheetPdf(snapshot: MillSheetSnapshot, fontPath: string = millSheetFontPath()): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ ...MILL_SHEET_PDF_PAGE, info: { Title: snapshot.millSheetNo, Producer: 'FantaSteel ERP' } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      doc.registerFont('body', fontPath);
      doc.font('body');
      drawMillSheet(doc as unknown as PdfDocLike, snapshot);
      doc.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
