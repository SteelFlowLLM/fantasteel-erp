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
import { ApiError, InputError } from '@/api/errors';
import { serverRequest } from '@/api/http';
import type {
  CustomerInput,
  CustomerUpdateInput,
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
  ProductionSettingInput,
  ProductSpecInput,
  ProductSpecUpdateInput,
  RawMaterialInput,
  RawMaterialUpdateInput,
  RoutingSaveInput,
  SpecBrief,
  SpecificConsumptionChange,
  SpecMappingInput,
  SteelGradeInput,
  SupplierInput,
  SupplierUpdateInput,
  YardInput,
  YardUpdateInput,
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

/** 원료 품목 코드 → 기본 야드 이름 (입고 화면). 기준정보 조회 권한이 없으면 이름을 비운다 */
async function rawMaterialYardNames(): Promise<(itemCode: string) => string | null> {
  try {
    const [items, yards] = await Promise.all([serverRequest<ItemView[]>('GET', '/items', { query: { itemType: 'RAW_MATERIAL' } }), getYards()]);
    const yardNameOf = new Map(yards.map((y) => [y.id, y.yardName]));
    const byCode = new Map(items.map((i) => [i.itemCode, yardNameOf.get(i.defaultYardId) ?? null]));
    return (itemCode) => byCode.get(itemCode) ?? null;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'COM-002') return () => null;
    throw error;
  }
}

export const serverMasterDataApi = {
  rawMaterialYardNames,
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

// ── 변경 (API-166~188). 서버 거부(COM-004·MST-002)는 그대로 화면 오류로 보인다 ──

const idOf = async (method: 'POST' | 'PATCH', path: string, body: unknown): Promise<number> => (await serverRequest<{ id: number }>(method, path, { body })).id;

function requireChoice(value: number | null, field: string, message: string): number {
  if (value === null) throw new InputError(message, { [field]: message });
  return value;
}

const createProductSpec = async (input: ProductSpecInput) =>
  idOf('POST', '/items', {
    itemType: input.itemType,
    steelGradeId: requireChoice(input.steelGradeId, 'steelGradeId', '강종을 선택해 주세요'),
    thicknessMm: input.thicknessMm.trim(),
    widthMm: input.widthMm.trim(),
    lengthMm: input.lengthMm.trim(),
    defaultYardId: requireChoice(input.defaultYardId, 'defaultYardId', '기본 야드를 선택해 주세요'),
  });

const updateProductSpec = async (input: ProductSpecUpdateInput) =>
  idOf('PATCH', `/items/${input.id}`, {
    steelGradeId: requireChoice(input.steelGradeId, 'steelGradeId', '강종을 선택해 주세요'),
    thicknessMm: input.thicknessMm.trim(),
    widthMm: input.widthMm.trim(),
    lengthMm: input.lengthMm.trim(),
    defaultYardId: requireChoice(input.defaultYardId, 'defaultYardId', '기본 야드를 선택해 주세요'),
  });

const createSpecMapping = async (input: SpecMappingInput) =>
  idOf('POST', '/spec-mappings', {
    slabItemId: requireChoice(input.slabItemId, 'slabItemId', '슬래브 규격을 선택해 주세요'),
    coilItemId: requireChoice(input.coilItemId, 'coilItemId', '코일 규격을 선택해 주세요'),
  });

/** 서버는 적용 규격 번호가 필수다 (ERD not null) */
async function createSteelGrade(input: SteelGradeInput): Promise<number> {
  if (!input.standardNo.trim()) throw new InputError('적용 규격 번호를 입력해 주세요', { standardNo: '적용 규격 번호를 입력해 주세요' });
  return idOf('POST', '/steel-grades', { steelGradeCode: input.steelGradeCode, steelGradeName: input.steelGradeName, standardNo: input.standardNo });
}

/** 서버에는 라우팅 삭제 API가 없어 공정 빼기·순서 바꾸기는 막고, 수율 수정(PATCH)과 맨 뒤 공정 추가(POST)만 보낸다 */
async function saveRouting(input: RoutingSaveInput): Promise<number> {
  const current = (await serverRequest<RoutingView[]>('GET', '/routings')).filter((r) => r.itemType === input.itemType).sort((a, b) => a.sequenceNo - b.sequenceNo);
  const kept = input.steps.filter((s) => current.some((r) => r.processType === s.processType));
  if (kept.length !== current.length || kept.some((s, i) => s.processType !== current[i].processType)) {
    throw new InputError('서버에는 공정을 빼거나 순서를 바꾸는 API가 없어요');
  }
  let nextSeq = (current.at(-1)?.sequenceNo ?? 0) + 1;
  for (const step of input.steps) {
    const row = current.find((r) => r.processType === step.processType);
    if (!row) await serverRequest('POST', '/routings', { body: { itemType: input.itemType, processType: step.processType, sequenceNo: nextSeq++, plannedYieldRate: step.plannedYieldRate } });
    else if ((row.plannedYieldRate ?? null) !== step.plannedYieldRate && !(row.plannedYieldRate && step.plannedYieldRate && compareDecimal(row.plannedYieldRate, step.plannedYieldRate) === 0)) {
      await serverRequest('PATCH', `/routings/${row.id}`, { body: { plannedYieldRate: step.plannedYieldRate } });
    }
  }
  return input.steps.length;
}

/** 서버에는 원단위 삭제 API가 없어 칸 비우기는 막는다. 일괄 저장 API가 없어 칸마다 차례로 보낸다 */
async function saveSpecificConsumptions(changes: SpecificConsumptionChange[]): Promise<number> {
  const cleared = changes.filter((c) => !c.consumptionRate);
  if (cleared.length > 0) {
    throw new InputError('서버에서는 원단위를 비울 수 없어요', Object.fromEntries(cleared.map((c) => [`${c.itemId}:${c.steelGradeId ?? 'common'}`, '서버에서는 원단위를 비울 수 없어요'])));
  }
  const rows = await serverRequest<SpecificConsumptionView[]>('GET', '/specific-consumptions');
  for (const c of changes) {
    const row = rows.find((r) => r.rawMaterialItemId === c.itemId && r.steelGradeId === c.steelGradeId);
    if (row) await serverRequest('PATCH', `/specific-consumptions/${row.id}`, { body: { consumptionRate: c.consumptionRate } });
    else await serverRequest('POST', '/specific-consumptions', { body: { rawMaterialItemId: c.itemId, steelGradeId: c.steelGradeId, consumptionRate: c.consumptionRate } });
  }
  return changes.length;
}

const createRawMaterial = async (input: RawMaterialInput) =>
  idOf('POST', '/items', {
    itemType: 'RAW_MATERIAL',
    itemCode: input.itemCode,
    itemName: input.itemName,
    rawMaterialType: input.rawMaterialType ?? undefined,
    defaultYardId: requireChoice(input.defaultYardId, 'defaultYardId', '기본 야드를 선택해 주세요'),
    defaultSupplierId: input.defaultSupplierId,
  });

const updateRawMaterial = async (input: RawMaterialUpdateInput) =>
  idOf('PATCH', `/items/${input.id}`, {
    itemName: input.itemName,
    defaultYardId: requireChoice(input.defaultYardId, 'defaultYardId', '기본 야드를 선택해 주세요'),
    defaultSupplierId: input.defaultSupplierId,
  });

async function saveProductionSetting(input: ProductionSettingInput): Promise<number> {
  const days = Number(String(input.deliveryRiskDays).trim());
  if (!Number.isInteger(days) || days < 0) throw new InputError('납기 위험 기준일을 확인해 주세요', { deliveryRiskDays: '납기 위험 기준일은 0 이상의 정수예요' });
  return idOf('PATCH', '/production-settings', { heatCapacityTon: input.heatCapacityTon.trim(), deliveryRiskDays: days });
}

export const serverMasterDataWriteApi = {
  createProductSpec,
  updateProductSpec,
  createSpecMapping,
  createSteelGrade,
  saveRouting,
  saveSpecificConsumptions,
  createRawMaterial,
  updateRawMaterial,
  createCustomer: (input: CustomerInput) => idOf('POST', '/customers', input),
  updateCustomer: (input: CustomerUpdateInput) => idOf('PATCH', `/customers/${input.id}`, { customerName: input.customerName }),
  createSupplier: (input: SupplierInput) => idOf('POST', '/suppliers', input),
  updateSupplier: (input: SupplierUpdateInput) => idOf('PATCH', `/suppliers/${input.id}`, { supplierName: input.supplierName }),
  createYard: (input: YardInput) => idOf('POST', '/yards', { ...input, yardType: input.yardType ?? undefined }),
  updateYard: (input: YardUpdateInput) => idOf('PATCH', `/yards/${input.id}`, { yardName: input.yardName }),
  saveProductionSetting,
};
