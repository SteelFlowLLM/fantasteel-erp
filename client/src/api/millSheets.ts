// 밀시트 API (REQ-SHP-003·004, BP-SHP-01 문서 보존).
// 밀시트는 출고 확정 때 서버가 만든다(출하요청 × 수주 1장, 발행 시점 스냅샷). 화면은 스냅샷만으로 그린다.
// 'PDF 생성' = 브라우저 인쇄 → 성공하면 pdf_path를 남긴다 (생성 여부 = pdf_path 유무).
// 서버를 부른다 (api/server/millSheets.ts). 밀시트·출하요청·수주 id는 서버 id다.
import { type ProductItemType } from '@/codes';
import { serverMillSheetApi } from '@/api/server/millSheets';

export type MillSheetInspectionSnapshot = {
  lotNo: string;
  processType: string;
  inspectionStandardCode: string | null;
  version: number | null;
  inspectionResult: string;
  inspectedAt: string | null;
  values: {
    inspectionItemCode: string;
    inspectionItemName: string;
    unit: string | null;
    minValue: string | null;
    maxValue: string | null;
    measuredValue: string | null;
    isPassed: boolean | null;
  }[];
};

export type MillSheetHeatSnapshot = {
  heatLotId: number;
  heatNo: string;
  converterCode: string | null;
  producedDate: string;
  steelGradeCode: string | null;
  /** 히트 성분 검사 */
  inspection: MillSheetInspectionSnapshot | null;
};

export type MillSheetLotSnapshot = {
  lotId: number;
  lotNo: string;
  lotType: string;
  producedDate: string;
  theoreticalWeightTon: string;
  heatLotId: number | null;
  heatNo: string | null;
  /** 코일이면 투입한 슬래브 LOT 번호 */
  slabNo: string | null;
  /** 슬래브 검사(표면·치수) 또는 코일 검사(치수·기계적 성질) */
  productInspection: MillSheetInspectionSnapshot | null;
};

export type MillSheetItemSnapshot = {
  salesOrderItemId: number;
  lineNo: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  itemType: string;
  steelGradeCode: string | null;
  standardNo: string | null;
  thicknessMm: string | null;
  widthMm: string | null;
  lengthMm: string | null;
  theoreticalWeightTon: string;
  qty: number;
  totalWeightTon: string;
  lots: MillSheetLotSnapshot[];
};

export type MillSheetSnapshot = {
  millSheetNo: string;
  issuedAt: string;
  issuedDate: string;
  customer: { customerId: number; customerCode: string; customerName: string };
  salesOrder: { salesOrderId: number; salesOrderNo: string };
  shipmentRequest: { shipmentRequestId: number; shipmentRequestNo: string; requestedShipDate: string; issuedAt: string | null; issuedEmployeeName: string | null };
  items: MillSheetItemSnapshot[];
  heats: MillSheetHeatSnapshot[];
  totalQty: number;
  totalWeightTon: string;
  /** 스냅샷에 들어간 제품·히트 LOT id (검사값 수정 잠금 확인용) */
  lotIds: number[];
};

export interface MillSheetSummary {
  id: number;
  millSheetNo: string;
  shipmentRequestId: number;
  shipmentRequestNo: string;
  salesOrderId: number;
  salesOrderNo: string;
  customerName: string;
  issuedAt: string;
  totalQty: number;
  totalWeightTon: string;
  heatNos: string[];
  pdfPath: string | null;
}

export const millSheetKeys = {
  all: ['millSheets'] as const,
  list: () => [...millSheetKeys.all, 'list'] as const,
  detail: (id: number) => [...millSheetKeys.all, 'detail', id] as const,
};

export interface MillSheetListRow extends MillSheetSummary {
  itemTypes: ProductItemType[];
  itemCodes: string[];
}

export interface MillSheetDetailView {
  id: number;
  millSheetNo: string;
  shipmentRequestId: number;
  salesOrderId: number;
  issuedAt: string;
  pdfPath: string | null;
  snapshot: MillSheetSnapshot;
}

export const millSheetApi = {
  list: () => serverMillSheetApi.list(),
  detail: (id: number) => serverMillSheetApi.detail(id),
  /** 인쇄(PDF 생성)가 끝난 뒤 pdf_path를 남긴다. 이미 있으면 그대로. 출고·스냅샷은 바꾸지 않는다. 서버가 같은 스냅샷으로 PDF를 만들어 저장한다 */
  markPdfGenerated: (input: { millSheetId: number }) => serverMillSheetApi.markPdfGenerated(input),
};
