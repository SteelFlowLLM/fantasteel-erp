// 밀시트 PDF를 브라우저에서 만들어 이름을 정해 내려받는다 (REQ-SHP-004, 'PDF 생성').
// 브라우저 인쇄 창은 환경에 따라 파일 이름을 못 채워서, PDF 파일을 직접 만들고 <a download>로 저장한다.
// 레이아웃은 서버와 같은 shared의 drawMillSheet를 쓰고, 파일 이름은 shared의 millSheetPdfFileName이다.
import PDFDocument from 'pdfkit';
import { MILL_SHEET_PDF_PAGE, drawMillSheet, millSheetPdfFileName, type MillSheetSnapshot as PdfSnapshot, type PdfDocLike } from '@fantasteel/shared';
import type { MillSheetInspectionSnapshot, MillSheetSnapshot } from '@/api/millSheets';

/** 한글 글꼴(Noto Sans KR, OFL). public/fonts에 두고 처음 만들 때 한 번 받는다 */
export const MILL_SHEET_FONT_URL = '/fonts/NotoSansKR-VF.ttf';

const toInspection = (i: MillSheetInspectionSnapshot | null): PdfSnapshot['items'][number]['lots'][number]['productInspection'] =>
  i && {
    lotNo: i.lotNo,
    processType: i.processType,
    inspectionStandardCode: i.inspectionStandardCode ?? '',
    version: i.version ?? 0,
    inspectionResult: i.inspectionResult,
    inspectedAt: i.inspectedAt ?? '',
    values: i.values.map((v) => ({
      inspectionItemCode: v.inspectionItemCode,
      inspectionItemName: v.inspectionItemName,
      unit: v.unit,
      minValue: v.minValue,
      maxValue: v.maxValue,
      measuredValue: v.measuredValue ?? '',
      isPassed: v.isPassed,
    })),
  };

/** 화면(목업) 스냅샷을 서버와 같은 모양으로 바꾼다. 다른 이름: 출하 예정일 requestedShipDate → shipDate */
export function toPdfSnapshot(s: MillSheetSnapshot): PdfSnapshot {
  return {
    millSheetNo: s.millSheetNo,
    issuedAt: s.issuedAt,
    issuedDate: s.issuedDate,
    customer: s.customer,
    salesOrder: s.salesOrder,
    shipmentRequest: {
      shipmentRequestId: s.shipmentRequest.shipmentRequestId,
      shipmentRequestNo: s.shipmentRequest.shipmentRequestNo,
      shipDate: s.shipmentRequest.requestedShipDate,
      issuedAt: s.shipmentRequest.issuedAt,
      issuedEmployeeName: s.shipmentRequest.issuedEmployeeName,
    },
    items: s.items.map((i) => ({
      salesOrderItemId: i.salesOrderItemId,
      itemId: i.itemId,
      itemCode: i.itemCode,
      itemName: i.itemName,
      itemType: i.itemType,
      steelGradeCode: i.steelGradeCode,
      standardNo: i.standardNo,
      thicknessMm: i.thicknessMm,
      widthMm: i.widthMm,
      lengthMm: i.lengthMm,
      theoreticalWeightTon: i.theoreticalWeightTon,
      qty: i.qty,
      totalWeightTon: i.totalWeightTon,
      lots: i.lots.map((l) => ({
        lotId: l.lotId,
        lotNo: l.lotNo,
        lotType: l.lotType,
        producedDate: l.producedDate,
        theoreticalWeightTon: l.theoreticalWeightTon,
        heatLotId: l.heatLotId,
        heatNo: l.heatNo,
        slabNo: l.slabNo,
        productInspection: toInspection(l.productInspection),
      })),
    })),
    heats: s.heats.map((h) => ({
      heatLotId: h.heatLotId,
      heatNo: h.heatNo,
      converterCode: h.converterCode,
      producedDate: h.producedDate,
      steelGradeCode: h.steelGradeCode,
      inspection: toInspection(h.inspection),
    })),
    totalQty: s.totalQty,
    totalWeightTon: s.totalWeightTon,
    lotIds: s.lotIds,
  };
}

/** 스냅샷을 A4 PDF 바이트로 그린다. 글꼴 바이트를 못 읽으면 던진다 */
export function buildMillSheetPdf(snapshot: PdfSnapshot, fontBytes: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    // font: null — 기본 글꼴(Helvetica)은 브라우저 빌드에서 따로 등록해야 해서 쓰지 않고, 한글 글꼴만 쓴다
    const doc = new PDFDocument({ ...MILL_SHEET_PDF_PAGE, font: null, info: { Title: snapshot.millSheetNo, Producer: 'FantaSteel ERP' } } as unknown as PDFKit.PDFDocumentOptions);
    const chunks: Uint8Array[] = [];
    doc.on('data', (chunk: Uint8Array) => chunks.push(chunk));
    doc.on('end', () => {
      const bytes = new Uint8Array(chunks.reduce((sum, c) => sum + c.byteLength, 0));
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      resolve(bytes);
    });
    doc.on('error', reject);
    try {
      doc.registerFont('body', fontBytes as unknown as ArrayBuffer);
      doc.font('body');
      drawMillSheet(doc as unknown as PdfDocLike, snapshot);
      doc.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

let fontCache: Promise<Uint8Array> | null = null;

/** 글꼴은 한 번만 받는다. 실패하면 다음 시도에서 다시 받는다 */
function loadFont(): Promise<Uint8Array> {
  fontCache ??= fetch(MILL_SHEET_FONT_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`글꼴을 받지 못했어요 (${response.status})`);
      return response.arrayBuffer();
    })
    .then((buffer) => new Uint8Array(buffer))
    .catch((error: unknown) => {
      fontCache = null;
      throw error;
    });
  return fontCache;
}

/** PDF를 만들어 저장 이름 양식({밀시트 번호}_{고객사}_{발행일}.pdf)으로 내려받는다. 만든 파일 이름을 돌려준다 */
export async function downloadMillSheetPdf(snapshot: MillSheetSnapshot): Promise<string> {
  const pdfSnapshot = toPdfSnapshot(snapshot);
  const fileName = millSheetPdfFileName(pdfSnapshot);
  const bytes = await buildMillSheetPdf(pdfSnapshot, await loadFont());
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // 내려받기가 시작된 뒤에 풀어야 해서 한 박자 늦춘다
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return fileName;
}
