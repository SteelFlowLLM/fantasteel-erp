import { calcWeightTon, sumTon, type MillSheetHeatSnapshot, type MillSheetInspectionSnapshot, type MillSheetItemSnapshot, type MillSheetSnapshot } from '@fantasteel/shared';
import { seoulToday } from '../../common/time/seoul-date';

// 밀시트 스냅샷 계산 (REQ-SHP-003, 업무 프로세스 13.3 createMillSheetSnapshot). DB를 읽지 않는 순수 함수라 단위 테스트로 검증한다.

export interface SnapshotInspectionInput {
  inspectionResult: string;
  inspectedAt: Date;
  processType: string;
  inspectionStandardCode: string;
  versionNo: number;
  values: { inspectionItemCode: string; inspectionItemName: string; unit: string | null; minValue: string | null; maxValue: string | null; measuredValue: string }[];
}

export interface SnapshotHeatInput {
  id: number;
  lotNo: string;
  producedDate: Date | null;
  converterCode: string | null;
  steelGradeCode: string | null;
  inspection: SnapshotInspectionInput | null;
}

export interface SnapshotLotInput {
  id: number;
  lotNo: string;
  lotType: string;
  producedDate: Date | null;
  /** 코일이면 투입한 슬래브 LOT 번호 */
  slabNo: string | null;
  heat: SnapshotHeatInput | null;
  inspection: SnapshotInspectionInput | null;
}

export interface SnapshotItemInput {
  salesOrderItemId: number;
  item: {
    id: number;
    itemCode: string;
    itemName: string;
    itemType: string;
    steelGradeCode: string | null;
    standardNo: string | null;
    thicknessMm: string | null;
    widthMm: string | null;
    lengthMm: string | null;
    theoreticalWeightTon: string | null;
  };
  lots: SnapshotLotInput[];
}

export interface MillSheetSnapshotInput {
  millSheetNo: string;
  issuedAt: Date;
  customer: { id: number; customerCode: string; customerName: string };
  salesOrder: { id: number; salesOrderNo: string };
  shipmentRequest: { id: number; shipmentRequestNo: string; shipDate: Date | null; issuedEmployeeName: string | null };
  items: SnapshotItemInput[];
}

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** 기준(이상·이하, 경계 포함) 안인지. 기준이 없으면 null. 소수 4자리 값이라 Number로 비교해도 오차가 나지 않는다 */
function isWithin(measured: string, min: string | null, max: string | null): boolean | null {
  if (min === null && max === null) return null;
  const value = Number(measured);
  return (min === null || value >= Number(min)) && (max === null || value <= Number(max));
}

function toInspectionSnapshot(lotNo: string, input: SnapshotInspectionInput | null): MillSheetInspectionSnapshot | null {
  if (!input) return null;
  return {
    lotNo,
    processType: input.processType,
    inspectionStandardCode: input.inspectionStandardCode,
    version: input.versionNo,
    inspectionResult: input.inspectionResult,
    inspectedAt: input.inspectedAt.toISOString(),
    values: input.values.map((v) => ({ ...v, isPassed: isWithin(v.measuredValue, v.minValue, v.maxValue) })),
  };
}

/** 발행 시점의 고객사·수주·규격·LOT·히트·이론중량·검사 항목과 값을 복사한다. 이후 원본이 바뀌어도 이 값은 그대로다 */
export function buildMillSheetSnapshot(input: MillSheetSnapshotInput): MillSheetSnapshot {
  const heatsById = new Map<number, MillSheetHeatSnapshot>();
  const items: MillSheetItemSnapshot[] = input.items.map(({ salesOrderItemId, item, lots }) => {
    const theoreticalWeightTon = item.theoreticalWeightTon ?? '0.000';
    return {
      salesOrderItemId,
      itemId: item.id,
      itemCode: item.itemCode,
      itemName: item.itemName,
      itemType: item.itemType,
      steelGradeCode: item.steelGradeCode,
      standardNo: item.standardNo,
      thicknessMm: item.thicknessMm,
      widthMm: item.widthMm,
      lengthMm: item.lengthMm,
      theoreticalWeightTon,
      qty: lots.length,
      totalWeightTon: calcWeightTon(lots.length, theoreticalWeightTon),
      lots: lots.map((lot) => {
        if (lot.heat && !heatsById.has(lot.heat.id)) {
          heatsById.set(lot.heat.id, {
            heatLotId: lot.heat.id,
            heatNo: lot.heat.lotNo,
            converterCode: lot.heat.converterCode,
            producedDate: dateOnly(lot.heat.producedDate),
            steelGradeCode: lot.heat.steelGradeCode,
            inspection: toInspectionSnapshot(lot.heat.lotNo, lot.heat.inspection),
          });
        }
        return {
          lotId: lot.id,
          lotNo: lot.lotNo,
          lotType: lot.lotType,
          producedDate: dateOnly(lot.producedDate),
          theoreticalWeightTon,
          heatLotId: lot.heat?.id ?? null,
          heatNo: lot.heat?.lotNo ?? null,
          slabNo: lot.slabNo,
          productInspection: toInspectionSnapshot(lot.lotNo, lot.inspection),
        };
      }),
    };
  });
  const heats = [...heatsById.values()].sort((a, b) => a.heatLotId - b.heatLotId);
  const productLotIds = items.flatMap((i) => i.lots.map((l) => l.lotId));
  return {
    millSheetNo: input.millSheetNo,
    issuedAt: input.issuedAt.toISOString(),
    issuedDate: seoulToday(input.issuedAt),
    customer: { customerId: input.customer.id, customerCode: input.customer.customerCode, customerName: input.customer.customerName },
    salesOrder: { salesOrderId: input.salesOrder.id, salesOrderNo: input.salesOrder.salesOrderNo },
    shipmentRequest: {
      shipmentRequestId: input.shipmentRequest.id,
      shipmentRequestNo: input.shipmentRequest.shipmentRequestNo,
      shipDate: dateOnly(input.shipmentRequest.shipDate),
      issuedAt: input.issuedAt.toISOString(),
      issuedEmployeeName: input.shipmentRequest.issuedEmployeeName,
    },
    items,
    heats,
    totalQty: productLotIds.length,
    totalWeightTon: sumTon(items.map((i) => i.totalWeightTon)),
    lotIds: [...new Set([...productLotIds, ...heats.map((h) => h.heatLotId)])].sort((a, b) => a - b),
  };
}
