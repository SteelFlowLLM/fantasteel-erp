import type { Prisma } from '../../generated/prisma/client';
import type { InspectionResult, LotEvidenceType, LotRelationType, LotStatus, LotType } from '@fantasteel/shared';

/** 검사 결과 요약 (해당 LOT의 가장 최근 검사 1건). */
export interface LotInspectionSummary {
  qualityInspectionId: number;
  qualityInspectionNo: string;
  processCode: string;
  result: InspectionResult;
  resultLabel: string;
  inspectedAt: Date | null;
  itemCount: number;
  failedItemCount: number;
}

/** 화면에 보이는 현재 배정 (CONFIRMED). */
export interface LotAllocationView {
  allocationId: number;
  purpose: string;
  purposeLabel: string;
  status: string;
  confirmedAt: Date;
  salesOrderItemId: number | null;
  salesOrderNo: string | null;
  lineNo: number | null;
  productionPlanId: number | null;
  productionPlanNo: string | null;
  shipmentRequestId: number | null;
  shipmentRequestNo: string | null;
}

export interface LotSalesOrderItemView {
  salesOrderItemId: number;
  salesOrderId: number;
  salesOrderNo: string;
  lineNo: number;
  customerId: number;
  customerName: string;
  dueDate: Date;
}

export interface LotView {
  id: number;
  lotNo: string;
  lotType: LotType;
  lotTypeLabel: string;
  lotStatus: LotStatus;
  lotStatusLabel: string;
  /** 화면 한 줄 표시용 */
  title: string;
  rawMaterial: { id: number; materialCode: string; materialName: string; rawMaterialType: string; rawMaterialTypeLabel: string } | null;
  productSpec: {
    id: number;
    specCode: string;
    thicknessMm: string;
    widthMm: string;
    lengthMm: string;
    theoreticalWeightTon: string;
  } | null;
  steelGrade: { id: number; steelGradeCode: string; steelGradeName: string } | null;
  heat: { id: number; lotNo: string; isPassed: boolean | null } | null;
  yard: { id: number; yardCode: string; yardName: string } | null;
  supplier: { id: number; supplierName: string } | null;
  blastFurnaceNo: string | null;
  converterNo: string | null;
  /** 슬래브·코일 1개 = 규격 이론중량 (계산값). 그 밖은 null */
  weightTon: string | null;
  initialTon: Prisma.Decimal | null;
  remainingTon: Prisma.Decimal | null;
  isPassed: boolean | null;
  /** 검사 대상(히트·슬래브·코일)만 값이 있다. 원료·용선은 null */
  inspectionResult: InspectionResult | null;
  inspectionResultLabel: string | null;
  inspection: LotInspectionSummary | null;
  disposition: { status: string; statusLabel: string; reason: string | null; at: Date | null } | null;
  allocation: LotAllocationView | null;
  salesOrderItem: LotSalesOrderItemView | null;
  /** 슬래브·코일만: 자기 검사 합격 + 상위 히트 합격 + 재고 (예약·배정 후보) */
  isEligible: boolean | null;
  /** 슬래브만: 적격 + 수주 미귀속 + CONFIRMED 배정 없음 */
  isSurplus: boolean | null;
  producedAt: Date;
  consumedAt: Date | null;
}

// ───────────── 추적 (BP-LOT-01) ─────────────

export type SalesOrderLinkType = 'PRODUCED_FOR' | 'ALLOCATED' | 'SHIPPED';

export interface LotSalesOrderLink extends LotSalesOrderItemView {
  /** PRODUCED_FOR: 이 LOT을 생산한 원래 수주 품목 / ALLOCATED: 배정된 수주 품목 / SHIPPED: 실제 출고된 수주 품목 */
  linkType: SalesOrderLinkType;
}

export interface LotShipmentInfo {
  goodsIssueId: number;
  goodsIssueNo: string;
  issuedAt: Date | null;
  shipmentRequestId: number;
  shipmentRequestNo: string;
  customerId: number;
  customerCode: string;
  customerName: string;
  salesOrderId: number;
  salesOrderNo: string;
  salesOrderItemId: number;
  lineNo: number;
  millSheetIds: number[];
  millSheetNos: string[];
}

export interface LotTraceNode {
  id: number;
  lotNo: string;
  lotType: LotType;
  lotTypeLabel: string;
  lotStatus: LotStatus;
  lotStatusLabel: string;
  isRoot: boolean;
  /** 시작 LOT에서 몇 단계 떨어져 있는지 */
  depth: number;
  title: string;
  steelGradeCode: string | null;
  productSpecCode: string | null;
  rawMaterialCode: string | null;
  rawMaterialName: string | null;
  /** IRON_ORE | COAL | LIMESTONE | FERROALLOY (원료 LOT만) */
  rawMaterialType: string | null;
  blastFurnaceNo: string | null;
  converterNo: string | null;
  heatLotNo: string | null;
  initialTon: Prisma.Decimal | null;
  remainingTon: Prisma.Decimal | null;
  weightTon: string | null;
  producedAt: Date;
  isPassed: boolean | null;
  inspectionResult: InspectionResult | null;
  inspectionResultLabel: string | null;
  inspection: LotInspectionSummary | null;
  /** 이 LOT이 닿은 수주 품목 (생산 목적·배정·출고) */
  salesOrderLinks: LotSalesOrderLink[];
  /** 출고된 LOT의 출고·밀시트·고객사 */
  shipment: LotShipmentInfo | null;
}

export interface LotTraceEdge {
  id: number;
  parentId: number;
  childId: number;
  relationType: LotRelationType;
  evidenceType: LotEvidenceType;
  evidenceLabel: string;
  /** PERIOD(기간 기반)면 true — 정확한 실투입량이 아니다 */
  isPeriodBased: boolean;
  inputTon: Prisma.Decimal | null;
  periodStart: Date | null;
  periodEnd: Date | null;
}

export interface LotTraceLevel {
  lotType: LotType;
  label: string;
  nodeIds: number[];
}

export interface LotTraceImpact {
  /** 영향받은 슬래브·코일 중 출고까지 간 것과 아직 재고인 것 */
  shippedProductLotCount: number;
  unshippedProductLotCount: number;
  shipments: {
    goodsIssueId: number;
    goodsIssueNo: string;
    issuedAt: Date | null;
    shipmentRequestNo: string;
    customerId: number;
    customerName: string;
    salesOrderId: number;
    salesOrderNo: string;
    millSheetNos: string[];
    lotIds: number[];
    lotNos: string[];
  }[];
  salesOrders: { salesOrderId: number; salesOrderNo: string; customerName: string; dueDate: Date; lotCount: number; hasShipped: boolean }[];
}

export interface LotTraceResponse {
  direction: 'backward' | 'forward';
  rootId: number;
  nodes: LotTraceNode[];
  edges: LotTraceEdge[];
  /** 공정 순서(원료 → 용선 → 히트 → 슬래브 → 코일)로 묶은 열. 존재하는 유형만 */
  levels: LotTraceLevel[];
  summary: {
    nodeCount: number;
    edgeCount: number;
    countByType: Record<string, number>;
    hasPeriodEvidence: boolean;
    hasCycle: boolean;
    truncated: boolean;
  };
  /** 정추적에서만 */
  impact: LotTraceImpact | null;
}
