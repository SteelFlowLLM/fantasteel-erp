// lot 모듈 응답 타입 (docs/backend/lot.md, REQ-LOT-001·005, GET /lots · /lots/:id · /lots/:id/trace).
// 날짜는 'YYYY-MM-DD', 시각은 ISO 8601, 톤은 소수 3자리 문자열.
import type {
  AllocationPurpose,
  AllocationStatus,
  DispositionStatus,
  InspectionResult,
  LotRelationEvidence,
  LotStatus,
  LotType,
  ProcessType,
  RawMaterialType,
  ShipmentRequestStatus,
} from './codes';

/** 추적 방향: backward = 어디서 왔나(코일 → 원료), forward = 어디로 갔나(원료·히트 → 슬래브·코일·출하) */
export const TRACE_DIRECTION = {
  BACKWARD: 'backward',
  FORWARD: 'forward',
} as const;
export type TraceDirection = (typeof TRACE_DIRECTION)[keyof typeof TRACE_DIRECTION];

/** 코일·슬래브는 어디서 왔는지(역추적), 원료·용선·히트는 어디로 갔는지(정추적)부터 본다 */
export const defaultTraceDirection = (lotType: LotType): TraceDirection =>
  lotType === 'SLAB' || lotType === 'COIL' ? TRACE_DIRECTION.BACKWARD : TRACE_DIRECTION.FORWARD;

/** LOT 목록 한 줄 */
export interface LotSummary {
  id: number;
  lotNo: string;
  lotType: LotType;
  lotStatus: LotStatus;
  itemId: number | null;
  itemCode: string | null;
  itemName: string | null;
  /** 히트는 LOT의 강종, 슬래브·코일은 규격의 강종 */
  steelGradeCode: string | null;
  yardName: string | null;
  /** 슬래브·코일 생산완료일 */
  producedDate: string | null;
  initialTon: string | null;
  remainingTon: string | null;
  /** 자기 검사 판정. 검사가 없으면 null (원료·용선은 검사하지 않는다) */
  inspectionResult: InspectionResult | null;
}

/** 연결된 부모(투입)·자식(산출) LOT */
export interface LotRelationView {
  relationId: number;
  lotId: number;
  lotNo: string;
  lotType: LotType;
  lotRelationEvidence: LotRelationEvidence;
  inputTon: string | null;
  /** PERIOD_BASED만: "정확한 실투입량"이 아니라 이 기간의 FIFO 차감이라는 뜻 */
  periodStartedAt: string | null;
  periodEndedAt: string | null;
}

export interface LotInspectionDetail {
  inspectionResult: InspectionResult;
  inspectedAt: string;
  inspectorName: string;
  processType: ProcessType;
  inspectionStandardCode: string;
  standardVersion: number;
  values: {
    inspectionItemCode: string;
    inspectionItemName: string;
    unit: string | null;
    minValue: string | null;
    maxValue: string | null;
    measuredValue: string;
    /** 기준(이상·이하, 경계 포함) 안이면 true. 기준이 없으면 null */
    isPassed: boolean | null;
  }[];
}

export interface LotAllocationInfo {
  id: number;
  allocationPurpose: AllocationPurpose;
  allocationStatus: AllocationStatus;
  shipmentRequest: { id: number; shipmentRequestNo: string } | null;
  productionPlan: { id: number; productionPlanNo: string } | null;
}

export interface MillSheetRef {
  id: number;
  millSheetNo: string;
  salesOrderId: number;
}

/** 이 LOT이 배정(CONFIRMED)·출고(CONSUMED)된 출하요청 */
export interface LotShipmentInfo {
  shipmentRequestId: number;
  shipmentRequestNo: string;
  shipmentRequestStatus: ShipmentRequestStatus;
  allocationStatus: AllocationStatus;
  issuedAt: string | null;
  customerName: string;
  salesOrder: { salesOrderId: number; salesOrderNo: string } | null;
  millSheets: MillSheetRef[];
}

export interface LotDetail extends LotSummary {
  steelGradeName: string | null;
  rawMaterialType: RawMaterialType | null;
  goodsReceiptNo: string | null;
  blastFurnaceCode: string | null;
  converterCode: string | null;
  /** 슬래브·코일의 상위 히트 */
  heat: { id: number; lotNo: string } | null;
  /** 슬래브·코일만: 자기 검사 PASS + 상위 히트 PASS(계산값). 그 밖의 LOT은 null */
  isEligible: boolean | null;
  disposition: { dispositionStatus: DispositionStatus; dispositionReason: string | null } | null;
  inspection: LotInspectionDetail | null;
  /** 해제되지 않은 배정 */
  allocations: LotAllocationInfo[];
  /** 투입한 LOT (역방향 한 단계) */
  parents: LotRelationView[];
  /** 산출한 LOT (정방향 한 단계) */
  children: LotRelationView[];
  shipments: LotShipmentInfo[];
}

// ── 정·역추적 ─────────────────────────────────────────────

export interface TraceLotNode extends LotSummary {
  /** 시작 LOT과의 거리 (시작 = 0) */
  depth: number;
  isStart: boolean;
  rawMaterialType: RawMaterialType | null;
  blastFurnaceCode: string | null;
  converterCode: string | null;
}

export interface TraceRelationEdge {
  id: number;
  parentLotId: number;
  childLotId: number;
  lotRelationEvidence: LotRelationEvidence;
  inputTon: string | null;
  periodStartedAt: string | null;
  periodEndedAt: string | null;
}

export interface TraceShipment extends LotShipmentInfo {
  /** 이 출하요청에 배정된(또는 출고된) LOT 가운데 추적 결과에 있는 것 */
  lotIds: number[];
}

export interface TraceImpactSalesOrder {
  salesOrderId: number;
  salesOrderNo: string;
  customerName: string;
  /** 영향 LOT 가운데 이 수주로 출고된 것이 있는지 */
  hasShipped: boolean;
  lotCount: number;
  /** 연결된 수주 품목 가운데 가장 이른 납기 */
  dueDate: string | null;
}

/** 정추적 영향 범위 (불합격 영향 확인용) */
export interface TraceImpact {
  slabCount: number;
  coilCount: number;
  /** 출고(SHIPPED)된 슬래브·코일 */
  shippedLotCount: number;
  /** 아직 재고(AVAILABLE)인 슬래브·코일 */
  unshippedLotCount: number;
  /** 다음 공정에 투입돼 소진(CONSUMED)된 슬래브 */
  consumedLotCount: number;
  salesOrders: TraceImpactSalesOrder[];
}

export interface LotTrace {
  start: LotSummary;
  direction: TraceDirection;
  /** 시작 LOT부터 가까운 순서 (같은 거리 안에서는 id 순) */
  nodes: TraceLotNode[];
  edges: TraceRelationEdge[];
  /** 정추적일 때만. 역추적은 빈 배열 */
  shipments: TraceShipment[];
  /** 정추적일 때만 */
  impact: TraceImpact | null;
}
