// 재고 조회 (REQ-INV-001·003·006·007·008, 업무 프로세스 4.2·4.3, PLAN 7장 재고). 조회 전용이다.
// 계산(재고·합격·예약·가용재고·미배정 합격·여재)은 핵심 서비스 `@/mock/services`의 재고 조회를 그대로 쓰고,
// 여기서는 화면에 필요한 기준정보(치수·기본 야드·단위·톤)와 배정 여부·검사 결과 표시 기준(`features/inventory/lib/inventoryRules`)을 덧붙인다.
// 재고 화면은 로그인한 모든 사원이 본다(screens.ts EVERYONE) → 조회마다 요청 사원만 확인한다(없거나 사용 안 함이면 COM-002).
import { PRODUCT_QTY_UNIT, type AllocationPurpose, type LotStatus, type LotType } from '@/codes';
import { requireActor } from '@/api/actor';
import { mockQuery } from '@/api/client';
import { currentAllocationOf, heatInspectionResult, productInspectionResult, type LotInspectionResult } from '@/features/inventory/lib/inventoryRules';
import { calcWeightTon } from '@/lib/weight';
import type { AllocationRow, MockTables } from '@/mock/schema';
import {
  heatOf,
  lotList,
  productInventory,
  rawMaterialInventory,
  surplusSlabs,
  type LotListRow,
  type ProductInventoryRow,
  type RawMaterialInventoryRow,
  type SurplusSpecRow,
} from '@/mock/services';

type Tables = Readonly<MockTables>;

/** LOT 목록 한 줄. core의 `quality`는 적격(예약·배정 가능) 여부 그대로 두고, 검사 결과·배정 여부·여재를 따로 준다. */
export interface LotListView extends Omit<LotListRow, 'allocationPurpose'> {
  /** 생산계획 화면 링크용 */
  productionPlanId: number | null;
  /** 검사 결과 (투입 소진·출고된 LOT도 그대로). 원료·용선은 null */
  inspectionResult: LotInspectionResult | null;
  /** 배정 여부: 해제되지 않은 마지막 배정의 목적 (없으면 null) */
  allocationPurpose: AllocationPurpose | null;
  /** 그 배정의 상태: 배정 확정 · 소진(출고 확정·열연 투입) */
  allocationStatus: 'CONFIRMED' | 'CONSUMED' | null;
  /** 여재 (여재 탭과 같은 기준) */
  isSurplus: boolean;
}

export interface LotListFilter {
  lotType?: LotType;
  lotStatus?: LotStatus;
  itemId?: number;
}

export const inventoryKeys = {
  all: ['inventories'] as const,
  products: () => [...inventoryKeys.all, 'products'] as const,
  lots: (filter: LotListFilter = {}) => [...inventoryKeys.all, 'lots', filter] as const,
  rawMaterials: () => [...inventoryKeys.all, 'raw-materials'] as const,
  surplus: () => [...inventoryKeys.all, 'surplus'] as const,
};

/** 제품 재고 한 줄 (규격별) */
export interface ProductInventoryView extends Omit<ProductInventoryRow, 'unitWeightTon'> {
  /** 1매 이론중량 (TRM-022, item.theoretical_weight_ton) */
  theoreticalWeightTon: string;
  thicknessMm: string | null;
  widthMm: string | null;
  lengthMm: string | null;
  /** 규격 기본 야드 (LOT 생성 때 자동 지정되는 곳) */
  defaultYardName: string | null;
  /** 매 · 개 */
  qtyUnit: string;
  /** 예약 매수 × 1매 이론중량 */
  reservedTon: string;
}

/** 원료 재고 한 줄 (원료별) */
export interface RawMaterialInventoryView extends RawMaterialInventoryRow {
  defaultYardName: string | null;
  /** 잔량이 남은(재고) 원료 LOT 수 */
  availableLotCount: number;
}

/** 여재 슬래브 한 줄 */
export type SurplusLotView = SurplusSpecRow['lots'][number] & { yardName: string | null; productionPlanId: number | null };

/** 여재 규격 한 줄 (미배정 합격 슬래브가 있는 슬래브 규격) */
export interface SurplusSpecView {
  itemId: number;
  itemCode: string;
  itemName: string;
  steelGradeCode: string | null;
  /** 1매 이론중량 (TRM-022) */
  theoreticalWeightTon: string;
  /** 미배정 합격 슬래브 (적격 + CONFIRMED 배정 없음). 수주 예약 몫·코일 계획의 열연 대기 슬래브도 들어 있다 */
  unallocatedPassedQty: number;
  unallocatedPassedTon: string;
  /** 이 규격에 걸린 ACTIVE 예약 */
  reservedQty: number;
  /** 가용재고 (TRM-055, 4.2 = 합격 − 예약 − 열연 배정) */
  availableQty: number;
  availableTon: string;
  /** 여재 매수 (TRM-048): 여재 전환된 미배정 합격 슬래브 중 수주 예약에 쓰이지 않은 몫. 가용재고 이하 */
  surplusQty: number;
  surplusTon: string;
  /** 여재 슬래브 (선입선출 순, surplusQty개) */
  lots: SurplusLotView[];
}

const itemOf = (tables: Tables, itemId: number) => tables.item.find((i) => i.id === itemId);
const yardNameOf = (tables: Tables, yardId: number | null | undefined) =>
  yardId === null || yardId === undefined ? null : (tables.yard.find((y) => y.id === yardId)?.yardName ?? null);

/** 제품(슬래브·코일) 규격별 재고 — 재고 매수·합격·판정 대기·불합격·예약·열연 배정·가용재고(4.2)·톤 */
export function readProductInventory(tables: Tables): ProductInventoryView[] {
  return productInventory(tables).map(({ unitWeightTon, ...row }) => {
    const item = itemOf(tables, row.itemId);
    return {
      ...row,
      theoreticalWeightTon: unitWeightTon,
      thicknessMm: item?.thicknessMm ?? null,
      widthMm: item?.widthMm ?? null,
      lengthMm: item?.lengthMm ?? null,
      defaultYardName: yardNameOf(tables, item?.defaultYardId),
      qtyUnit: PRODUCT_QTY_UNIT[row.itemType],
      reservedTon: calcWeightTon(row.reservedQty, unitWeightTon),
    };
  });
}

/** 모든 LOT (유형·규격·생산완료일·검사 결과·배정 여부·야드·상태). 정렬은 생산완료일 최근 순 → LOT 번호 */
export function readLotList(tables: Tables, filter: LotListFilter = {}): LotListView[] {
  const lotById = new Map(tables.lot.map((l) => [l.id, l]));
  const allocationsByLot = new Map<number, AllocationRow[]>();
  for (const a of tables.allocation) allocationsByLot.set(a.lotId, [...(allocationsByLot.get(a.lotId) ?? []), a]);
  const surplusLotIds = new Set(readSurplusSlabs(tables).flatMap((s) => s.lots.map((l) => l.lotId)));
  return lotList(tables, filter).map((row) => {
    const lot = lotById.get(row.lotId);
    const isProduct = row.lotType === 'SLAB' || row.lotType === 'COIL';
    const allocation = isProduct ? currentAllocationOf(allocationsByLot.get(row.lotId) ?? []) : null;
    const inspectionResult =
      !lot ? null : isProduct ? productInspectionResult(lot, heatOf(tables, lot)) : row.lotType === 'HEAT' ? heatInspectionResult(lot.isPassed) : null;
    return {
      ...row,
      productionPlanId: lot?.productionPlanId ?? null,
      inspectionResult,
      allocationPurpose: allocation?.allocationPurpose ?? null,
      allocationStatus: allocation && allocation.allocationStatus !== 'RELEASED' ? allocation.allocationStatus : null,
      isSurplus: surplusLotIds.has(row.lotId),
    };
  });
}

/** 원료별 LOT 잔량 합계 + 입고예정, LOT 목록 */
export function readRawMaterialInventory(tables: Tables): RawMaterialInventoryView[] {
  return rawMaterialInventory(tables).map((row) => ({
    ...row,
    defaultYardName: yardNameOf(tables, itemOf(tables, row.itemId)?.defaultYardId),
    availableLotCount: row.lots.filter((l) => l.lotStatus === 'AVAILABLE').length,
  }));
}

/**
 * 여재 (TRM-048 "수주에 쓰이지 않고 남은 미배정 합격 슬래브", REQ-INV-008). 가용재고에 포함한다.
 * 여재 매수·여재 슬래브는 core `surplusSlabs`(여재 전환된 미배정 합격 슬래브 중 수주 예약에 쓰이지 않은 몫) 그대로다.
 * 대시보드 여재 위젯도 같은 core 결과를 쓴다. 여기서는 1매 이론중량·톤·야드·생산계획 id만 덧붙인다.
 */
export function readSurplusSlabs(tables: Tables): SurplusSpecView[] {
  return surplusSlabs(tables).map((row) => {
    const theoreticalWeightTon = itemOf(tables, row.itemId)?.theoreticalWeightTon ?? '0.000';
    return {
      itemId: row.itemId,
      itemCode: row.itemCode,
      itemName: row.itemName,
      steelGradeCode: row.steelGradeCode,
      theoreticalWeightTon,
      unallocatedPassedQty: row.unallocatedPassedQty,
      unallocatedPassedTon: calcWeightTon(row.unallocatedPassedQty, theoreticalWeightTon),
      reservedQty: row.reservedQty,
      availableQty: row.availableQty,
      availableTon: calcWeightTon(row.availableQty, theoreticalWeightTon),
      surplusQty: row.surplusQty,
      surplusTon: calcWeightTon(row.surplusQty, theoreticalWeightTon),
      lots: row.lots.map((lot) => {
        const source = tables.lot.find((l) => l.id === lot.lotId);
        return { ...lot, yardName: yardNameOf(tables, source?.yardId), productionPlanId: source?.productionPlanId ?? null };
      }),
    };
  });
}

export const inventoryApi = {
  listProducts: () =>
    mockQuery((tables) => {
      requireActor(tables);
      return readProductInventory(tables);
    }),
  listLots: (filter: LotListFilter = {}) =>
    mockQuery((tables) => {
      requireActor(tables);
      return readLotList(tables, filter);
    }),
  listRawMaterials: () =>
    mockQuery((tables) => {
      requireActor(tables);
      return readRawMaterialInventory(tables);
    }),
  listSurplus: () =>
    mockQuery((tables) => {
      requireActor(tables);
      return readSurplusSlabs(tables);
    }),
};
