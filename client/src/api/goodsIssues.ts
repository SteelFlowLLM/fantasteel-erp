// 출고 확정 API (REQ-SHP-002·003, REQ-INV-005, REQ-SO-005, BP-SHP-01).
// 별도 출고 테이블·번호가 없다: 출하요청의 issued_at·issued_employee_id와 상태 ISSUED로 남는다.
// 재검증·전환·밀시트 발행·작업 로그는 서버가 한 트랜잭션에서 한다 (api/server/goodsIssues.ts). 출하요청·LOT id는 서버 id다.
import type { ShipmentRequestDetail } from '@/api/shipmentRequests';
import { type ErrorCode, type InspectionResult, type LotStatus, type ShipmentRequestStatus } from '@/codes';
import { serverGoodsIssueApi } from '@/api/server/goodsIssues';
import type { ProductEligibility } from '@/lib/eligibility';

export interface GoodsIssueProblem {
  code: ErrorCode;
  message: string;
  lotNo: string | null;
}

export const goodsIssueKeys = {
  all: ['goodsIssues'] as const,
  queue: () => [...goodsIssueKeys.all, 'queue'] as const,
  detail: (shipmentRequestId: number) => [...goodsIssueKeys.all, 'detail', shipmentRequestId] as const,
};

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
  heatNo: string | null;
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
  theoreticalWeightTon: string;
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

export const goodsIssueApi = {
  /** 출고 확정 화면 왼쪽 목록: 배정 확정 → 배정 대기 → 출고 완료 순 */
  queue: () => serverGoodsIssueApi.queue(),
  /** 출고 확정 화면 본문: 배정 LOT과 품질·재고 재검증 결과 */
  detail: (shipmentRequestId: number) => serverGoodsIssueApi.detail(shipmentRequestId),
  /** 출고 확정 (출하요청 단위). 이미 출고면 COM-001, 배정 대기 INV-001, 소진 INV-004, 미검사·불합격 INV-002, 예약·수주 잔량 초과 SHP-002 */
  confirm: (input: { shipmentRequestId: number; expectedUpdatedAt?: string | null }) => serverGoodsIssueApi.confirm(input),
};
