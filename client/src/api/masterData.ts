// 기준정보 API (docs/api/master-data.md). Decimal은 문자열로 온다. 요청 숫자는 JSON 숫자로 보낸다.
import type { ConsumptionUnit, ItemType, ProcessCode, RawMaterialType, YardType } from '@fantasteel/shared';
import { api } from './client';

export type UnitType = 'QTY' | 'TON';
export type SpecItemType = 'SLAB' | 'COIL';
export interface ListMasterQuery { active?: 'true' | 'false'; q?: string }
export interface DeleteResult { id: number; deleted: true }

// ── 준비 상태 점검 ─────────────────────────────────────────────
export type MasterArea = 'PRODUCT_SPEC' | 'SPEC_MAPPING' | 'ROUTING' | 'SPECIFIC_CONSUMPTION' | 'RAW_MATERIAL' | 'STEEL_GRADE' | 'INSPECTION_ITEM' | 'PRODUCTION_SETTING';
export interface ReadinessProblem { code: 'MST-001'; area: MasterArea; targetId: number | null; targetNo: string | null; message: string }
export interface ValidationResult { ready: boolean; checkedAt: string; problemCount: number; problems: ReadinessProblem[] }

// ── 품목 · 원료 ───────────────────────────────────────────────
export interface ItemView {
  id: number; itemCode: string; itemName: string;
  itemType: ItemType; itemTypeName: string;
  unitType: UnitType;
  defaultSupplierId: number | null; defaultSupplierName: string | null;
  rawMaterialId: number | null;
  isActive: boolean; createdAt: string; updatedAt: string;
}
export interface ItemListQuery extends ListMasterQuery { itemType?: ItemType }
export interface CreateItemBody { itemCode: string; itemName: string; itemType: SpecItemType; unitType?: UnitType; defaultSupplierId?: number | null }
export interface UpdateItemBody { itemName?: string; defaultSupplierId?: number | null; isActive?: boolean }

export interface RawMaterialView {
  id: number; itemId: number; itemCode: string; itemName: string; materialCode: string;
  rawMaterialType: RawMaterialType; rawMaterialTypeName: string;
  unitType: 'TON';
  yardId: number | null; yardName: string | null;
  defaultSupplierId: number | null; defaultSupplierName: string | null;
  onHandTon: string;
  isActive: boolean; createdAt: string; updatedAt: string;
}
export interface RawMaterialListQuery extends ListMasterQuery { rawMaterialType?: RawMaterialType }
export interface CreateRawMaterialBody { materialCode: string; itemName: string; rawMaterialType: RawMaterialType; yardId?: number | null; defaultSupplierId?: number | null }
export interface UpdateRawMaterialBody { itemName?: string; yardId?: number | null; defaultSupplierId?: number | null; isActive?: boolean }

// ── 강종 · 성분 ───────────────────────────────────────────────
export interface CompositionSpecView { id: number; elementCode: string; minValue: string | null; maxValue: string | null; sortOrder: number }
export interface SteelGradeView {
  id: number; steelGradeCode: string; steelGradeName: string; standardNo: string | null; isActive: boolean;
  compositionSpecs: CompositionSpecView[]; createdAt: string; updatedAt: string;
}
export interface CompositionSpecInput { elementCode: string; minValue?: number | null; maxValue?: number | null; sortOrder?: number }
export interface CreateSteelGradeBody { steelGradeCode: string; steelGradeName: string; standardNo?: string | null; compositionSpecs?: CompositionSpecInput[] }
export interface UpdateSteelGradeBody { steelGradeName?: string; standardNo?: string | null; isActive?: boolean }

// ── 제품 규격 ─────────────────────────────────────────────────
export interface MappedSpecView {
  id: number; specCode: string; itemType: SpecItemType;
  thicknessMm: string; widthMm: string; lengthMm: string; theoreticalWeightTon: string; isActive: boolean;
}
export interface ProductSpecView {
  id: number; specCode: string;
  itemId: number; itemType: SpecItemType; itemTypeName: string; itemName: string;
  steelGradeId: number; steelGradeCode: string;
  thicknessMm: string; widthMm: string; lengthMm: string;
  theoreticalWeightTon: string;
  yardId: number | null; yardName: string | null;
  isActive: boolean; isUsed: boolean;
  mappingId: number | null; mappedSpec: MappedSpecView | null;
  hotRollingPlannedYieldRate: string | null;
  createdAt: string; updatedAt: string;
}
export interface ProductSpecQuery { itemType?: SpecItemType; steelGradeId?: number; active?: 'true' | 'false'; q?: string }
export interface CreateProductSpecBody { itemType: SpecItemType; steelGradeId: number; thicknessMm: number; widthMm: number; lengthMm: number; yardId?: number | null }
export interface UpdateProductSpecBody { steelGradeId?: number; thicknessMm?: number; widthMm?: number; lengthMm?: number; yardId?: number | null }

// ── 규격 매핑 ─────────────────────────────────────────────────
export interface SpecMappingSpecView {
  id: number; specCode: string; steelGradeId: number; steelGradeCode: string;
  thicknessMm: string; widthMm: string; lengthMm: string; theoreticalWeightTon: string; isActive: boolean;
}
export interface SpecMappingView {
  id: number; steelGradeId: number; steelGradeCode: string;
  slabSpec: SpecMappingSpecView; coilSpec: SpecMappingSpecView;
  hotRollingPlannedYieldRate: string; isUsed: boolean; createdAt: string; updatedAt: string;
}

// ── 라우팅 ────────────────────────────────────────────────────
export interface RoutingProcessView {
  id: number; processCode: ProcessCode; processName: string; processSeq: number;
  plannedYieldRate: string | null; yieldSource: 'INPUT' | 'MAPPING';
}
export interface RoutingView { itemType: SpecItemType; processes: RoutingProcessView[] }

// ── 배합 원단위 ───────────────────────────────────────────────
export interface SpecificConsumptionView {
  id: number; rawMaterialId: number; materialCode: string; rawMaterialName: string;
  rawMaterialType: RawMaterialType; rawMaterialTypeName: string;
  steelGradeId: number | null; steelGradeCode: string | null;
  consumptionRate: string; consumptionUnit: ConsumptionUnit; consumptionUnitName: string; updatedAt: string;
}
export interface UpsertConsumptionBody { rawMaterialId: number; steelGradeId?: number | null; consumptionRate: number }

// ── 고객사 · 공급업체 · 야드 ──────────────────────────────────
export interface CustomerView { id: number; customerCode: string; customerName: string; isActive: boolean; createdAt: string; updatedAt: string }
export interface SupplierView { id: number; supplierCode: string; supplierName: string; isActive: boolean; createdAt: string; updatedAt: string }
export interface YardView { id: number; yardCode: string; yardName: string; yardType: YardType; isActive: boolean; createdAt: string; updatedAt: string }
export interface YardListQuery extends ListMasterQuery { yardType?: YardType }

// ── 생산 설정 ─────────────────────────────────────────────────
export interface ProductionSettingView { heatCapacityTon: string; deliveryRiskDays: number; updatedAt: string }
export interface UpdateProductionSettingBody { heatCapacityTon: number; deliveryRiskDays: number }

// ── 검사 항목 ─────────────────────────────────────────────────
export type InspectionProcess = 'CASTING' | 'HOT_ROLLING';
export interface InspectionItemView {
  id: number; processCode: InspectionProcess; processName: string;
  steelGradeId: number | null; steelGradeCode: string | null;
  inspectionItemCode: string; inspectionItemName: string; unit: string | null;
  minValue: string | null; maxValue: string | null; isRequired: boolean; sortOrder: number; updatedAt: string;
}
export interface InspectionItemQuery { processCode?: InspectionProcess; steelGradeId?: number }
export interface CreateInspectionItemBody {
  processCode: InspectionProcess; steelGradeId?: number | null; inspectionItemCode: string; inspectionItemName: string;
  unit?: string | null; minValue?: number | null; maxValue?: number | null; isRequired?: boolean; sortOrder?: number;
}
export interface UpdateInspectionItemBody {
  inspectionItemName?: string; unit?: string | null; minValue?: number | null; maxValue?: number | null; isRequired?: boolean; sortOrder?: number;
}

export const masterApi = {
  validation: () => api.get<ValidationResult>('/master-data/validation'),

  items: {
    list: (q: ItemListQuery = {}) => api.get<ItemView[]>('/items', { ...q }),
    create: (dto: CreateItemBody) => api.post<ItemView>('/items', dto),
    update: ({ id, ...dto }: UpdateItemBody & { id: number }) => api.patch<ItemView>(`/items/${id}`, dto),
  },
  rawMaterials: {
    list: (q: RawMaterialListQuery = {}) => api.get<RawMaterialView[]>('/raw-materials', { ...q }),
    create: (dto: CreateRawMaterialBody) => api.post<RawMaterialView>('/raw-materials', dto),
    update: ({ id, ...dto }: UpdateRawMaterialBody & { id: number }) => api.patch<RawMaterialView>(`/raw-materials/${id}`, dto),
  },
  steelGrades: {
    list: (q: ListMasterQuery = {}) => api.get<SteelGradeView[]>('/steel-grades', { ...q }),
    create: (dto: CreateSteelGradeBody) => api.post<SteelGradeView>('/steel-grades', dto),
    update: ({ id, ...dto }: UpdateSteelGradeBody & { id: number }) => api.patch<SteelGradeView>(`/steel-grades/${id}`, dto),
    remove: (id: number) => api.delete<DeleteResult>(`/steel-grades/${id}`),
    replaceComposition: ({ id, compositionSpecs }: { id: number; compositionSpecs: CompositionSpecInput[] }) =>
      api.put<SteelGradeView>(`/steel-grades/${id}/composition-specs`, { compositionSpecs }),
  },
  productSpecs: {
    list: (q: ProductSpecQuery = {}) => api.get<ProductSpecView[]>('/product-specs', { ...q }),
    create: (dto: CreateProductSpecBody) => api.post<ProductSpecView>('/product-specs', dto),
    update: ({ id, ...dto }: UpdateProductSpecBody & { id: number }) => api.patch<ProductSpecView>(`/product-specs/${id}`, dto),
    activate: (id: number) => api.post<ProductSpecView>(`/product-specs/${id}/activate`),
    deactivate: (id: number) => api.post<ProductSpecView>(`/product-specs/${id}/deactivate`),
  },
  specMappings: {
    list: (q: { steelGradeId?: number } = {}) => api.get<SpecMappingView[]>('/spec-mappings', { ...q }),
    create: (dto: { slabSpecId: number; coilSpecId: number }) => api.post<SpecMappingView>('/spec-mappings', dto),
    remove: (id: number) => api.delete<DeleteResult>(`/spec-mappings/${id}`),
  },
  routings: {
    list: () => api.get<RoutingView[]>('/routings'),
    save: ({ itemType, processes }: { itemType: SpecItemType; processes: { processCode: ProcessCode; plannedYieldRate?: number | null }[] }) =>
      api.put<RoutingView>(`/routings/${itemType}`, { processes }),
  },
  consumptions: {
    list: (q: { rawMaterialId?: number; steelGradeId?: number } = {}) => api.get<SpecificConsumptionView[]>('/specific-consumptions', { ...q }),
    upsert: (dto: UpsertConsumptionBody) => api.put<SpecificConsumptionView>('/specific-consumptions', dto),
    remove: (id: number) => api.delete<DeleteResult>(`/specific-consumptions/${id}`),
  },
  customers: {
    list: (q: ListMasterQuery = {}) => api.get<CustomerView[]>('/customers', { ...q }),
    create: (dto: { customerCode: string; customerName: string }) => api.post<CustomerView>('/customers', dto),
    update: ({ id, ...dto }: { id: number; customerName?: string; isActive?: boolean }) => api.patch<CustomerView>(`/customers/${id}`, dto),
    remove: (id: number) => api.delete<DeleteResult>(`/customers/${id}`),
  },
  suppliers: {
    list: (q: ListMasterQuery = {}) => api.get<SupplierView[]>('/suppliers', { ...q }),
    create: (dto: { supplierCode: string; supplierName: string }) => api.post<SupplierView>('/suppliers', dto),
    update: ({ id, ...dto }: { id: number; supplierName?: string; isActive?: boolean }) => api.patch<SupplierView>(`/suppliers/${id}`, dto),
    remove: (id: number) => api.delete<DeleteResult>(`/suppliers/${id}`),
  },
  yards: {
    list: (q: YardListQuery = {}) => api.get<YardView[]>('/yards', { ...q }),
    create: (dto: { yardCode: string; yardName: string; yardType: YardType }) => api.post<YardView>('/yards', dto),
    update: ({ id, ...dto }: { id: number; yardName?: string; isActive?: boolean }) => api.patch<YardView>(`/yards/${id}`, dto),
    remove: (id: number) => api.delete<DeleteResult>(`/yards/${id}`),
  },
  productionSettings: {
    get: () => api.get<ProductionSettingView>('/production-settings'),
    save: (dto: UpdateProductionSettingBody) => api.put<ProductionSettingView>('/production-settings', dto),
  },
  inspectionItems: {
    list: (q: InspectionItemQuery = {}) => api.get<InspectionItemView[]>('/inspection-items', { ...q }),
    create: (dto: CreateInspectionItemBody) => api.post<InspectionItemView>('/inspection-items', dto),
    update: ({ id, ...dto }: UpdateInspectionItemBody & { id: number }) => api.patch<InspectionItemView>(`/inspection-items/${id}`, dto),
    remove: (id: number) => api.delete<DeleteResult>(`/inspection-items/${id}`),
  },
};
