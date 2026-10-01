// 기준정보 화면의 조회·변경 (REQ-MST-001~009, BP-MST-01). 다른 화면의 선택 목록은 api/lookups.ts를 쓴다.
// - 모든 변경은 기준정보 관리(MASTER_MANAGE) 사용 권한을 다시 확인한다 (BP-AUTH-01, 없으면 COM-002).
// - 없는 대상 id는 COM-003, 화면을 연 뒤 다른 곳에서 바뀌었으면 COM-001, 쓰인 규격의 치수·이론중량 변경은 MST-002.
// - 중복·형식·참조 중 삭제처럼 9.3에 코드가 없는 거부는 InputError(입력칸별 안내)다.
// - 기준정보 변경에 맞는 BUSINESS_EVENT_TYPE이 공통 코드 29개 안에 없어 작업 로그는 남기지 않는다 (docs/rework/areas/master.md).
import {
  ITEM_TYPE_LABEL,
  ITEM_TYPE_UNIT_TYPE,
  PERMISSION,
  PROCESS_TYPE,
  PROCESS_TYPE_LABEL,
  RAW_MATERIAL_CODE_PATTERN,
  RAW_MATERIAL_TYPE,
  YARD_TYPE,
  YARD_TYPE_LABEL,
  formatSpecCode,
  type ProcessType,
  type ProductItemType,
  type RawMaterialType,
  type UnitType,
  type YardType,
} from '@/codes';
import { requireActor } from '@/api/actor';
import { ApiError, FieldErrors, InputError, mockMutation, mockQuery } from '@/api/client';
import { assertUnchanged, decimalText, nonNegativeInteger, optionalText, requiredText, requireRow } from '@/api/validation';
import { findCurrentStandard } from '@/features/inspectionStandards/lib/standardItems';
import { computeMasterReadiness, type MasterReadiness } from '@/features/masterData/lib/readiness';
import {
  customerReferencesOf,
  isSpecUsed,
  productSpecReferencesOf,
  rawMaterialReferencesOf,
  referenceText,
  specUsageOf,
  steelGradeReferencesOf,
  supplierReferencesOf,
  yardReferencesOf,
  type ReferenceCount,
} from '@/features/masterData/lib/references';
import { withEulReul, withGwaWa, withIGa } from '@/lib/josa';
import { specificConsumptionUnitOf, type SpecificConsumptionUnit } from '@/lib/units';
import { calcHotRollingYieldRate, calcTheoreticalWeightTon, compareDecimal, formatDecimal } from '@/lib/weight';
import type { ItemRow, MockTables, RowOf, TableName } from '@/mock/schema';
import { insertRow, updateRow, type MockTx } from '@/mock/store';

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

export interface MasterReadinessView extends MasterReadiness {
  checkedAt: string;
}

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
  /** 성분 규격 = 제강 검사 기준의 지금 버전 (TRM-020) */
  steelmakingStandard: { id: number; inspectionStandardCode: string; version: number; itemCount: number; isCommon: boolean } | null;
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

export interface PartyInput {
  code: string;
  name: string;
}

export interface PartyUpdateInput {
  id: number;
  name: string;
  expectedUpdatedAt?: string | null;
}

export interface YardInput extends PartyInput {
  yardType: YardType | null;
}

export interface ProductionSettingInput {
  heatCapacityTon: string;
  deliveryRiskDays: string | number;
  expectedUpdatedAt?: string | null;
}

// ── 내부 도우미 ──────────────────────────────────────────

const requireMasterManager = (tables: Readonly<MockTables>) => requireActor(tables, { use: [PERMISSION.MASTER_MANAGE] });

function removeRow<K extends TableName>(tx: MockTx, table: K, id: number): void {
  const rows = tx.tables[table] as RowOf<K>[];
  const index = rows.findIndex((row) => row.id === id);
  if (index >= 0) rows.splice(index, 1);
}

/** 참조가 있으면 삭제를 거부한다 */
function assertNoReferences(what: string, references: readonly ReferenceCount[]): void {
  const text = referenceText(references);
  if (text) throw new InputError(`${withEulReul(what)} 쓰는 곳이 있어 삭제할 수 없어요 (${text})`);
}

/** 코드 형식: 영문 대문자·숫자로 시작하고 대문자·숫자·밑줄·하이픈 */
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]*$/;
/** 강종 코드: 영문 대문자·숫자·하이픈 (예: SM355A) */
const STEEL_GRADE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]*$/;

function codeText(errors: FieldErrors, field: string, value: string, label: string, maxLength: number, pattern: RegExp, example: string): string | null {
  const text = requiredText(errors, field, value.toUpperCase(), label, maxLength);
  if (text === null) return null;
  if (!pattern.test(text)) {
    errors.add(field, `${withIGa(label)} 형식에 맞지 않아요 (예: ${example})`);
    return null;
  }
  return text;
}

const DIMENSION_RULE = { thicknessMm: { label: '두께', integerDigits: 6 }, widthMm: { label: '폭', integerDigits: 6 }, lengthMm: { label: '길이', integerDigits: 8 } } as const;
type DimensionField = keyof typeof DIMENSION_RULE;

const isProductItem = (item: ItemRow): item is ItemRow & {
  itemType: ProductItemType;
  steelGradeId: number;
  thicknessMm: string;
  widthMm: string;
  lengthMm: string;
  theoreticalWeightTon: string;
} =>
  item.itemType !== 'RAW_MATERIAL' &&
  item.steelGradeId !== null &&
  item.thicknessMm !== null &&
  item.widthMm !== null &&
  item.lengthMm !== null &&
  item.theoreticalWeightTon !== null;

const trimZeros = (value: string) => (value.includes('.') ? value.replace(/\.?0+$/, '') : value);
/** 규격 품목명: 'SS275 슬래브 250×1200×10000' (시드와 같은 모양) */
const specItemName = (itemType: ProductItemType, steelGradeCode: string, t: string, w: string, l: string) =>
  `${steelGradeCode} ${ITEM_TYPE_LABEL[itemType]} ${trimZeros(t)}×${trimZeros(w)}×${trimZeros(l)}`;

interface ValidSpec {
  steelGradeId: number;
  steelGradeCode: string;
  thicknessMm: string;
  widthMm: string;
  lengthMm: string;
  theoreticalWeightTon: string;
  defaultYardId: number;
}

/** 제품 규격 입력 확인: 강종·치수·기본 야드, 같은 조합 중복 (REQ-MST-003·008) */
function readSpecInput(tables: Readonly<MockTables>, itemType: ProductItemType, input: Omit<ProductSpecInput, 'itemType'>, selfId: number | null): ValidSpec {
  const errors = new FieldErrors();
  const grade = input.steelGradeId === null ? undefined : requireRow(tables, 'steelGrade', input.steelGradeId, '강종');
  if (!grade) errors.add('steelGradeId', '강종을 선택해 주세요');

  const dims: Partial<Record<DimensionField, string>> = {};
  for (const field of Object.keys(DIMENSION_RULE) as DimensionField[]) {
    const rule = DIMENSION_RULE[field];
    const value = decimalText(errors, field, input[field], { label: rule.label, scale: 2, integerDigits: rule.integerDigits, positive: true });
    if (value === null) errors.add(field, `${withEulReul(rule.label)} 입력해 주세요`);
    else if (value !== undefined) dims[field] = formatDecimal(value, 2);
  }

  const yard = input.defaultYardId === null ? undefined : requireRow(tables, 'yard', input.defaultYardId, '야드');
  if (!yard) errors.add('defaultYardId', '기본 야드를 선택해 주세요');
  else if (yard.yardType !== itemType) errors.add('defaultYardId', `${YARD_TYPE_LABEL[itemType]}만 기본 야드로 고를 수 있어요`);

  const { thicknessMm, widthMm, lengthMm } = dims;
  let weight: string | null = null;
  if (thicknessMm && widthMm && lengthMm) {
    weight = calcTheoreticalWeightTon(thicknessMm, widthMm, lengthMm);
    if (compareDecimal(weight, '0') <= 0) errors.add('thicknessMm', '1매 이론중량이 0이 되는 치수예요. 치수를 확인해 주세요');
    if (grade) {
      const duplicate = tables.item.find(
        (i) =>
          i.id !== selfId &&
          i.itemType === itemType &&
          i.steelGradeId === grade.id &&
          i.thicknessMm !== null &&
          i.widthMm !== null &&
          i.lengthMm !== null &&
          compareDecimal(i.thicknessMm, thicknessMm) === 0 &&
          compareDecimal(i.widthMm, widthMm) === 0 &&
          compareDecimal(i.lengthMm, lengthMm) === 0,
      );
      if (duplicate) errors.add('thicknessMm', `같은 강종·두께·폭·길이의 규격이 이미 있어요 (${duplicate.itemCode})`);
    }
  }
  errors.throwIfAny();
  if (!grade || !yard || !thicknessMm || !widthMm || !lengthMm || !weight) throw new InputError('입력한 내용을 확인해 주세요');
  return { steelGradeId: grade.id, steelGradeCode: grade.steelGradeCode, thicknessMm, widthMm, lengthMm, theoreticalWeightTon: weight, defaultYardId: yard.id };
}

const toBrief = (item: ItemRow): SpecBrief => ({
  id: item.id,
  itemCode: item.itemCode,
  thicknessMm: item.thicknessMm ?? '0',
  widthMm: item.widthMm ?? '0',
  lengthMm: item.lengthMm ?? '0',
  theoreticalWeightTon: item.theoreticalWeightTon ?? '0',
});

const gradeCodeOf = (tables: Readonly<MockTables>, id: number | null) => tables.steelGrade.find((g) => g.id === id)?.steelGradeCode ?? '-';
const yardNameOf = (tables: Readonly<MockTables>, id: number | null) => tables.yard.find((y) => y.id === id)?.yardName ?? '-';

/** 코일 1개 이론중량 ≤ 슬래브 1매 이론중량 (REQ-MST-004) */
function assertCoilNotHeavier(slabWeight: string, coilWeight: string, field: string): void {
  if (compareDecimal(coilWeight, slabWeight) > 0) {
    throw new InputError('코일 이론중량이 슬래브보다 커요', {
      [field]: `코일 1개 이론중량(${coilWeight} t)이 슬래브 1매 이론중량(${slabWeight} t)보다 커서 매핑할 수 없어요`,
    });
  }
}

const PRODUCT_ITEM_TYPES: readonly ProductItemType[] = ['SLAB', 'COIL'];

// ── API ──────────────────────────────────────────────────

export const masterDataApi = {
  // 준비 상태 (BP-MST-01, MST-001)
  getReadiness: (): Promise<MasterReadinessView> => mockQuery((tables) => ({ ...computeMasterReadiness(tables), checkedAt: new Date().toISOString() })),

  // ── 제품 규격 (REQ-MST-003) ──
  listProductSpecs: (): Promise<MasterProductSpecView[]> =>
    mockQuery((tables) =>
      tables.item
        .filter(isProductItem)
        .map((item): MasterProductSpecView => {
          const mapping = tables.specMapping.find((m) => (item.itemType === 'SLAB' ? m.slabItemId : m.coilItemId) === item.id) ?? null;
          const mapped = mapping ? tables.item.find((i) => i.id === (item.itemType === 'SLAB' ? mapping.coilItemId : mapping.slabItemId)) : undefined;
          const slabWeight = item.itemType === 'SLAB' ? item.theoreticalWeightTon : mapped?.theoreticalWeightTon;
          const coilWeight = item.itemType === 'COIL' ? item.theoreticalWeightTon : mapped?.theoreticalWeightTon;
          const usage = specUsageOf(tables, item.id);
          return {
            ...toBrief(item),
            itemName: item.itemName,
            itemType: item.itemType,
            unitType: item.unitType,
            steelGradeId: item.steelGradeId,
            steelGradeCode: gradeCodeOf(tables, item.steelGradeId),
            defaultYardId: item.defaultYardId,
            defaultYardName: yardNameOf(tables, item.defaultYardId),
            mappingId: mapping?.id ?? null,
            mappedSpec: mapped ? toBrief(mapped) : null,
            hotRollingPlannedYieldRate: slabWeight && coilWeight ? calcHotRollingYieldRate(coilWeight, slabWeight) : null,
            isUsed: referenceText(usage) !== null,
            usageText: referenceText(usage),
            referenceText: referenceText(productSpecReferencesOf(tables, item.id)),
            updatedAt: item.updatedAt,
          };
        })
        .sort(
          (a, b) =>
            PRODUCT_ITEM_TYPES.indexOf(a.itemType) - PRODUCT_ITEM_TYPES.indexOf(b.itemType) ||
            a.steelGradeCode.localeCompare(b.steelGradeCode) ||
            compareDecimal(b.thicknessMm, a.thicknessMm) ||
            compareDecimal(a.widthMm, b.widthMm) ||
            compareDecimal(a.lengthMm, b.lengthMm),
        ),
    ),

  createProductSpec: (input: ProductSpecInput): Promise<MasterProductSpecView['id']> =>
    mockMutation((tx) => {
      requireMasterManager(tx.tables);
      if (!PRODUCT_ITEM_TYPES.includes(input.itemType)) throw new InputError('품목 유형을 확인해 주세요', { itemType: '슬래브 또는 코일을 골라 주세요' });
      const spec = readSpecInput(tx.tables, input.itemType, input, null);
      const itemCode = formatSpecCode(input.itemType, spec.steelGradeCode, spec.thicknessMm, spec.widthMm, spec.lengthMm);
      if (tx.tables.item.some((i) => i.itemCode === itemCode)) throw new InputError('같은 규격 코드가 이미 있어요', { thicknessMm: `${withIGa(`규격 코드 ${itemCode}`)} 이미 있어요` });
      return insertRow(tx, 'item', {
        itemCode,
        itemName: specItemName(input.itemType, spec.steelGradeCode, spec.thicknessMm, spec.widthMm, spec.lengthMm),
        itemType: input.itemType,
        unitType: ITEM_TYPE_UNIT_TYPE[input.itemType],
        rawMaterialType: null,
        steelGradeId: spec.steelGradeId,
        thicknessMm: spec.thicknessMm,
        widthMm: spec.widthMm,
        lengthMm: spec.lengthMm,
        theoreticalWeightTon: spec.theoreticalWeightTon,
        defaultYardId: spec.defaultYardId,
        defaultSupplierId: null,
      }).id;
    }),

  /** 쓰이지 않은 규격은 모두 고칠 수 있고, 쓰인 규격은 기본 야드만 고친다 (MST-002) */
  updateProductSpec: (input: ProductSpecUpdateInput): Promise<number> =>
    mockMutation((tx) => {
      requireMasterManager(tx.tables);
      const row = requireRow(tx.tables, 'item', input.id, '제품 규격');
      if (!isProductItem(row)) throw new ApiError('COM-003', '제품 규격');
      assertUnchanged(row.updatedAt, input.expectedUpdatedAt, '제품 규격');
      const spec = readSpecInput(tx.tables, row.itemType, input, row.id);
      const dimensionsChanged =
        spec.steelGradeId !== row.steelGradeId ||
        compareDecimal(spec.thicknessMm, row.thicknessMm) !== 0 ||
        compareDecimal(spec.widthMm, row.widthMm) !== 0 ||
        compareDecimal(spec.lengthMm, row.lengthMm) !== 0;
      if (dimensionsChanged && isSpecUsed(tx.tables, row.id)) throw new ApiError('MST-002', '다른 치수는 새 규격으로 추가해 주세요');
      if (dimensionsChanged) {
        const mapping = tx.tables.specMapping.find((m) => m.slabItemId === row.id || m.coilItemId === row.id);
        if (mapping) {
          const other = requireRow(tx.tables, 'item', row.itemType === 'SLAB' ? mapping.coilItemId : mapping.slabItemId, '대응 규격');
          if (other.steelGradeId !== spec.steelGradeId) {
            throw new InputError('매핑된 규격과 강종이 달라져요', { steelGradeId: `${withGwaWa(`대응 규격 ${other.itemCode}`)} 강종이 같아야 해요. 매핑을 먼저 지워 주세요` });
          }
          const otherWeight = other.theoreticalWeightTon ?? '0';
          if (row.itemType === 'SLAB') assertCoilNotHeavier(spec.theoreticalWeightTon, otherWeight, 'thicknessMm');
          else assertCoilNotHeavier(otherWeight, spec.theoreticalWeightTon, 'thicknessMm');
        }
        const itemCode = formatSpecCode(row.itemType, spec.steelGradeCode, spec.thicknessMm, spec.widthMm, spec.lengthMm);
        if (tx.tables.item.some((i) => i.id !== row.id && i.itemCode === itemCode)) {
          throw new InputError('같은 규격 코드가 이미 있어요', { thicknessMm: `${withIGa(`규격 코드 ${itemCode}`)} 이미 있어요` });
        }
        updateRow(tx, 'item', row.id, {
          itemCode,
          itemName: specItemName(row.itemType, spec.steelGradeCode, spec.thicknessMm, spec.widthMm, spec.lengthMm),
          steelGradeId: spec.steelGradeId,
          thicknessMm: spec.thicknessMm,
          widthMm: spec.widthMm,
          lengthMm: spec.lengthMm,
          theoreticalWeightTon: spec.theoreticalWeightTon,
          defaultYardId: spec.defaultYardId,
        });
      } else {
        updateRow(tx, 'item', row.id, { defaultYardId: spec.defaultYardId });
      }
      return row.id;
    }),

  deleteProductSpec: (id: number): Promise<number> =>
    mockMutation((tx) => {
      requireMasterManager(tx.tables);
      const row = requireRow(tx.tables, 'item', id, '제품 규격');
      if (!isProductItem(row)) throw new ApiError('COM-003', '제품 규격');
      assertNoReferences(`규격 ${row.itemCode}`, productSpecReferencesOf(tx.tables, row.id));
      // 매수가 0인 재고 행은 규격과 함께 지운다 (재고 계산용 행)
      for (const inventory of tx.tables.inventory.filter((r) => r.itemId === row.id)) removeRow(tx, 'inventory', inventory.id);
      removeRow(tx, 'item', row.id);
      return row.id;
    }),

  // ── 규격 매핑 (REQ-MST-004) ──
  listSpecMappings: (): Promise<MasterSpecMappingView[]> =>
    mockQuery((tables) =>
      tables.specMapping
        .flatMap((m): MasterSpecMappingView[] => {
          const slab = tables.item.find((i) => i.id === m.slabItemId);
          const coil = tables.item.find((i) => i.id === m.coilItemId);
          if (!slab || !coil || !isProductItem(slab) || !isProductItem(coil)) return [];
          return [
            {
              id: m.id,
              steelGradeId: slab.steelGradeId,
              steelGradeCode: gradeCodeOf(tables, slab.steelGradeId),
              slab: toBrief(slab),
              coil: toBrief(coil),
              hotRollingPlannedYieldRate: calcHotRollingYieldRate(coil.theoreticalWeightTon, slab.theoreticalWeightTon),
              isUsed: isSpecUsed(tables, slab.id) || isSpecUsed(tables, coil.id),
            },
          ];
        })
        .sort((a, b) => a.steelGradeCode.localeCompare(b.steelGradeCode) || a.slab.itemCode.localeCompare(b.slab.itemCode)),
    ),

  createSpecMapping: (input: SpecMappingInput): Promise<number> =>
    mockMutation((tx) => {
      requireMasterManager(tx.tables);
      const errors = new FieldErrors();
      if (input.slabItemId === null) errors.add('slabItemId', '슬래브 규격을 선택해 주세요');
      if (input.coilItemId === null) errors.add('coilItemId', '코일 규격을 선택해 주세요');
      errors.throwIfAny();
      const slab = requireRow(tx.tables, 'item', input.slabItemId, '슬래브 규격');
      const coil = requireRow(tx.tables, 'item', input.coilItemId, '코일 규격');
      if (slab.itemType !== 'SLAB' || !isProductItem(slab)) throw new InputError('슬래브 규격이 아니에요', { slabItemId: '슬래브 규격을 골라 주세요' });
      if (coil.itemType !== 'COIL' || !isProductItem(coil)) throw new InputError('코일 규격이 아니에요', { coilItemId: '코일 규격을 골라 주세요' });
      if (slab.steelGradeId !== coil.steelGradeId) throw new InputError('강종이 다른 규격은 매핑할 수 없어요', { coilItemId: '슬래브와 같은 강종의 코일 규격을 골라 주세요' });
      if (tx.tables.specMapping.some((m) => m.slabItemId === slab.id)) throw new InputError('이미 대응 코일이 있는 슬래브 규격이에요', { slabItemId: '슬래브 규격마다 대응 코일 규격은 1개예요' });
      if (tx.tables.specMapping.some((m) => m.coilItemId === coil.id)) throw new InputError('다른 슬래브 규격에 이미 매핑된 코일 규격이에요', { coilItemId: '대응 코일이 중복돼요' });
      assertCoilNotHeavier(slab.theoreticalWeightTon, coil.theoreticalWeightTon, 'coilItemId');
      return insertRow(tx, 'specMapping', { slabItemId: slab.id, coilItemId: coil.id }).id;
    }),

  deleteSpecMapping: (id: number): Promise<number> =>
    mockMutation((tx) => {
      requireMasterManager(tx.tables);
      const mapping = requireRow(tx.tables, 'specMapping', id, '규격 매핑');
      if (isSpecUsed(tx.tables, mapping.slabItemId) || isSpecUsed(tx.tables, mapping.coilItemId)) {
        throw new InputError('수주·재고·LOT에 쓰인 규격의 매핑은 삭제할 수 없어요');
      }
      removeRow(tx, 'specMapping', mapping.id);
      return mapping.id;
    }),

  // ── 강종 (REQ-MST-002). 성분 규격은 제강 검사 기준에서 관리한다 ──
  listSteelGrades: (): Promise<MasterSteelGradeView[]> =>
    mockQuery((tables) =>
      tables.steelGrade.map((grade): MasterSteelGradeView => {
        const standard = findCurrentStandard(tables.inspectionStandard, 'STEELMAKING', grade.id);
        return {
          id: grade.id,
          steelGradeCode: grade.steelGradeCode,
          steelGradeName: grade.steelGradeName,
          standardNo: grade.standardNo,
          specCount: tables.item.filter((i) => i.steelGradeId === grade.id).length,
          steelmakingStandard: standard
            ? {
                id: standard.id,
                inspectionStandardCode: standard.inspectionStandardCode,
                version: standard.version,
                itemCount: tables.inspectionStandardItem.filter((i) => i.inspectionStandardId === standard.id).length,
                isCommon: standard.steelGradeId === null,
              }
            : null,
          referenceText: referenceText(steelGradeReferencesOf(tables, grade.id)),
          updatedAt: grade.updatedAt,
        };
      }),
    ),

  createSteelGrade: (input: SteelGradeInput): Promise<number> =>
    mockMutation((tx) => {
      requireMasterManager(tx.tables);
      const errors = new FieldErrors();
      const code = codeText(errors, 'steelGradeCode', input.steelGradeCode, '강종 코드', 20, STEEL_GRADE_CODE_PATTERN, 'SM355A');
      const name = requiredText(errors, 'steelGradeName', input.steelGradeName, '강종 이름', 50);
      const standardNo = optionalText(errors, 'standardNo', input.standardNo, '적용 규격 번호', 30);
      if (code && tx.tables.steelGrade.some((g) => g.steelGradeCode === code)) errors.add('steelGradeCode', `${withIGa(`강종 ${code}`)} 이미 있어요`);
      errors.throwIfAny();
      if (!code || !name) throw new InputError('입력한 내용을 확인해 주세요');
      return insertRow(tx, 'steelGrade', { steelGradeCode: code, steelGradeName: name, standardNo }).id;
    }),

  updateSteelGrade: (input: SteelGradeUpdateInput): Promise<number> =>
    mockMutation((tx) => {
      requireMasterManager(tx.tables);
      const row = requireRow(tx.tables, 'steelGrade', input.id, '강종');
      assertUnchanged(row.updatedAt, input.expectedUpdatedAt, '강종');
      const errors = new FieldErrors();
      const name = requiredText(errors, 'steelGradeName', input.steelGradeName, '강종 이름', 50);
      const standardNo = optionalText(errors, 'standardNo', input.standardNo, '적용 규격 번호', 30);
      errors.throwIfAny();
      if (!name) throw new InputError('입력한 내용을 확인해 주세요');
      updateRow(tx, 'steelGrade', row.id, { steelGradeName: name, standardNo });
      return row.id;
    }),

  deleteSteelGrade: (id: number): Promise<number> =>
    mockMutation((tx) => {
      requireMasterManager(tx.tables);
      const row = requireRow(tx.tables, 'steelGrade', id, '강종');
      assertNoReferences(`강종 ${row.steelGradeCode}`, steelGradeReferencesOf(tx.tables, row.id));
      removeRow(tx, 'steelGrade', row.id);
      return row.id;
    }),

  // ── 라우팅 (REQ-MST-005) ──
  listRoutings: (): Promise<MasterRoutingView[]> =>
    mockQuery((tables) =>
      PRODUCT_ITEM_TYPES.map((itemType) => {
        const rows = tables.routing.filter((r) => r.itemType === itemType).sort((a, b) => a.processSeq - b.processSeq);
        return {
          itemType,
          steps: rows.map(({ id, processType, processSeq, plannedYieldRate }) => ({ id, processType, processSeq, plannedYieldRate })),
          updatedAt: rows.reduce<string | null>((latest, r) => (latest === null || r.updatedAt > latest ? r.updatedAt : latest), null),
        };
      }),
    ),

  /** 품목 유형의 공정 순서와 계획 수율을 통째로 저장한다. 순서 = 목록 순서 (0 < 수율 ≤ 1, BP-MST-01) */
  saveRouting: (input: RoutingSaveInput): Promise<number> =>
    mockMutation((tx) => {
      requireMasterManager(tx.tables);
      if (!PRODUCT_ITEM_TYPES.includes(input.itemType)) throw new InputError('품목 유형을 확인해 주세요');
      const existing = tx.tables.routing.filter((r) => r.itemType === input.itemType);
      const latest = existing.reduce<string>((max, r) => (r.updatedAt > max ? r.updatedAt : max), '');
      if (latest) assertUnchanged(latest, input.expectedUpdatedAt, `${ITEM_TYPE_LABEL[input.itemType]} 라우팅`);

      if (input.steps.length === 0) throw new InputError('공정을 1개 이상 넣어 주세요');
      const errors = new FieldErrors();
      const seen = new Set<ProcessType>();
      const rates: (string | null)[] = input.steps.map((step, index) => {
        const field = `steps.${index}.plannedYieldRate`;
        if (!Object.values(PROCESS_TYPE).includes(step.processType)) {
          errors.add(`steps.${index}.processType`, '공정을 확인해 주세요');
          return null;
        }
        if (seen.has(step.processType)) errors.add(`steps.${index}.processType`, `${PROCESS_TYPE_LABEL[step.processType]} 공정이 두 번 있어요`);
        seen.add(step.processType);
        if (step.processType === 'HOT_ROLLING' && input.itemType === 'SLAB') errors.add(`steps.${index}.processType`, '슬래브 라우팅에는 열연 공정을 넣을 수 없어요');
        // 열연 수율은 규격 매핑에서 계산하고(REQ-MST-005), 제선 수율은 4.4 계산에 쓰지 않는다
        if (step.processType === 'HOT_ROLLING' || step.processType === 'IRONMAKING') return null;
        const rate = decimalText(errors, field, step.plannedYieldRate, { label: '계획 수율', scale: 4, integerDigits: 1, positive: true, max: '1' });
        if (rate === null) errors.add(field, '계획 수율을 입력해 주세요');
        return rate ? formatDecimal(rate, 4) : null;
      });
      errors.throwIfAny('라우팅을 확인해 주세요');

      const keep = new Set(input.steps.map((s) => s.processType));
      for (const row of existing) if (!keep.has(row.processType)) removeRow(tx, 'routing', row.id);
      input.steps.forEach((step, index) => {
        const row = existing.find((r) => r.processType === step.processType);
        const values = { processSeq: index + 1, plannedYieldRate: rates[index] ?? null };
        if (row) updateRow(tx, 'routing', row.id, values);
        else insertRow(tx, 'routing', { itemType: input.itemType, processType: step.processType, ...values });
      });
      return input.steps.length;
    }),

  // ── 배합 원단위 (REQ-MST-006) ──
  listSpecificConsumptions: (): Promise<MasterSpecificConsumptionView[]> =>
    mockQuery((tables) =>
      tables.specificConsumption.flatMap((c) => {
        const item = tables.item.find((i) => i.id === c.itemId);
        if (!item?.rawMaterialType) return [];
        return [{ id: c.id, itemId: c.itemId, steelGradeId: c.steelGradeId, consumptionRate: c.consumptionRate, consumptionUnit: specificConsumptionUnitOf(item.rawMaterialType) }];
      }),
    ),

  /** 바뀐 칸을 한 번에 저장한다 (하나라도 틀리면 아무것도 저장하지 않음). 입력칸 키 = `${itemId}:${steelGradeId ?? 'common'}` */
  saveSpecificConsumptions: (changes: SpecificConsumptionChange[]): Promise<number> =>
    mockMutation((tx) => {
      requireMasterManager(tx.tables);
      const errors = new FieldErrors();
      const valid: { change: SpecificConsumptionChange; rate: string | null }[] = [];
      for (const change of changes) {
        const field = `${change.itemId}:${change.steelGradeId ?? 'common'}`;
        const item = requireRow(tx.tables, 'item', change.itemId, '원료');
        if (item.itemType !== 'RAW_MATERIAL' || !item.rawMaterialType) throw new InputError('원료 품목만 원단위를 넣을 수 있어요');
        if (item.rawMaterialType === 'FERROALLOY') {
          if (change.steelGradeId === null) throw new InputError('합금철 원단위는 강종별로 넣어요');
          requireRow(tx.tables, 'steelGrade', change.steelGradeId, '강종');
        } else if (change.steelGradeId !== null) {
          throw new InputError('철광석·석탄·석회석 원단위는 강종과 상관없는 공통값이에요');
        }
        const unit = specificConsumptionUnitOf(item.rawMaterialType);
        const rate = decimalText(errors, field, change.consumptionRate, { label: `원단위(${unit})`, scale: 3, integerDigits: 9, positive: true });
        if (rate !== undefined) valid.push({ change, rate: rate === null ? null : formatDecimal(rate, 3) });
      }
      errors.throwIfAny('원단위를 확인해 주세요');
      for (const { change, rate } of valid) {
        const row = tx.tables.specificConsumption.find((c) => c.itemId === change.itemId && c.steelGradeId === change.steelGradeId);
        if (rate === null) {
          if (row) removeRow(tx, 'specificConsumption', row.id);
        } else if (row) {
          updateRow(tx, 'specificConsumption', row.id, { consumptionRate: rate });
        } else {
          insertRow(tx, 'specificConsumption', { itemId: change.itemId, steelGradeId: change.steelGradeId, consumptionRate: rate });
        }
      }
      return valid.length;
    }),

  // ── 원료 품목 (REQ-MST-001·007·008) ──
  listRawMaterials: (): Promise<MasterRawMaterialView[]> =>
    mockQuery((tables) =>
      tables.item
        .filter((i): i is ItemRow & { rawMaterialType: RawMaterialType } => i.itemType === 'RAW_MATERIAL' && i.rawMaterialType !== null)
        .map((item) => ({
          id: item.id,
          itemCode: item.itemCode,
          itemName: item.itemName,
          rawMaterialType: item.rawMaterialType,
          unitType: item.unitType,
          defaultYardId: item.defaultYardId,
          defaultYardName: yardNameOf(tables, item.defaultYardId),
          defaultSupplierId: item.defaultSupplierId,
          defaultSupplierName: tables.supplier.find((s) => s.id === item.defaultSupplierId)?.supplierName ?? null,
          referenceText: referenceText(rawMaterialReferencesOf(tables, item.id)),
          updatedAt: item.updatedAt,
        }))
        .sort((a, b) => a.itemCode.localeCompare(b.itemCode)),
    ),

  createRawMaterial: (input: RawMaterialInput): Promise<number> =>
    mockMutation((tx) => {
      requireMasterManager(tx.tables);
      const errors = new FieldErrors();
      const code = requiredText(errors, 'itemCode', input.itemCode.toUpperCase(), '원료 코드', 50);
      if (code && !RAW_MATERIAL_CODE_PATTERN.test(code)) errors.add('itemCode', '원료 코드는 영문 대문자 3자 + 숫자 2자리예요 (예: ORE01)');
      else if (code && tx.tables.item.some((i) => i.itemCode === code)) errors.add('itemCode', `${withIGa(`품목 코드 ${code}`)} 이미 있어요`);
      const name = requiredText(errors, 'itemName', input.itemName, '원료명', 100);
      if (!input.rawMaterialType || !Object.values(RAW_MATERIAL_TYPE).includes(input.rawMaterialType)) errors.add('rawMaterialType', '원료 유형을 선택해 주세요');
      const yardId = readRawMaterialYard(tx.tables, errors, input.defaultYardId);
      const supplierId = input.defaultSupplierId === null ? null : requireRow(tx.tables, 'supplier', input.defaultSupplierId, '공급업체').id;
      errors.throwIfAny();
      if (!code || !name || !input.rawMaterialType || yardId === null) throw new InputError('입력한 내용을 확인해 주세요');
      return insertRow(tx, 'item', {
        itemCode: code,
        itemName: name,
        itemType: 'RAW_MATERIAL',
        unitType: ITEM_TYPE_UNIT_TYPE.RAW_MATERIAL,
        rawMaterialType: input.rawMaterialType,
        steelGradeId: null,
        thicknessMm: null,
        widthMm: null,
        lengthMm: null,
        theoreticalWeightTon: null,
        defaultYardId: yardId,
        defaultSupplierId: supplierId,
      }).id;
    }),

  /** 원료 코드·원료 유형은 만든 뒤 바꾸지 않는다 (LOT 번호 RM-원료코드-…에 쓰임) */
  updateRawMaterial: (input: RawMaterialUpdateInput): Promise<number> =>
    mockMutation((tx) => {
      requireMasterManager(tx.tables);
      const row = requireRow(tx.tables, 'item', input.id, '원료');
      if (row.itemType !== 'RAW_MATERIAL') throw new ApiError('COM-003', '원료');
      assertUnchanged(row.updatedAt, input.expectedUpdatedAt, '원료');
      const errors = new FieldErrors();
      const name = requiredText(errors, 'itemName', input.itemName, '원료명', 100);
      const yardId = readRawMaterialYard(tx.tables, errors, input.defaultYardId);
      const supplierId = input.defaultSupplierId === null ? null : requireRow(tx.tables, 'supplier', input.defaultSupplierId, '공급업체').id;
      errors.throwIfAny();
      if (!name || yardId === null) throw new InputError('입력한 내용을 확인해 주세요');
      updateRow(tx, 'item', row.id, { itemName: name, defaultYardId: yardId, defaultSupplierId: supplierId });
      return row.id;
    }),

  deleteRawMaterial: (id: number): Promise<number> =>
    mockMutation((tx) => {
      requireMasterManager(tx.tables);
      const row = requireRow(tx.tables, 'item', id, '원료');
      if (row.itemType !== 'RAW_MATERIAL') throw new ApiError('COM-003', '원료');
      assertNoReferences(`원료 ${row.itemCode}`, rawMaterialReferencesOf(tx.tables, row.id));
      for (const inventory of tx.tables.inventory.filter((r) => r.itemId === row.id)) removeRow(tx, 'inventory', inventory.id);
      removeRow(tx, 'item', row.id);
      return row.id;
    }),

  // ── 고객사·공급업체 (REQ-MST-007) ──
  listCustomers: (): Promise<MasterCustomerView[]> =>
    mockQuery((tables) =>
      tables.customer
        .map((c) => ({ id: c.id, customerCode: c.customerCode, customerName: c.customerName, referenceText: referenceText(customerReferencesOf(tables, c.id)), updatedAt: c.updatedAt }))
        .sort((a, b) => a.customerCode.localeCompare(b.customerCode)),
    ),

  createCustomer: (input: PartyInput): Promise<number> =>
    mockMutation((tx) => {
      requireMasterManager(tx.tables);
      const errors = new FieldErrors();
      const code = codeText(errors, 'code', input.code, '고객사 코드', 30, CODE_PATTERN, 'CUS-05');
      const name = requiredText(errors, 'name', input.name, '고객사명', 100);
      if (code && tx.tables.customer.some((c) => c.customerCode === code)) errors.add('code', `${withIGa(`고객사 코드 ${code}`)} 이미 있어요`);
      errors.throwIfAny();
      if (!code || !name) throw new InputError('입력한 내용을 확인해 주세요');
      return insertRow(tx, 'customer', { customerCode: code, customerName: name }).id;
    }),

  updateCustomer: (input: PartyUpdateInput): Promise<number> =>
    mockMutation((tx) => {
      requireMasterManager(tx.tables);
      const row = requireRow(tx.tables, 'customer', input.id, '고객사');
      assertUnchanged(row.updatedAt, input.expectedUpdatedAt, '고객사');
      const errors = new FieldErrors();
      const name = requiredText(errors, 'name', input.name, '고객사명', 100);
      errors.throwIfAny();
      if (!name) throw new InputError('입력한 내용을 확인해 주세요');
      updateRow(tx, 'customer', row.id, { customerName: name });
      return row.id;
    }),

  deleteCustomer: (id: number): Promise<number> =>
    mockMutation((tx) => {
      requireMasterManager(tx.tables);
      const row = requireRow(tx.tables, 'customer', id, '고객사');
      assertNoReferences(`고객사 ${row.customerName}`, customerReferencesOf(tx.tables, row.id));
      removeRow(tx, 'customer', row.id);
      return row.id;
    }),

  listSuppliers: (): Promise<MasterSupplierView[]> =>
    mockQuery((tables) =>
      tables.supplier
        .map((s) => ({ id: s.id, supplierCode: s.supplierCode, supplierName: s.supplierName, referenceText: referenceText(supplierReferencesOf(tables, s.id)), updatedAt: s.updatedAt }))
        .sort((a, b) => a.supplierCode.localeCompare(b.supplierCode)),
    ),

  createSupplier: (input: PartyInput): Promise<number> =>
    mockMutation((tx) => {
      requireMasterManager(tx.tables);
      const errors = new FieldErrors();
      const code = codeText(errors, 'code', input.code, '공급업체 코드', 30, CODE_PATTERN, 'SUP-05');
      const name = requiredText(errors, 'name', input.name, '공급업체명', 100);
      if (code && tx.tables.supplier.some((s) => s.supplierCode === code)) errors.add('code', `${withIGa(`공급업체 코드 ${code}`)} 이미 있어요`);
      errors.throwIfAny();
      if (!code || !name) throw new InputError('입력한 내용을 확인해 주세요');
      return insertRow(tx, 'supplier', { supplierCode: code, supplierName: name }).id;
    }),

  updateSupplier: (input: PartyUpdateInput): Promise<number> =>
    mockMutation((tx) => {
      requireMasterManager(tx.tables);
      const row = requireRow(tx.tables, 'supplier', input.id, '공급업체');
      assertUnchanged(row.updatedAt, input.expectedUpdatedAt, '공급업체');
      const errors = new FieldErrors();
      const name = requiredText(errors, 'name', input.name, '공급업체명', 100);
      errors.throwIfAny();
      if (!name) throw new InputError('입력한 내용을 확인해 주세요');
      updateRow(tx, 'supplier', row.id, { supplierName: name });
      return row.id;
    }),

  deleteSupplier: (id: number): Promise<number> =>
    mockMutation((tx) => {
      requireMasterManager(tx.tables);
      const row = requireRow(tx.tables, 'supplier', id, '공급업체');
      assertNoReferences(`공급업체 ${row.supplierName}`, supplierReferencesOf(tx.tables, row.id));
      removeRow(tx, 'supplier', row.id);
      return row.id;
    }),

  // ── 야드 (REQ-MST-008). 야드 안 위치는 관리하지 않는다 ──
  listYards: (): Promise<MasterYardView[]> =>
    mockQuery((tables) =>
      tables.yard
        .map((y) => ({ id: y.id, yardCode: y.yardCode, yardName: y.yardName, yardType: y.yardType, referenceText: referenceText(yardReferencesOf(tables, y.id)), updatedAt: y.updatedAt }))
        .sort((a, b) => a.yardCode.localeCompare(b.yardCode)),
    ),

  createYard: (input: YardInput): Promise<number> =>
    mockMutation((tx) => {
      requireMasterManager(tx.tables);
      const errors = new FieldErrors();
      const code = codeText(errors, 'code', input.code, '야드 코드', 30, CODE_PATTERN, 'YD-CL-02');
      const name = requiredText(errors, 'name', input.name, '야드명', 50);
      if (!input.yardType || !Object.values(YARD_TYPE).includes(input.yardType)) errors.add('yardType', '야드 유형을 선택해 주세요');
      if (code && tx.tables.yard.some((y) => y.yardCode === code)) errors.add('code', `${withIGa(`야드 코드 ${code}`)} 이미 있어요`);
      errors.throwIfAny();
      if (!code || !name || !input.yardType) throw new InputError('입력한 내용을 확인해 주세요');
      return insertRow(tx, 'yard', { yardCode: code, yardName: name, yardType: input.yardType }).id;
    }),

  /** 야드 유형은 만든 뒤 바꾸지 않는다 (품목 기본 야드·LOT가 유형에 맞게 쓰고 있음) */
  updateYard: (input: PartyUpdateInput): Promise<number> =>
    mockMutation((tx) => {
      requireMasterManager(tx.tables);
      const row = requireRow(tx.tables, 'yard', input.id, '야드');
      assertUnchanged(row.updatedAt, input.expectedUpdatedAt, '야드');
      const errors = new FieldErrors();
      const name = requiredText(errors, 'name', input.name, '야드명', 50);
      errors.throwIfAny();
      if (!name) throw new InputError('입력한 내용을 확인해 주세요');
      updateRow(tx, 'yard', row.id, { yardName: name });
      return row.id;
    }),

  deleteYard: (id: number): Promise<number> =>
    mockMutation((tx) => {
      requireMasterManager(tx.tables);
      const row = requireRow(tx.tables, 'yard', id, '야드');
      assertNoReferences(`야드 ${row.yardName}`, yardReferencesOf(tx.tables, row.id));
      removeRow(tx, 'yard', row.id);
      return row.id;
    }),

  // ── 생산 설정값 (REQ-MST-009, 단일 행) ──
  getProductionSetting: (): Promise<MasterProductionSettingView | null> =>
    mockQuery((tables) => {
      const row = tables.productionSetting[0];
      return row ? { id: row.id, heatCapacityTon: row.heatCapacityTon, deliveryRiskDays: row.deliveryRiskDays, updatedAt: row.updatedAt } : null;
    }),

  saveProductionSetting: (input: ProductionSettingInput): Promise<number> =>
    mockMutation((tx) => {
      requireMasterManager(tx.tables);
      const row = tx.tables.productionSetting[0];
      if (row) assertUnchanged(row.updatedAt, input.expectedUpdatedAt, '생산 설정값');
      const errors = new FieldErrors();
      const heat = decimalText(errors, 'heatCapacityTon', input.heatCapacityTon, { label: '히트 용량', scale: 3, integerDigits: 9, positive: true });
      if (heat === null) errors.add('heatCapacityTon', '히트 용량을 입력해 주세요');
      const days = nonNegativeInteger(errors, 'deliveryRiskDays', input.deliveryRiskDays, '납기 위험 기준일');
      errors.throwIfAny();
      if (!heat || days === null) throw new InputError('입력한 내용을 확인해 주세요');
      const values = { heatCapacityTon: formatDecimal(heat, 3), deliveryRiskDays: days };
      if (row) return updateRow(tx, 'productionSetting', row.id, values)?.id ?? row.id;
      return insertRow(tx, 'productionSetting', values).id;
    }),
};

/** 원료의 기본 야드: 꼭 있어야 하고(ERD default_yard_id NN), 원료 야드여야 한다 */
function readRawMaterialYard(tables: Readonly<MockTables>, errors: FieldErrors, yardId: number | null): number | null {
  if (yardId === null) {
    errors.add('defaultYardId', '기본 야드를 선택해 주세요');
    return null;
  }
  const yard = requireRow(tables, 'yard', yardId, '야드');
  if (yard.yardType !== 'RAW_MATERIAL') {
    errors.add('defaultYardId', `${YARD_TYPE_LABEL.RAW_MATERIAL}만 기본 야드로 고를 수 있어요`);
    return null;
  }
  return yard.id;
}
