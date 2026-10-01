// 출고 확정 API (REQ-SHP-002·003, REQ-INV-005, REQ-SO-005, BP-SHP-01).
// 별도 출고 테이블·번호가 없다: 출하요청의 issued_at·issued_employee_id와 상태 ISSUED로 남는다.
// 재검증·전환·밀시트 발행·작업 로그는 core 서비스(confirmGoodsIssue)가 한 트랜잭션에서 한다.
import { PERMISSION, type InspectionResult, type LotStatus, type ShipmentRequestStatus } from '@/codes';
import { mockMutation, mockQuery } from '@/api/client';
import { requireActor } from '@/api/actor';
import type { ProductEligibility } from '@/lib/eligibility';
import type { MockTables } from '@/mock/schema';
import {
  confirmGoodsIssue,
  findById,
  goodsIssueCheck,
  goodsIssueQueue,
  heatOf,
  listShipmentRequests,
  lotEligibility,
  shipmentRequestDetail,
  userActor,
  type GoodsIssueProblem,
  type ShipmentRequestDetail,
} from '@/mock/services';

type Tables = Readonly<MockTables>;

const READ_RULE = { view: [PERMISSION.GOODS_ISSUE_CONFIRM] } as const;
const CONFIRM_RULE = { use: [PERMISSION.GOODS_ISSUE_CONFIRM] } as const;

export const goodsIssueKeys = {
  all: ['goodsIssues'] as const,
  queue: () => [...goodsIssueKeys.all, 'queue'] as const,
  detail: (shipmentRequestId: number) => [...goodsIssueKeys.all, 'detail', shipmentRequestId] as const,
};

export type { GoodsIssueProblem };

export interface GoodsIssueQueueRow {
  shipmentRequestId: number;
  shipmentRequestNo: string;
  shipmentRequestStatus: ShipmentRequestStatus;
  customerName: string;
  requestedShipDate: string;
  totalRequestQty: number;
  totalAllocatedQty: number;
  totalWeightTon: string;
  issuedAt: string | null;
  issuedEmployeeName: string | null;
  /** 출고 확정을 누를 수 있는지 (재검증 통과) */
  ready: boolean;
  problems: GoodsIssueProblem[];
}

export interface GoodsIssueLotRow {
  allocationId: number;
  allocationStatus: 'CONFIRMED' | 'CONSUMED' | 'RELEASED';
  lotId: number;
  lotNo: string;
  producedDate: string;
  heatLotNo: string | null;
  lotStatus: LotStatus;
  /** 제품 검사 판정 (검사 행이 없으면 null) */
  productInspectionResult: InspectionResult | null;
  /** 상위 히트 성분 판정 */
  heatInspectionResult: InspectionResult | null;
  /** 지금 출고할 수 있는 제품인지 (적격·미소진) */
  eligibility: ProductEligibility;
}

export interface GoodsIssueLineView {
  shipmentRequestItemId: number;
  lineNo: number;
  salesOrderId: number;
  salesOrderNo: string;
  salesOrderLineNo: number;
  itemCode: string;
  itemType: 'SLAB' | 'COIL';
  requestQty: number;
  requestTon: string;
  /** 1매(개) 이론중량 */
  unitWeightTon: string;
  orderedQty: number;
  shippedQty: number;
  salesOrderItemStatus: 'OPEN' | 'PARTIALLY_SHIPPED' | 'SHIPPED' | 'CANCELLED';
  /** 이 품목의 출고 전환(CONVERTED) 예약 매수 합계 */
  convertedQty: number;
  lots: GoodsIssueLotRow[];
}

export interface GoodsIssueView extends Omit<ShipmentRequestDetail, 'lines'> {
  lines: GoodsIssueLineView[];
  ready: boolean;
  problems: GoodsIssueProblem[];
}

const inspectionResultOf = (tables: Tables, lotId: number | null | undefined): InspectionResult | null =>
  lotId === null || lotId === undefined ? null : (tables.qualityInspection.find((q) => q.lotId === lotId)?.inspectionResult ?? null);

function queueRows(tables: Tables): GoodsIssueQueueRow[] {
  const summaries = new Map(listShipmentRequests(tables).map((s) => [s.id, s]));
  return goodsIssueQueue(tables).flatMap((row) => {
    const summary = summaries.get(row.shipmentRequestId);
    if (!summary) return [];
    return [
      {
        shipmentRequestId: row.shipmentRequestId,
        shipmentRequestNo: row.shipmentRequestNo,
        shipmentRequestStatus: row.shipmentRequestStatus,
        customerName: summary.customerName,
        requestedShipDate: summary.requestedShipDate,
        totalRequestQty: summary.totalRequestQty,
        totalAllocatedQty: summary.totalAllocatedQty,
        totalWeightTon: summary.totalWeightTon,
        issuedAt: summary.issuedAt,
        issuedEmployeeName: summary.issuedEmployeeName,
        ready: row.ready,
        problems: row.problems,
      },
    ];
  });
}

function issueView(tables: Tables, shipmentRequestId: number): GoodsIssueView {
  const detail = shipmentRequestDetail(tables, shipmentRequestId);
  const check = detail.shipmentRequestStatus === 'ISSUED' ? { ready: false, problems: [] } : goodsIssueCheck(tables, shipmentRequestId);
  return {
    ...detail,
    ready: check.ready,
    problems: check.problems,
    lines: detail.lines.map((line) => {
      const soItem = findById(tables, 'salesOrderItem', line.salesOrderItemId);
      return {
        shipmentRequestItemId: line.shipmentRequestItemId,
        lineNo: line.lineNo,
        salesOrderId: line.salesOrderId,
        salesOrderNo: line.salesOrderNo,
        salesOrderLineNo: line.salesOrderLineNo,
        itemCode: line.itemCode,
        itemType: line.itemType,
        requestQty: line.requestQty,
        requestTon: line.requestTon,
        unitWeightTon: line.unitWeightTon,
        orderedQty: soItem?.orderedQty ?? 0,
        shippedQty: soItem?.shippedQty ?? 0,
        salesOrderItemStatus: soItem?.salesOrderItemStatus ?? 'OPEN',
        convertedQty: tables.reservation
          .filter((r) => r.salesOrderItemId === line.salesOrderItemId && r.reservationStatus === 'CONVERTED')
          .reduce((sum, r) => sum + r.reservedQty, 0),
        lots: line.allocations.map((a) => {
          const lot = findById(tables, 'lot', a.lotId);
          const heat = lot ? heatOf(tables, lot) : undefined;
          return {
            allocationId: a.allocationId,
            allocationStatus: a.allocationStatus,
            lotId: a.lotId,
            lotNo: a.lotNo,
            producedDate: a.producedDate,
            heatLotNo: a.heatLotNo,
            lotStatus: lot?.lotStatus ?? 'AVAILABLE',
            productInspectionResult: inspectionResultOf(tables, a.lotId),
            heatInspectionResult: inspectionResultOf(tables, heat?.id),
            eligibility: lot ? lotEligibility(tables, lot) : 'NOT_AVAILABLE',
          };
        }),
      };
    }),
  };
}

export const goodsIssueApi = {
  /** 출고 확정 화면 왼쪽 목록: 배정 확정 → 배정 대기 → 출고 완료 순 */
  queue: () =>
    mockQuery((tables) => {
      requireActor(tables, READ_RULE);
      return queueRows(tables);
    }),
  /** 출고 확정 화면 본문: 배정 LOT과 품질·재고 재검증 결과 */
  detail: (shipmentRequestId: number) =>
    mockQuery((tables) => {
      requireActor(tables, READ_RULE);
      return issueView(tables, shipmentRequestId);
    }),
  /** 출고 확정 (출하요청 단위). 이미 출고면 COM-001, 배정 대기 INV-001, 소진 INV-004, 미검사·불합격 INV-002, 예약·수주 잔량 초과 SHP-002 */
  confirm: (input: { shipmentRequestId: number; expectedUpdatedAt?: string | null }) =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, CONFIRM_RULE);
      const result = confirmGoodsIssue(tx, userActor(actor.employee.id), input);
      return {
        shipmentRequestNo: result.shipmentRequest.shipmentRequestNo,
        issuedLotNos: result.issuedLotNos,
        millSheets: result.millSheets.map((m) => ({ id: m.id, millSheetNo: m.millSheetNo })),
      };
    }),
};
