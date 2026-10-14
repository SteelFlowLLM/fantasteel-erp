// 품질 화면 그리기 테스트의 고정 데이터: 검사 입력 목록 줄, 검사 폼(판정 끝, 잠기지 않음), 불합격 관리 목록 줄.
// 번호·이름은 화면 글자를 확인할 만큼만 실제 모양을 따른다.
import type { RejectedLotListRow } from '@/api/dispositions';
import type { InspectionDetail, InspectionFormItem, InspectionQueueRow, LinkedSalesOrderItem } from '@/api/inspections';

const HEAT_NO = 'HT-BOF1-261005-001';

export function queueRow(lotId: number, over: Partial<InspectionQueueRow> = {}): InspectionQueueRow {
  return {
    lotId,
    lotNo: `SL-261005-${String(lotId).padStart(3, '0')}`,
    lotType: 'SLAB',
    lotStatus: 'AVAILABLE',
    processType: 'CONTINUOUS_CASTING',
    itemId: 11,
    itemCode: 'SL-SS275-250x1200x10000',
    itemName: 'SS275 슬래브 250×1200×10000',
    steelGradeCode: 'SS275',
    thicknessMm: '250.00',
    producedDate: '2026-10-05',
    heatLotId: 900,
    heatNo: HEAT_NO,
    heatResult: 'PASS',
    productionPlanNo: 'PP-2610-0001',
    qualityInspectionId: null,
    inspectionResult: 'PENDING',
    inspectionStandardCode: null,
    inspectionStandardVersion: null,
    inspectedAt: null,
    inspectorName: null,
    locked: false,
    ...over,
  };
}

const judged = (result: 'PASS' | 'FAIL', qualityInspectionId: number): Partial<InspectionQueueRow> => ({
  inspectionResult: result,
  qualityInspectionId,
  inspectionStandardCode: 'QS-SS275-CC',
  inspectionStandardVersion: 1,
  inspectedAt: '2026-10-06T01:00:00.000Z',
  inspectorName: '서민지',
});

/** 검사 입력 목록: 히트(판정 대기) · 슬래브 판정 대기 · 슬래브 합격 · 슬래브 불합격 */
export const QUEUE_ROWS: readonly InspectionQueueRow[] = [
  queueRow(900, { lotNo: HEAT_NO, lotType: 'HEAT', processType: 'STEELMAKING', thicknessMm: null, heatLotId: null, heatNo: null, heatResult: null }),
  queueRow(901),
  queueRow(902, judged('PASS', 51)),
  queueRow(903, judged('FAIL', 52)),
];

function formItem(id: number, code: string, name: string, unit: string, minValue: string | null, maxValue: string, measuredValue: string): InspectionFormItem {
  return {
    inspectionStandardItemId: id,
    inspectionItemCode: code,
    inspectionItemName: name,
    unit,
    minValue,
    maxValue,
    minThicknessMm: null,
    maxThicknessMm: null,
    isRequired: true,
    sortOrder: id,
    measuredValue,
    isPassed: true,
  };
}

/** 판정이 끝나(합격) 칸이 다 찬, 잠기지 않은 슬래브 검사 */
export function judgedInspectionDetail(): InspectionDetail {
  return {
    lot: queueRow(902, judged('PASS', 51)),
    qualityInspectionId: 51,
    updatedAt: '2026-10-06T01:00:00.000Z',
    inspectionResult: 'PASS',
    standard: { id: 7, inspectionStandardCode: 'QS-SS275-CC', version: 1, isCurrent: true },
    currentStandard: { id: 7, inspectionStandardCode: 'QS-SS275-CC', version: 1 },
    items: [formItem(1, 'THICKNESS_DEVIATION', '두께 편차', 'mm', '-3.000', '3.000', '1.000'), formItem(2, 'SURFACE_DEFECT', '표면 결함', '개', null, '0', '0')],
    locked: false,
    lockedMillSheetNos: [],
    productionPlanId: 300,
    heatLotId: 900,
    salesOrderItem: null,
    history: [],
    inspectionItemNames: {},
  };
}

const salesOrderItem = (reproductionNeedQty: number): LinkedSalesOrderItem => ({
  salesOrderId: 21,
  salesOrderNo: 'SO-2610-0001',
  salesOrderItemId: 31,
  lineNo: 1,
  customerName: '한빛조선',
  itemCode: 'SL-SS275-250x1200x10000',
  orderedQty: 10,
  dueDate: '2026-10-30',
  salesOrderItemStatus: 'OPEN',
  shortage: { unshippedQty: 10, unsecuredQty: 4, additionalPlanQty: 4, activeReservedQty: 6, openPlanRemainingQty: 0, reservationAvailableQty: 0, reproductionNeedQty },
});

export function rejectedRow(lotId: number, over: Partial<RejectedLotListRow> = {}): RejectedLotListRow {
  return {
    lotId,
    lotNo: `SL-261005-${String(lotId).padStart(3, '0')}`,
    lotType: 'SLAB',
    lotStatus: 'AVAILABLE',
    reason: 'FAILED',
    itemCode: 'SL-SS275-250x1200x10000',
    itemName: 'SS275 슬래브 250×1200×10000',
    steelGradeCode: 'SS275',
    heatNo: HEAT_NO,
    producedDate: '2026-10-05',
    productionPlanNo: 'PP-2610-0001',
    inspectedAt: '2026-10-06T01:00:00.000Z',
    failedItems: [{ inspectionItemCode: 'SURFACE_DEFECT', inspectionItemName: '표면 결함', unit: '개', minValue: null, maxValue: '0', measuredValue: '2' }],
    dispositionStatus: null,
    dispositionReason: null,
    dispositionAt: null,
    updatedAt: '2026-10-06T01:00:00.000Z',
    productionPlanId: 300,
    salesOrderItem: salesOrderItem(0),
    ...over,
  };
}

/** 불합격 관리 목록: 성분 불합격 히트와 그 하위 슬래브 2매(히트 불합격으로 제외), 따로 검사 불합격한 슬래브 1매 */
export const REJECTED_HEAT = rejectedRow(910, {
  lotNo: 'HT-BOF1-261006-001',
  lotType: 'HEAT',
  heatNo: null,
  itemCode: null,
  itemName: null,
  failedItems: [{ inspectionItemCode: 'P', inspectionItemName: '인(P)', unit: '%', minValue: null, maxValue: '0.050', measuredValue: '0.058' }],
  salesOrderItem: salesOrderItem(4),
});
export const REJECTED_HEAT_CHILDREN: readonly RejectedLotListRow[] = [911, 912].map((lotId) =>
  rejectedRow(lotId, { lotNo: `SL-261006-00${lotId - 910}`, reason: 'HEAT_FAILED', heatNo: REJECTED_HEAT.lotNo, failedItems: REJECTED_HEAT.failedItems, salesOrderItem: salesOrderItem(4) }),
);
export const REJECTED_ROWS: readonly RejectedLotListRow[] = [rejectedRow(903), REJECTED_HEAT, ...REJECTED_HEAT_CHILDREN];
