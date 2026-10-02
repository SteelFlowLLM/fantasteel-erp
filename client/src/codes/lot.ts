// LOT 공통 코드. 값·표시명은 공통 코드 정의서 그대로 (PLAN 4장).
// LOT 관계의 종류(원료→용선 등)는 코드로 두지 않고 부모·자식 lot_type으로 판단한다.

export const LOT_TYPE = {
  RAW_MATERIAL: 'RAW_MATERIAL',
  HOT_METAL: 'HOT_METAL',
  HEAT: 'HEAT',
  SLAB: 'SLAB',
  COIL: 'COIL',
} as const;
export type LotType = (typeof LOT_TYPE)[keyof typeof LOT_TYPE];
export const LOT_TYPE_LABEL: Record<LotType, string> = {
  RAW_MATERIAL: '원료',
  HOT_METAL: '용선',
  HEAT: '히트',
  SLAB: '슬래브',
  COIL: '코일',
};

/** 품질은 INSPECTION_RESULT, 배정 여부는 allocation으로 따로 본다 */
export const LOT_STATUS = {
  AVAILABLE: 'AVAILABLE',
  CONSUMED: 'CONSUMED',
  SHIPPED: 'SHIPPED',
} as const;
export type LotStatus = (typeof LOT_STATUS)[keyof typeof LOT_STATUS];
export const LOT_STATUS_LABEL: Record<LotStatus, string> = {
  AVAILABLE: '재고',
  CONSUMED: '투입 소진',
  SHIPPED: '출고',
};

export const LOT_RELATION_EVIDENCE = {
  PERIOD_BASED: 'PERIOD_BASED',
  ACTUAL_INPUT: 'ACTUAL_INPUT',
} as const;
export type LotRelationEvidence = (typeof LOT_RELATION_EVIDENCE)[keyof typeof LOT_RELATION_EVIDENCE];
export const LOT_RELATION_EVIDENCE_LABEL: Record<LotRelationEvidence, string> = {
  PERIOD_BASED: '기간 기반',
  ACTUAL_INPUT: '실제 투입',
};
