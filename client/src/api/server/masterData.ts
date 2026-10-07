// 기준정보 화면 ↔ 서버 API (server/src/modules/master-data, API-165~188). 서버 응답을 화면이 쓰는 모양(가짜 DB와 같은 타입)으로 바꾼다.
// 강종·품목·야드 id는 서버 id를 그대로 쓴다. ERD·API에 없는 값(사용 여부·참조 문구·수정 시각)은 비워 두고 화면이 서버 모드에서 숨긴다.
import type {
  CustomerView,
  InspectionStandardListItem,
  ItemView,
  PageResult,
  ProductionSettingView,
  RoutingView,
  SpecificConsumptionView,
  SpecMappingItemView,
  SpecMappingView,
  SteelGradeView,
  SupplierView,
  YardView,
} from '@fantasteel/shared';
import { ApiError } from '@/api/errors';
import { serverRequest } from '@/api/http';
import type {
  MasterCustomerView,
  MasterProductionSettingView,
  MasterProductSpecView,
  MasterRawMaterialView,
  MasterRoutingView,
  MasterSpecificConsumptionView,
  MasterSpecMappingView,
  MasterSteelGradeView,
  MasterSupplierView,
  MasterYardView,
  SpecBrief,
} from '@/api/masterData';
import type { ProductItemType, RawMaterialType } from '@/codes';
import { specificConsumptionUnitOf } from '@/lib/units';
import { compareDecimal } from '@/lib/weight';

const PAGE_SIZE = 100;
const PRODUCT_ITEM_TYPES: readonly ProductItemType[] = ['SLAB', 'COIL'];

const getItems = () => serverRequest<ItemView[]>('GET', '/items');
const getSpecMappings = () => serverRequest<SpecMappingView[]>('GET', '/spec-mappings');
const getSteelGrades = () => serverRequest<SteelGradeView[]>('GET', '/steel-grades');
const getYards = () => serverRequest<YardView[]>('GET', '/yards');
const getSuppliers = () => serverRequest<SupplierView[]>('GET', '/suppliers');

const isProductItem = (item: ItemView): item is ItemView & { itemType: ProductItemType } => item.itemType === 'SLAB' || item.itemType === 'COIL';
const nameOf = <T extends { id: number }>(rows: readonly T[], id: number | null, name: (row: T) => string): string | null => {
  const row = rows.find((r) => r.id === id);
  return row ? name(row) : null;
};

const specBriefOf = (item: ItemView | SpecMappingItemView): SpecBrief => ({
  id: item.id,
  itemCode: item.itemCode,
  thicknessMm: item.thicknessMm ?? '0',
  widthMm: item.widthMm ?? '0',
  lengthMm: item.lengthMm ?? '0',
  theoreticalWeightTon: item.theoreticalWeightTon ?? '0',
});

async function listProductSpecs(): Promise<MasterProductSpecView[]> {
  const [items, mappings, yards] = await Promise.all([getItems(), getSpecMappings(), getYards()]);
  return items
    .filter(isProductItem)
    .map((item): MasterProductSpecView => {
      const mapping = mappings.find((m) => (item.itemType === 'SLAB' ? m.slabItem.id : m.coilItem.id) === item.id) ?? null;
      const mapped = mapping ? (item.itemType === 'SLAB' ? mapping.coilItem : mapping.slabItem) : null;
      return {
        ...specBriefOf(item),
        itemName: item.itemName,
        itemType: item.itemType,
        unitType: item.unitType,
        steelGradeId: item.steelGradeId ?? 0,
        steelGradeCode: item.steelGradeCode ?? '-',
        defaultYardId: item.defaultYardId,
        defaultYardName: nameOf(yards, item.defaultYardId, (y) => y.yardName) ?? '-',
        mappingId: mapping?.id ?? null,
        mappedSpec: mapped ? specBriefOf(mapped) : null,
        hotRollingPlannedYieldRate: mapping?.hotRollingYieldRate ?? null,
        // 서버는 사용 여부를 주지 않는다. 쓰인 규격의 치수 수정은 저장할 때 MST-002로 막힌다
        isUsed: false,
        usageText: null,
        referenceText: null,
        updatedAt: '',
      };
    })
    .sort(
      (a, b) =>
        PRODUCT_ITEM_TYPES.indexOf(a.itemType) - PRODUCT_ITEM_TYPES.indexOf(b.itemType) ||
        a.steelGradeId - b.steelGradeId ||
        compareDecimal(b.thicknessMm, a.thicknessMm) ||
        compareDecimal(a.widthMm, b.widthMm) ||
        compareDecimal(a.lengthMm, b.lengthMm),
    );
}

async function listSpecMappings(): Promise<MasterSpecMappingView[]> {
  const mappings = await getSpecMappings();
  return mappings
    .map((m) => ({
      id: m.id,
      steelGradeId: m.steelGradeId,
      steelGradeCode: m.steelGradeCode,
      slab: specBriefOf(m.slabItem),
      coil: specBriefOf(m.coilItem),
      hotRollingPlannedYieldRate: m.hotRollingYieldRate,
      isUsed: false,
    }))
    .sort((a, b) => a.steelGradeId - b.steelGradeId || a.slab.id - b.slab.id);
}

/** 제강 검사 기준 지금 버전 (강종 코드별 가장 높은 버전). 검사 기준 조회 권한이 없으면 비운다 */
async function currentSteelmakingStandards(): Promise<Map<string, InspectionStandardListItem>> {
  const rows: InspectionStandardListItem[] = [];
  try {
    for (let page = 1; ; page++) {
      const result = await serverRequest<PageResult<InspectionStandardListItem>>('GET', '/inspection-standards', { query: { processType: 'STEELMAKING', page, size: PAGE_SIZE } });
      rows.push(...result.items);
      if (rows.length >= result.total || result.items.length === 0) break;
    }
  } catch (error) {
    if (error instanceof ApiError && error.code === 'COM-002') return new Map();
    throw error;
  }
  const current = new Map<string, InspectionStandardListItem>();
  for (const row of rows) {
    const seen = current.get(row.steelGradeCode);
    if (!seen || row.versionNo > seen.versionNo) current.set(row.steelGradeCode, row);
  }
  return current;
}

async function listSteelGrades(): Promise<MasterSteelGradeView[]> {
  const [grades, items, standards] = await Promise.all([getSteelGrades(), getItems(), currentSteelmakingStandards()]);
  return grades.map((grade) => {
    const standard = standards.get(grade.steelGradeCode);
    return {
      ...grade,
      specCount: items.filter((i) => i.steelGradeId === grade.id).length,
      steelmakingStandard: standard
        ? { id: standard.inspectionStandardId, inspectionStandardCode: standard.inspectionStandardCode, version: standard.versionNo, itemCount: standard.items.length }
        : null,
      referenceText: null,
      updatedAt: '',
    };
  });
}

async function listRoutings(): Promise<MasterRoutingView[]> {
  const routings = await serverRequest<RoutingView[]>('GET', '/routings');
  return PRODUCT_ITEM_TYPES.map((itemType) => ({
    itemType,
    steps: routings
      .filter((r) => r.itemType === itemType)
      .sort((a, b) => a.sequenceNo - b.sequenceNo)
      .map((r) => ({ id: r.id, processType: r.processType, processSeq: r.sequenceNo, plannedYieldRate: r.plannedYieldRate })),
    updatedAt: null,
  }));
}

async function listSpecificConsumptions(): Promise<MasterSpecificConsumptionView[]> {
  const rows = await serverRequest<SpecificConsumptionView[]>('GET', '/specific-consumptions');
  return rows.map((c) => ({
    id: c.id,
    itemId: c.rawMaterialItemId,
    steelGradeId: c.steelGradeId,
    consumptionRate: c.consumptionRate,
    consumptionUnit: specificConsumptionUnitOf(c.rawMaterialType),
  }));
}

async function listRawMaterials(): Promise<MasterRawMaterialView[]> {
  const [items, yards, suppliers] = await Promise.all([getItems(), getYards(), getSuppliers()]);
  return items
    .filter((i): i is ItemView & { rawMaterialType: RawMaterialType } => i.itemType === 'RAW_MATERIAL' && i.rawMaterialType !== null)
    .map((item) => ({
      id: item.id,
      itemCode: item.itemCode,
      itemName: item.itemName,
      rawMaterialType: item.rawMaterialType,
      unitType: item.unitType,
      defaultYardId: item.defaultYardId,
      defaultYardName: nameOf(yards, item.defaultYardId, (y) => y.yardName) ?? '-',
      defaultSupplierId: item.defaultSupplierId,
      defaultSupplierName: nameOf(suppliers, item.defaultSupplierId, (s) => s.supplierName),
      referenceText: null,
      updatedAt: '',
    }))
    .sort((a, b) => a.itemCode.localeCompare(b.itemCode));
}

async function listCustomers(): Promise<MasterCustomerView[]> {
  const rows = await serverRequest<CustomerView[]>('GET', '/customers');
  return rows.map((c) => ({ ...c, referenceText: null, updatedAt: '' }));
}

async function listSuppliers(): Promise<MasterSupplierView[]> {
  return (await getSuppliers()).map((s) => ({ ...s, referenceText: null, updatedAt: '' }));
}

async function listYards(): Promise<MasterYardView[]> {
  return (await getYards()).map((y) => ({ ...y, referenceText: null, updatedAt: '' }));
}

async function getProductionSetting(): Promise<MasterProductionSettingView> {
  const row = await serverRequest<ProductionSettingView>('GET', '/production-settings');
  return { ...row, updatedAt: '' };
}

export const serverMasterDataApi = {
  listProductSpecs,
  listSpecMappings,
  listSteelGrades,
  listRoutings,
  listSpecificConsumptions,
  listRawMaterials,
  listCustomers,
  listSuppliers,
  listYards,
  getProductionSetting,
};
