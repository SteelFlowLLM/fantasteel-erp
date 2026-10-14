// 기준정보 화면의 조회·변경 (REQ-MST-001~009, BP-MST-01). 다른 화면의 선택 목록은 api/lookups.ts를 쓴다.
// - 변경 권한(MASTER_MANAGE, 없으면 COM-002), 없는 대상(COM-003), 화면을 연 뒤 바뀜(COM-001), 쓰인 규격의 치수·이론중량 변경(MST-002)은 서버가 확인한다.
// - 중복·형식처럼 9.3에 코드가 없는 거부는 InputError(입력칸별 안내)다.
// - 기준정보 변경에 맞는 BUSINESS_EVENT_TYPE이 공통 코드 29개 안에 없어 작업 로그는 남기지 않는다 (docs/rework/areas/master.md).
// - 조회·변경은 api/server/masterData.ts가 서버를 부른다.
import {
  type ProcessType,
  type ProductItemType,
  type RawMaterialType,
  type UnitType,
  type YardType,
} from '@/codes';
import { serverMasterDataApi, serverMasterDataWriteApi } from '@/api/server/masterData';
import { type SpecificConsumptionUnit } from '@/lib/units';

// ── 조회 키 ──────────────────────────────────────────────

export const masterDataKeys = {
  all: ['master-data'] as const,
  readiness: () => ['master-data', 'readiness'] as const,
  productSpecs: () => ['master-data', 'product-specs'] as const,
  specMappings: () => ['master-data', 'spec-mappings'] as const,
  steelGrades: () => ['master-data', 'steel-grades'] as const,
  routings: () => ['master-data', 'routings'] as const,
  specificConsumptions: () => ['master-data', 'specific-consumptions'] as const,
  rawMaterials: () => ['master-data', 'raw-materials'] as const,
  customers: () => ['master-data', 'customers'] as const,
  suppliers: () => ['master-data', 'suppliers'] as const,
  yards: () => ['master-data', 'yards'] as const,
  productionSetting: () => ['master-data', 'production-setting'] as const,
};

// ── 응답 모양 ────────────────────────────────────────────

export interface SpecBrief {
  id: number;
  itemCode: string;
  thicknessMm: string;
  widthMm: string;
  lengthMm: string;
  theoreticalWeightTon: string;
}

export interface MasterProductSpecView extends SpecBrief {
  itemName: string;
  itemType: ProductItemType;
  unitType: UnitType;
  steelGradeId: number;
  steelGradeCode: string;
  defaultYardId: number;
  defaultYardName: string;
  mappingId: number | null;
  /** 슬래브면 대응 코일, 코일이면 대응 슬래브 */
  mappedSpec: SpecBrief | null;
  /** 열연 계획 수율 = 코일 1개 ÷ 슬래브 1매 이론중량 (계산값, REQ-MST-004) */
  hotRollingPlannedYieldRate: string | null;
  /** 수주·재고·LOT·생산계획·예약에 쓰였는지. 쓰였으면 치수·이론중량을 못 바꾼다 (MST-002) */
  isUsed: boolean;
  usageText: string | null;
  /** 삭제를 막는 참조 (null이면 삭제할 수 있다) */
  referenceText: string | null;
  updatedAt: string;
}

export interface MasterSpecMappingView {
  id: number;
  steelGradeId: number;
  steelGradeCode: string;
  slab: SpecBrief;
  coil: SpecBrief;
  hotRollingPlannedYieldRate: string;
  /** 두 규격 중 하나라도 쓰였으면 매핑을 지울 수 없다 */
  isUsed: boolean;
}

export interface MasterSteelGradeView {
  id: number;
  steelGradeCode: string;
  steelGradeName: string;
  standardNo: string | null;
  specCount: number;
  /** 성분 규격 = 그 강종의 제강 검사 기준 지금 버전 (TRM-020). 강종별로만 두므로 공통 기준으로 대신하지 않는다 */
  steelmakingStandard: { id: number; inspectionStandardCode: string; version: number; itemCount: number } | null;
  referenceText: string | null;
  updatedAt: string;
}

export interface MasterRoutingStepView {
  id: number;
  processType: ProcessType;
  processSeq: number;
  plannedYieldRate: string | null;
}

export interface MasterRoutingView {
  itemType: ProductItemType;
  steps: MasterRoutingStepView[];
  /** 이 품목 유형 라우팅의 마지막 수정 시각 (COM-001 확인용) */
  updatedAt: string | null;
}

export interface MasterSpecificConsumptionView {
  id: number;
  itemId: number;
  steelGradeId: number | null;
  consumptionRate: string;
  consumptionUnit: SpecificConsumptionUnit;
}

export interface MasterRawMaterialView {
  id: number;
  itemCode: string;
  itemName: string;
  rawMaterialType: RawMaterialType;
  unitType: UnitType;
  defaultYardId: number;
  defaultYardName: string;
  defaultSupplierId: number | null;
  defaultSupplierName: string | null;
  referenceText: string | null;
  updatedAt: string;
}

export interface MasterCustomerView {
  id: number;
  customerCode: string;
  customerName: string;
  referenceText: string | null;
  updatedAt: string;
}

export interface MasterSupplierView {
  id: number;
  supplierCode: string;
  supplierName: string;
  referenceText: string | null;
  updatedAt: string;
}

export interface MasterYardView {
  id: number;
  yardCode: string;
  yardName: string;
  yardType: YardType;
  referenceText: string | null;
  updatedAt: string;
}

export interface MasterProductionSettingView {
  id: number;
  heatCapacityTon: string;
  deliveryRiskDays: number;
  updatedAt: string;
}

// ── 입력 모양 ────────────────────────────────────────────

export interface ProductSpecInput {
  itemType: ProductItemType;
  steelGradeId: number | null;
  thicknessMm: string;
  widthMm: string;
  lengthMm: string;
  defaultYardId: number | null;
}

export interface ProductSpecUpdateInput extends Omit<ProductSpecInput, 'itemType'> {
  id: number;
  expectedUpdatedAt?: string | null;
}

export interface SpecMappingInput {
  slabItemId: number | null;
  coilItemId: number | null;
}

export interface SteelGradeInput {
  steelGradeCode: string;
  steelGradeName: string;
  standardNo: string;
}

export interface SteelGradeUpdateInput {
  id: number;
  steelGradeName: string;
  standardNo: string;
  expectedUpdatedAt?: string | null;
}

export interface RoutingStepInput {
  processType: ProcessType;
  /** 열연은 넣지 않는다(규격 매핑에서 계산). 제선은 4.4 계산에 쓰지 않아 저장하지 않는다. */
  plannedYieldRate: string | null;
}

export interface RoutingSaveInput {
  itemType: ProductItemType;
  steps: RoutingStepInput[];
  expectedUpdatedAt?: string | null;
}

export interface SpecificConsumptionChange {
  itemId: number;
  steelGradeId: number | null;
  /** 비우면(null·'') 그 원단위를 지운다 */
  consumptionRate: string | null;
}

export interface RawMaterialInput {
  itemCode: string;
  itemName: string;
  rawMaterialType: RawMaterialType | null;
  defaultYardId: number | null;
  defaultSupplierId: number | null;
}

export interface RawMaterialUpdateInput {
  id: number;
  itemName: string;
  defaultYardId: number | null;
  defaultSupplierId: number | null;
  expectedUpdatedAt?: string | null;
}

// 고객사·공급업체·야드 입력: ERD 칼럼 이름 그대로 (customer_code/customer_name, supplier_code/supplier_name, yard_code/yard_name/yard_type).
// 입력칸 오류 키도 같은 이름을 쓴다. 코드(·야드 유형)는 만든 뒤 바꾸지 않아 수정 입력에는 이름만 있다.
export interface CustomerInput {
  customerCode: string;
  customerName: string;
}

export interface CustomerUpdateInput {
  id: number;
  customerName: string;
  expectedUpdatedAt?: string | null;
}

export interface SupplierInput {
  supplierCode: string;
  supplierName: string;
}

export interface SupplierUpdateInput {
  id: number;
  supplierName: string;
  expectedUpdatedAt?: string | null;
}

export interface YardInput {
  yardCode: string;
  yardName: string;
  yardType: YardType | null;
}

export interface YardUpdateInput {
  id: number;
  yardName: string;
  expectedUpdatedAt?: string | null;
}

export interface ProductionSettingInput {
  heatCapacityTon: string;
  deliveryRiskDays: string | number;
  expectedUpdatedAt?: string | null;
}

// ── API ──────────────────────────────────────────────────

export const masterDataApi = {
  // ── 제품 규격 (REQ-MST-003) ──
  listProductSpecs: (): Promise<MasterProductSpecView[]> => serverMasterDataApi.listProductSpecs(),

  createProductSpec: (input: ProductSpecInput): Promise<MasterProductSpecView['id']> => serverMasterDataWriteApi.createProductSpec(input),

  /** 쓰이지 않은 규격은 모두 고칠 수 있고, 쓰인 규격은 기본 야드만 고친다 (MST-002) */
  updateProductSpec: (input: ProductSpecUpdateInput): Promise<number> => serverMasterDataWriteApi.updateProductSpec(input),

  // ── 규격 매핑 (REQ-MST-004) ──
  listSpecMappings: (): Promise<MasterSpecMappingView[]> => serverMasterDataApi.listSpecMappings(),

  createSpecMapping: (input: SpecMappingInput): Promise<number> => serverMasterDataWriteApi.createSpecMapping(input),

  // ── 강종 (REQ-MST-002). 성분 규격은 제강 검사 기준에서 관리한다 ──
  listSteelGrades: (): Promise<MasterSteelGradeView[]> => serverMasterDataApi.listSteelGrades(),

  createSteelGrade: (input: SteelGradeInput): Promise<number> => serverMasterDataWriteApi.createSteelGrade(input),

  // ── 라우팅 (REQ-MST-005) ──
  listRoutings: (): Promise<MasterRoutingView[]> => serverMasterDataApi.listRoutings(),

  /** 품목 유형의 공정 순서와 계획 수율을 통째로 저장한다. 순서 = 목록 순서 (0 < 수율 ≤ 1, BP-MST-01) */
  saveRouting: (input: RoutingSaveInput): Promise<number> => serverMasterDataWriteApi.saveRouting(input),

  // ── 배합 원단위 (REQ-MST-006) ──
  listSpecificConsumptions: (): Promise<MasterSpecificConsumptionView[]> => serverMasterDataApi.listSpecificConsumptions(),

  /** 바뀐 칸을 한 번에 저장한다 (하나라도 틀리면 아무것도 저장하지 않음). 입력칸 키 = `${itemId}:${steelGradeId ?? 'common'}` */
  saveSpecificConsumptions: (changes: SpecificConsumptionChange[]): Promise<number> => serverMasterDataWriteApi.saveSpecificConsumptions(changes),

  // ── 원료 품목 (REQ-MST-001·007·008) ──
  listRawMaterials: (): Promise<MasterRawMaterialView[]> => serverMasterDataApi.listRawMaterials(),

  createRawMaterial: (input: RawMaterialInput): Promise<number> => serverMasterDataWriteApi.createRawMaterial(input),

  /** 원료 코드·원료 유형은 만든 뒤 바꾸지 않는다 (LOT 번호 RM-원료코드-…에 쓰임) */
  updateRawMaterial: (input: RawMaterialUpdateInput): Promise<number> => serverMasterDataWriteApi.updateRawMaterial(input),

  // ── 고객사·공급업체 (REQ-MST-007) ──
  listCustomers: (): Promise<MasterCustomerView[]> => serverMasterDataApi.listCustomers(),

  createCustomer: (input: CustomerInput): Promise<number> => serverMasterDataWriteApi.createCustomer(input),

  updateCustomer: (input: CustomerUpdateInput): Promise<number> => serverMasterDataWriteApi.updateCustomer(input),

  listSuppliers: (): Promise<MasterSupplierView[]> => serverMasterDataApi.listSuppliers(),

  createSupplier: (input: SupplierInput): Promise<number> => serverMasterDataWriteApi.createSupplier(input),

  updateSupplier: (input: SupplierUpdateInput): Promise<number> => serverMasterDataWriteApi.updateSupplier(input),

  // ── 야드 (REQ-MST-008). 야드 안 위치는 관리하지 않는다 ──
  listYards: (): Promise<MasterYardView[]> => serverMasterDataApi.listYards(),

  createYard: (input: YardInput): Promise<number> => serverMasterDataWriteApi.createYard(input),

  /** 야드 유형은 만든 뒤 바꾸지 않는다 (품목 기본 야드·LOT가 유형에 맞게 쓰고 있음) */
  updateYard: (input: YardUpdateInput): Promise<number> => serverMasterDataWriteApi.updateYard(input),

  // ── 생산 설정값 (REQ-MST-009, 단일 행) ──
  getProductionSetting: (): Promise<MasterProductionSettingView | null> => serverMasterDataApi.getProductionSetting(),

  saveProductionSetting: (input: ProductionSettingInput): Promise<number> => serverMasterDataWriteApi.saveProductionSetting(input),

  /** 기준정보 삭제 (API-275~279, [05] 7-2): 쓰는 곳이 있으면 서버가 COM-004와 쓰는 곳 이름으로 막는다. 품목은 원료·제품 규격 모두 */
  deleteItem: (id: number): Promise<void> => serverMasterDataWriteApi.deleteItem(id),
  deleteSteelGrade: (id: number): Promise<void> => serverMasterDataWriteApi.deleteSteelGrade(id),
  deleteCustomer: (id: number): Promise<void> => serverMasterDataWriteApi.deleteCustomer(id),
  deleteSupplier: (id: number): Promise<void> => serverMasterDataWriteApi.deleteSupplier(id),
  deleteYard: (id: number): Promise<void> => serverMasterDataWriteApi.deleteYard(id),
};

