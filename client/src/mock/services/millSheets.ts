// 밀시트 (REQ-SHP-003·004, BP-SHP-01 문서 보존, 13.3 createMillSheetSnapshot / generatePdf).
// - 출고 확정 때 출하요청 × 수주마다 1장 (ERD unique), 번호 MS-{출하요청 일련}-N (N = 출하요청 안의 수주별 순번).
// - 발행 시점의 고객사·수주·규격·LOT·히트·이론중량·검사 항목과 값(히트 성분 + 슬래브 또는 코일 검사, 기준 버전)·발행일을 스냅샷으로 복사한다.
// - PDF는 같은 스냅샷을 브라우저 인쇄로 만든다. 생성 여부는 pdf_path 유무. 출고를 다시 실행하지 않는다.
import { calcWeightTon, sumTon } from '@/lib/weight';
import { recordBusinessEvent } from '@/mock/businessEvents';
import type { JsonValue, LotRow, MillSheetRow, MockTables, SalesOrderItemRow, ShipmentRequestRow } from '@/mock/schema';
import { issueMillSheetNo } from '@/mock/sequence';
import { insertRow, updateRow, type MockTx } from '@/mock/store';
import { employeeNameOf, findById, inputError, mustGet, seoulDateOf, steelGradeCodeOf, SYSTEM_ACTOR, uniqueIds, type PersonActor } from '@/mock/services/context';

type Tables = Readonly<MockTables>;

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

export type MillSheetLotSnapshot = {
  lotId: number;
  lotNo: string;
  lotType: string;
  producedDate: string;
  theoreticalWeightTon: string;
  heatLotId: number | null;
  heatLotNo: string | null;
  /** 코일이면 투입한 슬래브 LOT 번호 */
  slabLotNo: string | null;
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

export type MillSheetHeatSnapshot = {
  heatLotId: number;
  heatLotNo: string;
  converterCode: string | null;
  producedDate: string;
  steelGradeCode: string | null;
  /** 히트 성분 검사 */
  inspection: MillSheetInspectionSnapshot | null;
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

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 저장된 스냅샷(jsonb)을 밀시트 스냅샷으로 읽는다 */
export function asMillSheetSnapshot(value: JsonValue): MillSheetSnapshot | null {
  if (!isRecord(value) || typeof value.millSheetNo !== 'string' || !Array.isArray(value.items)) return null;
  return value as unknown as MillSheetSnapshot;
}

/** 스냅샷에 들어간 LOT id (제품 + 히트) */
export function millSheetLotIdsOf(value: JsonValue): number[] {
  if (!isRecord(value) || !Array.isArray(value.lotIds)) return [];
  return value.lotIds.filter((id): id is number => typeof id === 'number');
}

function inspectionSnapshotOf(tables: Tables, lot: LotRow): MillSheetInspectionSnapshot | null {
  const inspection = tables.qualityInspection.find((q) => q.lotId === lot.id);
  if (!inspection) return null;
  const standard = findById(tables, 'inspectionStandard', inspection.inspectionStandardId);
  const items = tables.inspectionStandardItem.filter((i) => i.inspectionStandardId === inspection.inspectionStandardId);
  const values = tables.qualityInspectionValue
    .filter((v) => v.qualityInspectionId === inspection.id)
    .map((v) => ({ v, item: items.find((i) => i.id === v.inspectionStandardItemId) }))
    .sort((a, b) => (a.item?.sortOrder ?? 0) - (b.item?.sortOrder ?? 0) || a.v.id - b.v.id);
  return {
    lotNo: lot.lotNo,
    processType: inspection.processType,
    inspectionStandardCode: standard?.inspectionStandardCode ?? null,
    version: standard?.version ?? null,
    inspectionResult: inspection.inspectionResult,
    inspectedAt: inspection.inspectedAt,
    values: values.map(({ v, item }) => ({
      inspectionItemCode: item?.inspectionItemCode ?? '',
      inspectionItemName: item?.inspectionItemName ?? '',
      unit: item?.unit ?? null,
      minValue: item?.minValue ?? null,
      maxValue: item?.maxValue ?? null,
      measuredValue: v.measuredValue,
      isPassed: v.isPassed,
    })),
  };
}

/** 출고한 LOT으로 밀시트 1장을 만든다 (출고 확정 안에서 부른다). 이벤트 MILL_SHEET_ISSUED (주체 SYSTEM). */
export function createMillSheet(
  tx: MockTx,
  input: { shipmentRequest: ShipmentRequestRow; salesOrderId: number; lines: readonly { soItem: SalesOrderItemRow; lots: readonly LotRow[] }[] },
): MillSheetRow {
  const tables = tx.tables;
  if (tables.millSheet.some((m) => m.shipmentRequestId === input.shipmentRequest.id && m.salesOrderId === input.salesOrderId)) {
    inputError('shipmentRequestId', '이 출하요청·수주의 밀시트가 이미 있어요');
  }
  const salesOrder = mustGet(tables, 'salesOrder', input.salesOrderId, '수주');
  const customer = mustGet(tables, 'customer', salesOrder.customerId, '고객사');
  const millSheetNo = issueMillSheetNo(tx, input.shipmentRequest.shipmentRequestNo);
  const heatIds = new Set<number>();
  const items: MillSheetItemSnapshot[] = input.lines.map(({ soItem, lots }) => {
    const item = mustGet(tables, 'item', soItem.itemId, '규격');
    const grade = findById(tables, 'steelGrade', item.steelGradeId);
    const unitWeight = item.theoreticalWeightTon ?? '0.000';
    return {
      salesOrderItemId: soItem.id,
      lineNo: soItem.lineNo,
      itemId: item.id,
      itemCode: item.itemCode,
      itemName: item.itemName,
      itemType: item.itemType,
      steelGradeCode: grade?.steelGradeCode ?? null,
      standardNo: grade?.standardNo ?? null,
      thicknessMm: item.thicknessMm,
      widthMm: item.widthMm,
      lengthMm: item.lengthMm,
      theoreticalWeightTon: unitWeight,
      qty: lots.length,
      totalWeightTon: calcWeightTon(lots.length, unitWeight),
      lots: lots.map((lot) => {
        const heat = findById(tables, 'lot', lot.heatLotId);
        if (heat) heatIds.add(heat.id);
        const slabRelation = lot.lotType === 'COIL' ? tables.lotRelation.find((r) => r.childLotId === lot.id) : undefined;
        return {
          lotId: lot.id,
          lotNo: lot.lotNo,
          lotType: lot.lotType,
          producedDate: lot.producedDate,
          theoreticalWeightTon: unitWeight,
          heatLotId: heat?.id ?? null,
          heatLotNo: heat?.lotNo ?? null,
          slabLotNo: slabRelation ? (findById(tables, 'lot', slabRelation.parentLotId)?.lotNo ?? null) : null,
          productInspection: inspectionSnapshotOf(tables, lot),
        };
      }),
    };
  });
  const heats: MillSheetHeatSnapshot[] = uniqueIds(heatIds).map((id) => {
    const heat = mustGet(tables, 'lot', id, '히트');
    return {
      heatLotId: heat.id,
      heatLotNo: heat.lotNo,
      converterCode: heat.converterCode,
      producedDate: heat.producedDate,
      steelGradeCode: steelGradeCodeOf(tables, heat.steelGradeId),
      inspection: inspectionSnapshotOf(tables, heat),
    };
  });
  const productLotIds = input.lines.flatMap((l) => l.lots.map((lot) => lot.id));
  const snapshot: MillSheetSnapshot = {
    millSheetNo,
    issuedAt: tx.nowIso,
    issuedDate: seoulDateOf(tx.nowIso),
    customer: { customerId: customer.id, customerCode: customer.customerCode, customerName: customer.customerName },
    salesOrder: { salesOrderId: salesOrder.id, salesOrderNo: salesOrder.salesOrderNo },
    shipmentRequest: {
      shipmentRequestId: input.shipmentRequest.id,
      shipmentRequestNo: input.shipmentRequest.shipmentRequestNo,
      requestedShipDate: input.shipmentRequest.requestedShipDate,
      issuedAt: input.shipmentRequest.issuedAt,
      issuedEmployeeName: employeeNameOf(tables, input.shipmentRequest.issuedEmployeeId),
    },
    items,
    heats,
    totalQty: productLotIds.length,
    totalWeightTon: sumTon(items.map((i) => i.totalWeightTon)),
    lotIds: uniqueIds([...productLotIds, ...heatIds]),
  };
  const row = insertRow(tx, 'millSheet', {
    millSheetNo,
    shipmentRequestId: input.shipmentRequest.id,
    salesOrderId: salesOrder.id,
    issuedAt: tx.nowIso,
    snapshot,
    pdfPath: null,
  });
  recordBusinessEvent(tx, {
    businessEventType: 'MILL_SHEET_ISSUED',
    actor: SYSTEM_ACTOR,
    targetType: 'mill_sheet',
    targetId: row.id,
    targetNo: millSheetNo,
    salesOrderId: salesOrder.id,
    afterData: { millSheetNo, shipmentRequestNo: input.shipmentRequest.shipmentRequestNo, salesOrderNo: salesOrder.salesOrderNo, heatLotNos: heats.map((h) => h.heatLotNo), totalQty: snapshot.totalQty },
    lotIds: snapshot.lotIds,
  });
  return row;
}

/** PDF 저장 경로 (가짜 저장소): mill-sheets/<밀시트 번호>.pdf */
export const millSheetPdfPathOf = (millSheetNo: string): string => `mill-sheets/${millSheetNo}.pdf`;

/**
 * 'PDF 생성'(브라우저 인쇄) 뒤 pdf_path를 남긴다. 이미 있으면 그대로 둔다. 출고·스냅샷은 바꾸지 않는다.
 * (렌더 실패 경로는 화면이 SHP-001로 알리고, 이 함수를 부르지 않는다.) 작업 로그 유형이 없어 이벤트는 남기지 않는다.
 */
export function markMillSheetPdfGenerated(tx: MockTx, _actor: PersonActor, input: { millSheetId: number }): MillSheetRow {
  const row = mustGet(tx.tables, 'millSheet', input.millSheetId, '밀시트');
  if (row.pdfPath) return row;
  return updateRow(tx, 'millSheet', row.id, { pdfPath: millSheetPdfPathOf(row.millSheetNo) }) ?? row;
}

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
  heatLotNos: string[];
  pdfPath: string | null;
}

export function listMillSheets(tables: Tables): MillSheetSummary[] {
  return [...tables.millSheet]
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt) || b.id - a.id)
    .map((row) => {
      const snapshot = asMillSheetSnapshot(row.snapshot);
      return {
        id: row.id,
        millSheetNo: row.millSheetNo,
        shipmentRequestId: row.shipmentRequestId,
        shipmentRequestNo: snapshot?.shipmentRequest.shipmentRequestNo ?? findById(tables, 'shipmentRequest', row.shipmentRequestId)?.shipmentRequestNo ?? '',
        salesOrderId: row.salesOrderId,
        salesOrderNo: snapshot?.salesOrder.salesOrderNo ?? '',
        customerName: snapshot?.customer.customerName ?? '',
        issuedAt: row.issuedAt,
        totalQty: snapshot?.totalQty ?? 0,
        totalWeightTon: snapshot?.totalWeightTon ?? '0.000',
        heatLotNos: snapshot?.heats.map((h) => h.heatLotNo) ?? [],
        pdfPath: row.pdfPath,
      };
    });
}

export function millSheetDetail(tables: Tables, millSheetId: number): { row: MillSheetRow; snapshot: MillSheetSnapshot } {
  const row = mustGet(tables, 'millSheet', millSheetId, '밀시트');
  const snapshot = asMillSheetSnapshot(row.snapshot);
  if (!snapshot) inputError('millSheetId', '밀시트 스냅샷을 읽지 못했어요');
  return { row, snapshot };
}
