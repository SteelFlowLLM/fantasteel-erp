// 기준정보 조회 (REQ-MST-001~009). 다른 화면의 선택 목록(수주 등록·수주 목록·구매요청 등록·재고 강종 필터)이 쓴다.
// NEXT_PUBLIC_DATA_SOURCE=server면 서버 기준정보를 읽어 id가 서버 id다 (api/server/lookups.ts). 등록·수정은 기준정보 화면(api/masterData.ts)이 맡는다.
import type { ItemType, ProcessType, ProductItemType, RawMaterialType, UnitType, YardType } from '@/codes';
import { mockQuery } from '@/api/client';
import { isServerDataSource } from '@/api/http';
import type { ItemListQuery, ProductSpecListQuery } from '@/api/queryKeys';
import { serverLookupApi } from '@/api/server/lookups';
import { specificConsumptionUnitOf, type SpecificConsumptionUnit } from '@/lib/units';
import { calcHotRollingYieldRate } from '@/lib/weight';
import type { ItemRow, MockTables } from '@/mock/schema';

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

/** 제품 규격 행: 유형별 필수 컬럼이 모두 있는 슬래브·코일 (ERD item의 CHECK 제약) */
type ProductItemRow = ItemRow & {
  itemType: ProductItemType;
  steelGradeId: number;
  thicknessMm: string;
  widthMm: string;
  lengthMm: string;
  theoreticalWeightTon: string;
};

const isProductItem = (item: ItemRow): item is ProductItemRow =>
  item.itemType !== 'RAW_MATERIAL' &&
  item.steelGradeId !== null &&
  item.thicknessMm !== null &&
  item.widthMm !== null &&
  item.lengthMm !== null &&
  item.theoreticalWeightTon !== null;

function toItemView(tables: Readonly<MockTables>, item: ItemRow): ItemView {
  return {
    id: item.id,
    itemCode: item.itemCode,
    itemName: item.itemName,
    itemType: item.itemType,
    unitType: item.unitType,
    rawMaterialType: item.rawMaterialType,
    steelGradeId: item.steelGradeId,
    steelGradeCode: tables.steelGrade.find((g) => g.id === item.steelGradeId)?.steelGradeCode ?? null,
    thicknessMm: item.thicknessMm,
    widthMm: item.widthMm,
    lengthMm: item.lengthMm,
    theoreticalWeightTon: item.theoreticalWeightTon,
    defaultYardId: item.defaultYardId,
    defaultYardName: tables.yard.find((y) => y.id === item.defaultYardId)?.yardName ?? '-',
    defaultSupplierId: item.defaultSupplierId,
    defaultSupplierName: tables.supplier.find((s) => s.id === item.defaultSupplierId)?.supplierName ?? null,
  };
}

function toProductSpecView(tables: Readonly<MockTables>, item: ProductItemRow): ProductSpecView {
  const mapping = tables.specMapping.find((m) => (item.itemType === 'SLAB' ? m.slabItemId : m.coilItemId) === item.id);
  const mappedId = mapping ? (item.itemType === 'SLAB' ? mapping.coilItemId : mapping.slabItemId) : null;
  const mapped = tables.item.find((i) => i.id === mappedId);
  const slab = item.itemType === 'SLAB' ? item : mapped;
  const coil = item.itemType === 'COIL' ? item : mapped;
  const view = toItemView(tables, item);
  return {
    id: item.id,
    itemCode: item.itemCode,
    itemName: item.itemName,
    itemType: item.itemType,
    steelGradeId: item.steelGradeId,
    steelGradeCode: view.steelGradeCode ?? '-',
    thicknessMm: item.thicknessMm,
    widthMm: item.widthMm,
    lengthMm: item.lengthMm,
    theoreticalWeightTon: item.theoreticalWeightTon,
    defaultYardId: item.defaultYardId,
    defaultYardName: view.defaultYardName,
    mappedItemId: mapped?.id ?? null,
    mappedItemCode: mapped?.itemCode ?? null,
    hotRollingPlannedYieldRate:
      slab?.theoreticalWeightTon && coil?.theoreticalWeightTon ? calcHotRollingYieldRate(coil.theoreticalWeightTon, slab.theoreticalWeightTon) : null,
  };
}

const byCode = <T>(key: (row: T) => string) => (a: T, b: T) => key(a).localeCompare(key(b));

export const lookupApi = {
  listCustomers: (): Promise<CustomerView[]> =>
    isServerDataSource()
      ? serverLookupApi.listCustomers()
      : mockQuery((tables) =>
      tables.customer.map(({ id, customerCode, customerName }) => ({ id, customerCode, customerName })).sort(byCode((c) => c.customerCode)),
    ),

  listSuppliers: (): Promise<SupplierView[]> =>
    isServerDataSource()
      ? serverLookupApi.listSuppliers()
      : mockQuery((tables) =>
      tables.supplier.map(({ id, supplierCode, supplierName }) => ({ id, supplierCode, supplierName })).sort(byCode((s) => s.supplierCode)),
    ),

  listYards: (): Promise<YardView[]> =>
    isServerDataSource()
      ? serverLookupApi.listYards()
      : mockQuery((tables) => tables.yard.map(({ id, yardCode, yardName, yardType }) => ({ id, yardCode, yardName, yardType })).sort(byCode((y) => y.yardCode))),

  listSteelGrades: (): Promise<SteelGradeView[]> =>
    isServerDataSource()
      ? serverLookupApi.listSteelGrades()
      : mockQuery((tables) => tables.steelGrade.map(({ id, steelGradeCode, steelGradeName, standardNo }) => ({ id, steelGradeCode, steelGradeName, standardNo }))),

  listItems: (query: ItemListQuery = {}): Promise<ItemView[]> =>
    isServerDataSource()
      ? serverLookupApi.listItems(query)
      : mockQuery((tables) => tables.item.filter((i) => !query.itemType || i.itemType === query.itemType).map((i) => toItemView(tables, i))),

  listProductSpecs: (query: ProductSpecListQuery = {}): Promise<ProductSpecView[]> =>
    isServerDataSource()
      ? serverLookupApi.listProductSpecs(query)
      : mockQuery((tables) =>
      tables.item
        .filter(isProductItem)
        .filter((i) => !query.itemType || i.itemType === query.itemType)
        .filter((i) => query.steelGradeId === undefined || i.steelGradeId === query.steelGradeId)
        .map((i) => toProductSpecView(tables, i)),
    ),

  listSpecMappings: (): Promise<SpecMappingView[]> =>
    isServerDataSource()
      ? serverLookupApi.listSpecMappings()
      : mockQuery((tables) =>
      tables.specMapping.flatMap((m) => {
        const slab = tables.item.find((i) => i.id === m.slabItemId);
        const coil = tables.item.find((i) => i.id === m.coilItemId);
        if (!slab?.theoreticalWeightTon || !coil?.theoreticalWeightTon) return [];
        return [
          {
            id: m.id,
            steelGradeCode: tables.steelGrade.find((g) => g.id === slab.steelGradeId)?.steelGradeCode ?? '-',
            slabItemId: slab.id,
            slabItemCode: slab.itemCode,
            slabTheoreticalWeightTon: slab.theoreticalWeightTon,
            coilItemId: coil.id,
            coilItemCode: coil.itemCode,
            coilTheoreticalWeightTon: coil.theoreticalWeightTon,
            hotRollingPlannedYieldRate: calcHotRollingYieldRate(coil.theoreticalWeightTon, slab.theoreticalWeightTon),
          },
        ];
      }),
    ),

  listRoutings: (): Promise<RoutingView[]> =>
    isServerDataSource()
      ? serverLookupApi.listRoutings()
      : mockQuery((tables) =>
      [...tables.routing]
        .sort((a, b) => a.itemType.localeCompare(b.itemType) || a.processSeq - b.processSeq)
        .map(({ id, itemType, processType, processSeq, plannedYieldRate }) => ({ id, itemType, processType, processSeq, plannedYieldRate })),
    ),

  listSpecificConsumptions: (): Promise<SpecificConsumptionView[]> =>
    isServerDataSource()
      ? serverLookupApi.listSpecificConsumptions()
      : mockQuery((tables) =>
      tables.specificConsumption.flatMap((c) => {
        const item = tables.item.find((i) => i.id === c.itemId);
        if (!item?.rawMaterialType) return [];
        return [
          {
            id: c.id,
            itemId: item.id,
            itemCode: item.itemCode,
            itemName: item.itemName,
            rawMaterialType: item.rawMaterialType,
            steelGradeId: c.steelGradeId,
            steelGradeCode: tables.steelGrade.find((g) => g.id === c.steelGradeId)?.steelGradeCode ?? null,
            consumptionRate: c.consumptionRate,
            consumptionUnit: specificConsumptionUnitOf(item.rawMaterialType),
          },
        ];
      }),
    ),

  getProductionSetting: (): Promise<ProductionSettingView | null> =>
    isServerDataSource()
      ? serverLookupApi.getProductionSetting()
      : mockQuery((tables) => {
      const setting = tables.productionSetting[0];
      return setting
        ? { id: setting.id, heatCapacityTon: setting.heatCapacityTon, deliveryRiskDays: setting.deliveryRiskDays, updatedAt: setting.updatedAt }
        : null;
    }),
};
