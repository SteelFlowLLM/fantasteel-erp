// 재고 조회 (REQ-INV-001·003·007·008, 업무 프로세스 4.2·4.3, PLAN 7장 재고). 조회 전용이다.
// 계산(재고·합격·예약·가용재고·여재)은 핵심 서비스 `@/mock/services`의 재고 조회를 그대로 쓰고,
// 여기서는 화면에 필요한 기준정보(치수·기본 야드·단위·톤)만 덧붙인다.
// 재고 화면은 로그인한 모든 사원이 본다(screens.ts EVERYONE) → 조회마다 요청 사원만 확인한다(없거나 사용 안 함이면 COM-002).
import { PRODUCT_QTY_UNIT, type LotStatus, type LotType } from '@/codes';
import { requireActor } from '@/api/actor';
import { mockQuery } from '@/api/client';
import { calcWeightTon } from '@/lib/weight';
import type { MockTables } from '@/mock/schema';
import {
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

/** LOT 목록 한 줄 (+ 생산계획 id: 생산계획 화면 링크용) */
export interface LotListView extends LotListRow {
  productionPlanId: number | null;
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
export interface ProductInventoryView extends ProductInventoryRow {
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

/** 여재 규격 한 줄 */
export interface SurplusSpecView extends Omit<SurplusSpecRow, 'lots'> {
  unitWeightTon: string;
  /** 미배정 합격 슬래브 톤 */
  unallocatedPassedTon: string;
  /** 가용재고(여재 포함) 톤 */
  surplusTon: string;
  lots: (SurplusSpecRow['lots'][number] & { yardName: string | null; productionPlanId: number | null })[];
}

const itemOf = (tables: Tables, itemId: number) => tables.item.find((i) => i.id === itemId);
const yardNameOf = (tables: Tables, yardId: number | null | undefined) =>
  yardId === null || yardId === undefined ? null : (tables.yard.find((y) => y.id === yardId)?.yardName ?? null);

/** 제품(슬래브·코일) 규격별 재고 — 재고 매수·합격·판정 대기·불합격·예약·열연 배정·가용재고(4.2)·톤 */
export function readProductInventory(tables: Tables): ProductInventoryView[] {
  return productInventory(tables).map((row) => {
    const item = itemOf(tables, row.itemId);
    return {
      ...row,
      thicknessMm: item?.thicknessMm ?? null,
      widthMm: item?.widthMm ?? null,
      lengthMm: item?.lengthMm ?? null,
      defaultYardName: yardNameOf(tables, item?.defaultYardId),
      qtyUnit: PRODUCT_QTY_UNIT[row.itemType],
      reservedTon: calcWeightTon(row.reservedQty, row.unitWeightTon),
    };
  });
}

/** 모든 LOT (유형·규격·생산완료일·품질 결과·배정 여부·야드·상태). 정렬은 생산완료일 최근 순 → LOT 번호 */
export function readLotList(tables: Tables, filter: LotListFilter = {}): LotListView[] {
  return lotList(tables, filter).map((row) => ({
    ...row,
    productionPlanId: tables.lot.find((l) => l.id === row.lotId)?.productionPlanId ?? null,
  }));
}

/** 원료별 LOT 잔량 합계 + 입고예정, LOT 목록 */
export function readRawMaterialInventory(tables: Tables): RawMaterialInventoryView[] {
  return rawMaterialInventory(tables).map((row) => ({
    ...row,
    defaultYardName: yardNameOf(tables, itemOf(tables, row.itemId)?.defaultYardId),
    availableLotCount: row.lots.filter((l) => l.lotStatus === 'AVAILABLE').length,
  }));
}

/** 여재 = 미배정 합격 슬래브 (REQ-INV-008). 가용재고에 포함한다. */
export function readSurplusSlabs(tables: Tables): SurplusSpecView[] {
  return surplusSlabs(tables).map((row) => {
    const unitWeightTon = itemOf(tables, row.itemId)?.theoreticalWeightTon ?? '0.000';
    return {
      ...row,
      unitWeightTon,
      unallocatedPassedTon: calcWeightTon(row.unallocatedPassedQty, unitWeightTon),
      surplusTon: calcWeightTon(row.surplusQty, unitWeightTon),
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
