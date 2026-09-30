/**
 * 밀시트 스냅샷 (REQ-SHP-003). 출고 확정 시점의 값을 복사해 mill_sheet.snapshot(JSON)에 고정 저장한다.
 * 조회·PDF는 이 값만 쓰고 원본 테이블을 다시 읽지 않는다. 숫자(치수·성분·측정값·톤)는 문자열이다.
 */
export interface MillSheetInspectionValue {
  /** 성분이면 원소 기호(C, Si …), 그 밖은 검사 항목 코드 */
  inspectionItemCode: string;
  inspectionItemName: string;
  unit: string | null;
  minValue: string | null;
  maxValue: string | null;
  measuredValue: string | null;
  isPassed: boolean | null;
}

export interface MillSheetInspection {
  qualityInspectionNo: string;
  /** STEELMAKING(히트 성분) | CASTING(슬래브) | HOT_ROLLING(코일) */
  processCode: string;
  inspectionResult: string;
  inspectedAt: string | null;
  values: MillSheetInspectionValue[];
}

export interface MillSheetHeat {
  heatNo: string;
  /** 히트 성분 검사 (화학성분) */
  composition: MillSheetInspection | null;
}

export interface MillSheetLot {
  lotNo: string;
  lotType: 'SLAB' | 'COIL';
  heatNo: string | null;
  producedAt: string;
  /** 이 LOT의 제품 검사 (슬래브: 표면·치수, 코일: 치수·기계적 성질) */
  inspection: MillSheetInspection | null;
  /** 코일이면 압연 전 슬래브와 그 검사 */
  parentSlab: { lotNo: string; inspection: MillSheetInspection | null } | null;
}

export interface MillSheetSnapshot {
  millSheetNo: string;
  issuedAt: string;
  customer: { customerCode: string; customerName: string };
  salesOrder: { salesOrderId: number; salesOrderNo: string; salesOrderItemId: number; lineNo: number };
  shipment: { shipmentRequestNo: string; goodsIssueNo: string; goodsIssuedAt: string };
  productSpec: {
    specCode: string;
    itemType: 'SLAB' | 'COIL';
    steelGradeCode: string;
    steelGradeName: string;
    standardNo: string | null;
    thicknessMm: string;
    widthMm: string;
    lengthMm: string;
    theoreticalWeightTon: string;
  };
  /** 출고 매수와 단위(매·개), 톤 = 매수 × 1매 이론중량 */
  qty: number;
  qtyUnit: string;
  weightTon: string;
  heats: MillSheetHeat[];
  lots: MillSheetLot[];
}
