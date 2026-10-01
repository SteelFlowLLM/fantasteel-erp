// 기준정보 공통 코드. 값·표시명은 공통 코드 정의서 그대로 (PLAN 4장).
// 지금은 client에 둔다. shared/는 서버가 쓰고 있어서 백엔드 작업 때 옮긴다 (SPEC 5장).

export const UNIT_TYPE = {
  QTY: 'QTY',
  TON: 'TON',
} as const;
export type UnitType = (typeof UNIT_TYPE)[keyof typeof UNIT_TYPE];
export const UNIT_TYPE_LABEL: Record<UnitType, string> = {
  QTY: '매수',
  TON: '톤',
};

/** 강종은 기준정보 테이블(steel_grade)로 관리한다. 이 값은 초기 시드 값이다. */
export const STEEL_GRADE = {
  SS275: 'SS275',
  SM355A: 'SM355A',
  SM355B: 'SM355B',
  SM355C: 'SM355C',
  SM355D: 'SM355D',
  SPHC: 'SPHC',
} as const;
export type SteelGradeCode = (typeof STEEL_GRADE)[keyof typeof STEEL_GRADE];
export const STEEL_GRADE_LABEL: Record<SteelGradeCode, string> = {
  SS275: 'SS275',
  SM355A: 'SM355A',
  SM355B: 'SM355B',
  SM355C: 'SM355C',
  SM355D: 'SM355D',
  SPHC: 'SPHC',
};

export const ITEM_TYPE = {
  RAW_MATERIAL: 'RAW_MATERIAL',
  SLAB: 'SLAB',
  COIL: 'COIL',
} as const;
export type ItemType = (typeof ITEM_TYPE)[keyof typeof ITEM_TYPE];
export const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  RAW_MATERIAL: '원료',
  SLAB: '슬래브',
  COIL: '코일',
};
/** 품목 유형별 단위 유형 (공통 코드 정의서 ITEM_TYPE 표의 '단위 유형' 열) */
export const ITEM_TYPE_UNIT_TYPE: Record<ItemType, UnitType> = {
  RAW_MATERIAL: 'TON',
  SLAB: 'QTY',
  COIL: 'QTY',
};

export type ProductItemType = Exclude<ItemType, 'RAW_MATERIAL'>;
/** 제품 매수의 화면 단위: 슬래브 매, 코일 개 (공통 코드 정의서 UNIT_TYPE QTY의 의미) */
export const PRODUCT_QTY_UNIT: Record<ProductItemType, string> = {
  SLAB: '매',
  COIL: '개',
};

export const RAW_MATERIAL_TYPE = {
  IRON_ORE: 'IRON_ORE',
  COAL: 'COAL',
  LIMESTONE: 'LIMESTONE',
  FERROALLOY: 'FERROALLOY',
} as const;
export type RawMaterialType = (typeof RAW_MATERIAL_TYPE)[keyof typeof RAW_MATERIAL_TYPE];
export const RAW_MATERIAL_TYPE_LABEL: Record<RawMaterialType, string> = {
  IRON_ORE: '철광석',
  COAL: '석탄',
  LIMESTONE: '석회석',
  FERROALLOY: '합금철',
};

export const PROCESS_TYPE = {
  IRONMAKING: 'IRONMAKING',
  STEELMAKING: 'STEELMAKING',
  CONTINUOUS_CASTING: 'CONTINUOUS_CASTING',
  HOT_ROLLING: 'HOT_ROLLING',
} as const;
export type ProcessType = (typeof PROCESS_TYPE)[keyof typeof PROCESS_TYPE];
export const PROCESS_TYPE_LABEL: Record<ProcessType, string> = {
  IRONMAKING: '제선',
  STEELMAKING: '제강',
  CONTINUOUS_CASTING: '연주',
  HOT_ROLLING: '열연',
};

export const YARD_TYPE = {
  RAW_MATERIAL: 'RAW_MATERIAL',
  SLAB: 'SLAB',
  COIL: 'COIL',
} as const;
export type YardType = (typeof YARD_TYPE)[keyof typeof YARD_TYPE];
export const YARD_TYPE_LABEL: Record<YardType, string> = {
  RAW_MATERIAL: '원료 야드',
  SLAB: '슬래브 야드',
  COIL: '코일 야드',
};
