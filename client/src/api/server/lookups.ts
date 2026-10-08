// 선택 목록(api/lookups.ts) ↔ 서버 기준정보 조회 API (server/src/modules/master-data). 화면 id는 서버 id 그대로다.
// 수주 등록(고객사·규격), 수주 목록(고객사), 구매요청 등록(원료), 재고(강종 필터)가 쓴다. 서버에서 새로 등록한 고객사·규격도 고를 수 있다.
// 기준정보 조회 권한(MASTER_MANAGE VIEW)이 없는 역할(물류)은 빈 목록이다. 숫자를 만들어 채우지 않는다.
import type {
  CustomerView as ServerCustomerView,
  ItemView as ServerItemView,
  ProductionSettingView as ServerProductionSettingView,
  RoutingView as ServerRoutingView,
  SpecificConsumptionView as ServerSpecificConsumptionView,
  SpecMappingView as ServerSpecMappingView,
  SteelGradeView as ServerSteelGradeView,
  SupplierView as ServerSupplierView,
  YardView as ServerYardView,
} from '@fantasteel/shared';
import { ApiError } from '@/api/errors';
import { serverRequest } from '@/api/http';
import type {
  CustomerView,
  ItemView,
  ProductionSettingView,
  ProductSpecView,
  RoutingView,
  SpecificConsumptionView,
  SpecMappingView,
  SteelGradeView,
  SupplierView,
  YardView,
} from '@/api/lookups';
import type { ItemListQuery, ProductSpecListQuery } from '@/api/queryKeys';
import type { ProductItemType } from '@/codes';
import { specificConsumptionUnitOf } from '@/lib/units';

/** 기준정보 조회 권한이 없으면(COM-002) empty */
async function orEmpty<T>(read: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ApiError && error.code === 'COM-002') return empty;
    throw error;
  }
}

const getItems = (itemType?: string) => serverRequest<ServerItemView[]>('GET', '/items', { query: { itemType } });
const getYards = () => serverRequest<ServerYardView[]>('GET', '/yards');
const getSuppliers = () => serverRequest<ServerSupplierView[]>('GET', '/suppliers');
const getSpecMappings = () => serverRequest<ServerSpecMappingView[]>('GET', '/spec-mappings');

const byCode = <T>(key: (row: T) => string) => (a: T, b: T) => key(a).localeCompare(key(b));
const isProductItem = (item: ServerItemView): item is ServerItemView & { itemType: ProductItemType } => item.itemType === 'SLAB' || item.itemType === 'COIL';

async function listCustomers(): Promise<CustomerView[]> {
  return orEmpty(async () => (await serverRequest<ServerCustomerView[]>('GET', '/customers')).map(({ id, customerCode, customerName }) => ({ id, customerCode, customerName })).sort(byCode((c) => c.customerCode)), []);
}

async function listSuppliers(): Promise<SupplierView[]> {
  return orEmpty(async () => (await getSuppliers()).map(({ id, supplierCode, supplierName }) => ({ id, supplierCode, supplierName })).sort(byCode((s) => s.supplierCode)), []);
}

async function listYards(): Promise<YardView[]> {
  return orEmpty(async () => (await getYards()).map(({ id, yardCode, yardName, yardType }) => ({ id, yardCode, yardName, yardType })).sort(byCode((y) => y.yardCode)), []);
}

async function listSteelGrades(): Promise<SteelGradeView[]> {
  return orEmpty(
    async () => (await serverRequest<ServerSteelGradeView[]>('GET', '/steel-grades')).map(({ id, steelGradeCode, steelGradeName, standardNo }) => ({ id, steelGradeCode, steelGradeName, standardNo })),
    [],
  );
}

async function listItems(query: ItemListQuery = {}): Promise<ItemView[]> {
  return orEmpty(async () => {
    const [items, yards, suppliers] = await Promise.all([getItems(query.itemType), getYards(), getSuppliers()]);
    return items
      .filter((i) => !query.itemType || i.itemType === query.itemType)
      .map((i) => ({
        id: i.id,
        itemCode: i.itemCode,
        itemName: i.itemName,
        itemType: i.itemType,
        unitType: i.unitType,
        rawMaterialType: i.rawMaterialType,
        steelGradeId: i.steelGradeId,
        steelGradeCode: i.steelGradeCode,
        thicknessMm: i.thicknessMm,
        widthMm: i.widthMm,
        lengthMm: i.lengthMm,
        theoreticalWeightTon: i.theoreticalWeightTon,
        defaultYardId: i.defaultYardId,
        defaultYardName: yards.find((y) => y.id === i.defaultYardId)?.yardName ?? '-',
        defaultSupplierId: i.defaultSupplierId,
        defaultSupplierName: suppliers.find((s) => s.id === i.defaultSupplierId)?.supplierName ?? null,
      }));
  }, []);
}

async function listProductSpecs(query: ProductSpecListQuery = {}): Promise<ProductSpecView[]> {
  return orEmpty(async () => {
    const [items, mappings, yards] = await Promise.all([getItems(query.itemType), getSpecMappings(), getYards()]);
    return items
      .filter(isProductItem)
      .filter((i) => !query.itemType || i.itemType === query.itemType)
      .filter((i) => query.steelGradeId === undefined || i.steelGradeId === query.steelGradeId)
      .map((item): ProductSpecView => {
        const mapping = mappings.find((m) => (item.itemType === 'SLAB' ? m.slabItem.id : m.coilItem.id) === item.id);
        const mapped = mapping ? (item.itemType === 'SLAB' ? mapping.coilItem : mapping.slabItem) : null;
        return {
          id: item.id,
          itemCode: item.itemCode,
          itemName: item.itemName,
          itemType: item.itemType,
          steelGradeId: item.steelGradeId ?? 0,
          steelGradeCode: item.steelGradeCode ?? '-',
          thicknessMm: item.thicknessMm ?? '0',
          widthMm: item.widthMm ?? '0',
          lengthMm: item.lengthMm ?? '0',
          theoreticalWeightTon: item.theoreticalWeightTon ?? '0.000',
          defaultYardId: item.defaultYardId,
          defaultYardName: yards.find((y) => y.id === item.defaultYardId)?.yardName ?? '-',
          mappedItemId: mapped?.id ?? null,
          mappedItemCode: mapped?.itemCode ?? null,
          hotRollingPlannedYieldRate: mapping?.hotRollingYieldRate ?? null,
        };
      });
  }, []);
}

async function listSpecMappings(): Promise<SpecMappingView[]> {
  return orEmpty(
    async () =>
      (await getSpecMappings()).map((m) => ({
        id: m.id,
        steelGradeCode: m.steelGradeCode,
        slabItemId: m.slabItem.id,
        slabItemCode: m.slabItem.itemCode,
        slabTheoreticalWeightTon: m.slabItem.theoreticalWeightTon,
        coilItemId: m.coilItem.id,
        coilItemCode: m.coilItem.itemCode,
        coilTheoreticalWeightTon: m.coilItem.theoreticalWeightTon,
        hotRollingPlannedYieldRate: m.hotRollingYieldRate,
      })),
    [],
  );
}

async function listRoutings(): Promise<RoutingView[]> {
  return orEmpty(
    async () =>
      (await serverRequest<ServerRoutingView[]>('GET', '/routings'))
        .filter((r): r is ServerRoutingView & { itemType: ProductItemType } => r.itemType === 'SLAB' || r.itemType === 'COIL')
        .sort((a, b) => a.itemType.localeCompare(b.itemType) || a.sequenceNo - b.sequenceNo)
        .map((r) => ({ id: r.id, itemType: r.itemType, processType: r.processType, processSeq: r.sequenceNo, plannedYieldRate: r.plannedYieldRate })),
    [],
  );
}

async function listSpecificConsumptions(): Promise<SpecificConsumptionView[]> {
  return orEmpty(async () => {
    const [rows, materials] = await Promise.all([serverRequest<ServerSpecificConsumptionView[]>('GET', '/specific-consumptions'), getItems('RAW_MATERIAL')]);
    return rows.map((c) => ({
      id: c.id,
      itemId: c.rawMaterialItemId,
      itemCode: c.rawMaterialItemCode,
      itemName: materials.find((m) => m.id === c.rawMaterialItemId)?.itemName ?? c.rawMaterialItemCode,
      rawMaterialType: c.rawMaterialType,
      steelGradeId: c.steelGradeId,
      steelGradeCode: c.steelGradeCode,
      consumptionRate: c.consumptionRate,
      consumptionUnit: specificConsumptionUnitOf(c.rawMaterialType),
    }));
  }, []);
}

async function getProductionSetting(): Promise<ProductionSettingView | null> {
  return orEmpty(async () => {
    const row = await serverRequest<ServerProductionSettingView>('GET', '/production-settings');
    // 서버 응답에 수정 시각이 없다
    return { id: row.id, heatCapacityTon: row.heatCapacityTon, deliveryRiskDays: row.deliveryRiskDays, updatedAt: '' };
  }, null);
}

export const serverLookupApi = {
  listCustomers,
  listSuppliers,
  listYards,
  listSteelGrades,
  listItems,
  listProductSpecs,
  listSpecMappings,
  listRoutings,
  listSpecificConsumptions,
  getProductionSetting,
};
