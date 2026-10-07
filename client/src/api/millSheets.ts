// 밀시트 API (REQ-SHP-003·004, BP-SHP-01 문서 보존).
// 밀시트는 출고 확정 때 core 서비스가 만든다(출하요청 × 수주 1장, 발행 시점 스냅샷). 화면은 스냅샷만으로 그린다.
// 'PDF 생성' = 브라우저 인쇄 → 성공하면 pdf_path를 남긴다 (생성 여부 = pdf_path 유무).
// NEXT_PUBLIC_DATA_SOURCE=server면 실제 서버를 부른다 (api/server/millSheets.ts). 밀시트·출하요청·수주 id는 서버 id다.
import { PERMISSION, type ProductItemType } from '@/codes';
import { mockMutation, mockQuery } from '@/api/client';
import { requireActor } from '@/api/actor';
import { isServerDataSource } from '@/api/http';
import { serverMillSheetApi } from '@/api/server/millSheets';
import type { MockTables } from '@/mock/schema';
import {
  asMillSheetSnapshot,
  listMillSheets,
  markMillSheetPdfGenerated,
  millSheetDetail,
  userActor,
  type MillSheetHeatSnapshot,
  type MillSheetInspectionSnapshot,
  type MillSheetItemSnapshot,
  type MillSheetLotSnapshot,
  type MillSheetSnapshot,
  type MillSheetSummary,
} from '@/mock/services';

type Tables = Readonly<MockTables>;

const READ_RULE = { view: [PERMISSION.MILL_SHEET_READ] } as const;
const PRINT_RULE = { use: [PERMISSION.MILL_SHEET_READ] } as const;

export const millSheetKeys = {
  all: ['millSheets'] as const,
  list: () => [...millSheetKeys.all, 'list'] as const,
  detail: (id: number) => [...millSheetKeys.all, 'detail', id] as const,
};

export type { MillSheetHeatSnapshot, MillSheetInspectionSnapshot, MillSheetItemSnapshot, MillSheetLotSnapshot, MillSheetSnapshot };

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

const isProductType = (value: string): value is ProductItemType => value === 'SLAB' || value === 'COIL';

function listRows(tables: Tables): MillSheetListRow[] {
  return listMillSheets(tables).map((summary) => {
    const row = tables.millSheet.find((m) => m.id === summary.id);
    const items = (row ? asMillSheetSnapshot(row.snapshot)?.items : undefined) ?? [];
    return {
      ...summary,
      itemTypes: [...new Set(items.map((i) => i.itemType).filter(isProductType))],
      itemCodes: [...new Set(items.map((i) => i.itemCode))],
    };
  });
}

export const millSheetApi = {
  list: () =>
    isServerDataSource()
      ? serverMillSheetApi.list()
      : mockQuery((tables) => {
          requireActor(tables, READ_RULE);
          return listRows(tables);
        }),
  detail: (id: number) =>
    isServerDataSource()
      ? serverMillSheetApi.detail(id)
      : mockQuery((tables): MillSheetDetailView => {
          requireActor(tables, READ_RULE);
          const { row, snapshot } = millSheetDetail(tables, id);
          return { id: row.id, millSheetNo: row.millSheetNo, shipmentRequestId: row.shipmentRequestId, salesOrderId: row.salesOrderId, issuedAt: row.issuedAt, pdfPath: row.pdfPath, snapshot };
        }),
  /** 인쇄(PDF 생성)가 끝난 뒤 pdf_path를 남긴다. 이미 있으면 그대로. 출고·스냅샷은 바꾸지 않는다. 서버 모드면 서버가 같은 스냅샷으로 PDF를 만들어 저장한다 */
  markPdfGenerated: (input: { millSheetId: number }) =>
    isServerDataSource()
      ? serverMillSheetApi.markPdfGenerated(input)
      : mockMutation((tx) => {
          const actor = requireActor(tx.tables, PRINT_RULE);
          const row = markMillSheetPdfGenerated(tx, userActor(actor.employee.id), input);
          return { id: row.id, millSheetNo: row.millSheetNo, pdfPath: row.pdfPath };
        }),
};
