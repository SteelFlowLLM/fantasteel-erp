// 기준정보 조회 (REQ-MST-001~009). 다른 화면의 선택 목록(수주 등록·수주 목록·구매요청 등록·재고 강종 필터)이 쓴다.
// 서버 기준정보를 읽어 id가 서버 id다 (api/server/lookups.ts). 등록·수정은 기준정보 화면(api/masterData.ts)이 맡는다.
import type { ItemType, ProcessType, ProductItemType, RawMaterialType, UnitType, YardType } from '@/codes';
import type { ItemListQuery, ProductSpecListQuery } from '@/api/queryKeys';
import { serverLookupApi } from '@/api/server/lookups';
import { type SpecificConsumptionUnit } from '@/lib/units';

export interface CustomerView {
  id: number;
  customerCode: string;
  customerName: string;
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

export interface SteelGradeView {
  id: number;
  steelGradeCode: string;
  steelGradeName: string;
  /** 적용 규격 번호 (밀시트에 표시) */
  standardNo: string | null;
}

export interface ItemView {
  id: number;
  itemCode: string;
  itemName: string;
  itemType: ItemType;
  unitType: UnitType;
  rawMaterialType: RawMaterialType | null;
  steelGradeId: number | null;
  steelGradeCode: string | null;
  thicknessMm: string | null;
  widthMm: string | null;
  lengthMm: string | null;
  theoreticalWeightTon: string | null;
  defaultYardId: number;
  defaultYardName: string;
  defaultSupplierId: number | null;
  defaultSupplierName: string | null;
}

/** 제품 규격 (슬래브·코일 item) */
export interface ProductSpecView {
  id: number;
  itemCode: string;
  itemName: string;
  itemType: ProductItemType;
  steelGradeId: number;
  steelGradeCode: string;
  thicknessMm: string;
  widthMm: string;
  lengthMm: string;
  theoreticalWeightTon: string;
  defaultYardId: number;
  defaultYardName: string;
  /** 슬래브면 대응 코일, 코일이면 대응 슬래브 */
  mappedItemId: number | null;
  mappedItemCode: string | null;
  /** 열연 계획 수율 = 코일 이론중량 ÷ 슬래브 이론중량 (계산값, 매핑이 있을 때만) */
  hotRollingPlannedYieldRate: string | null;
}

export interface SpecMappingView {
  id: number;
  steelGradeCode: string;
  slabItemId: number;
  slabItemCode: string;
  slabTheoreticalWeightTon: string;
  coilItemId: number;
  coilItemCode: string;
  coilTheoreticalWeightTon: string;
  hotRollingPlannedYieldRate: string;
}

export interface RoutingView {
  id: number;
  itemType: ProductItemType;
  processType: ProcessType;
  processSeq: number;
  /** 열연은 저장하지 않는다 (규격 매핑에서 계산) */
  plannedYieldRate: string | null;
}

export interface SpecificConsumptionView {
  id: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  rawMaterialType: RawMaterialType;
  steelGradeId: number | null;
  steelGradeCode: string | null;
  consumptionRate: string;
  /** 합금철 kg/t(용강 1t당), 그 밖 t/t(용선 1t당) */
  consumptionUnit: SpecificConsumptionUnit;
}

export interface ProductionSettingView {
  id: number;
  heatCapacityTon: string;
  deliveryRiskDays: number;
  updatedAt: string;
}

export const lookupApi = {
  listCustomers: (): Promise<CustomerView[]> => serverLookupApi.listCustomers(),

  listSuppliers: (): Promise<SupplierView[]> => serverLookupApi.listSuppliers(),

  listYards: (): Promise<YardView[]> => serverLookupApi.listYards(),

  listSteelGrades: (): Promise<SteelGradeView[]> => serverLookupApi.listSteelGrades(),

  listItems: (query: ItemListQuery = {}): Promise<ItemView[]> => serverLookupApi.listItems(query),

  listProductSpecs: (query: ProductSpecListQuery = {}): Promise<ProductSpecView[]> => serverLookupApi.listProductSpecs(query),

  listSpecMappings: (): Promise<SpecMappingView[]> => serverLookupApi.listSpecMappings(),

  listRoutings: (): Promise<RoutingView[]> => serverLookupApi.listRoutings(),

  listSpecificConsumptions: (): Promise<SpecificConsumptionView[]> => serverLookupApi.listSpecificConsumptions(),

  getProductionSetting: (): Promise<ProductionSettingView | null> => serverLookupApi.getProductionSetting(),
};
