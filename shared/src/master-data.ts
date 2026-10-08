// 기준정보 조회 응답 타입 (REQ-MST-001~009, docs/backend/master-data.md). 톤·치수·수율은 문자열.
import type { ItemType, ProcessType, RawMaterialType, UnitType, YardType } from './codes';

export interface CustomerView {
  id: number;
  customerCode: string;
  customerName: string;
}

export interface ItemView {
  id: number;
  itemCode: string;
  itemName: string;
  itemType: ItemType;
  unitType: UnitType;
  /** 원료만 */
  rawMaterialType: RawMaterialType | null;
  /** 제품만 */
  steelGradeId: number | null;
  steelGradeCode: string | null;
  thicknessMm: string | null;
  widthMm: string | null;
  lengthMm: string | null;
  /** 1매 이론중량(t, 소수 3자리). 제품만 */
  theoreticalWeightTon: string | null;
  defaultYardId: number;
  /** 원료만. 품목별 기본 공급업체 1곳 */
  defaultSupplierId: number | null;
}

/** API-168. 성분 min/max는 제강 검사 기준(inspection-standards)에서 관리한다 */
export interface SteelGradeView {
  id: number;
  steelGradeCode: string;
  steelGradeName: string;
  /** KS 규격 번호. 밀시트 표시 */
  standardNo: string;
}

export interface SpecMappingItemView {
  id: number;
  itemCode: string;
  thicknessMm: string;
  widthMm: string;
  lengthMm: string;
  theoreticalWeightTon: string;
}

/** API-170. 열연 계획 수율 = 코일 1개 이론중량 ÷ 슬래브 1매 이론중량 (저장하지 않는 계산값, 소수 4자리) */
export interface SpecMappingView {
  id: number;
  steelGradeId: number;
  steelGradeCode: string;
  slabItem: SpecMappingItemView;
  coilItem: SpecMappingItemView;
  hotRollingYieldRate: string;
}

/** API-172. 열연은 계획 수율 null (규격 매핑에서 계산) */
export interface RoutingView {
  id: number;
  itemType: ItemType;
  processType: ProcessType;
  sequenceNo: number;
  plannedYieldRate: string | null;
}

/** API-175. 강종 null = 용선 1t당 t(공통), 강종 있음 = 용강 1t당 합금철 kg */
export interface SpecificConsumptionView {
  id: number;
  rawMaterialItemId: number;
  rawMaterialItemCode: string;
  rawMaterialType: RawMaterialType;
  steelGradeId: number | null;
  steelGradeCode: string | null;
  consumptionRate: string;
}

export interface SupplierView {
  id: number;
  supplierCode: string;
  supplierName: string;
}

export interface YardView {
  id: number;
  yardCode: string;
  yardName: string;
  yardType: YardType;
}

/** API-187. 1행만 둔다 */
export interface ProductionSettingView {
  id: number;
  heatCapacityTon: string;
  deliveryRiskDays: number;
}
