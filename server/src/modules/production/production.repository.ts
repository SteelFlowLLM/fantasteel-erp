import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

const specInclude = { item: true, steelGrade: true } satisfies Prisma.ProductSpecInclude;

export const planInclude = {
  productSpec: { include: { ...specInclude, coilMapping: { include: { slabSpec: { include: specInclude } } } } },
  steelGrade: true,
  salesOrderItem: { include: { salesOrder: { include: { customer: true, ownerEmployee: { select: { id: true, employeeName: true } } } } } },
  productionResults: { orderBy: [{ id: 'asc' }] },
} satisfies Prisma.ProductionPlanInclude;
export type PlanRow = Prisma.ProductionPlanGetPayload<{ include: typeof planInclude }>;

export const lotInclude = {
  heatLot: { select: { id: true, lotNo: true, isPassed: true } },
  productSpec: { select: { id: true, specCode: true, theoreticalWeightTon: true } },
  allocations: { where: { status: 'CONFIRMED' }, select: { id: true, purpose: true, productionPlanId: true } },
} satisfies Prisma.LotInclude;
export type LotRow = Prisma.LotGetPayload<{ include: typeof lotInclude }>;

export const resultInclude = {
  productionPlan: { select: { id: true, productionPlanNo: true, productionPlanStatus: true } },
  lots: { select: { id: true, lotNo: true, lotType: true, isPassed: true }, orderBy: { lotNo: 'asc' } },
} satisfies Prisma.ProductionResultInclude;
export type ResultRow = Prisma.ProductionResultGetPayload<{ include: typeof resultInclude }>;

export interface PlanFilter { status?: string; itemType?: string; needsAction?: boolean }
export interface ResultFilter { planId?: number; processCode?: string; status?: string }

/** 적격(자기 검사 + 상위 히트 합격) · 미소진 슬래브 조건. */
const eligibleSlab = { lotType: 'SLAB', lotStatus: 'IN_STOCK', isPassed: true, heatLot: { isPassed: true } } satisfies Prisma.LotWhereInput;
const fifo = [{ producedAt: 'asc' as const }, { lotNo: 'asc' as const }];

@Injectable()
export class ProductionRepository {
  // ───────────── 생산계획 ─────────────
  listPlans(tx: Tx, filter: PlanFilter): Promise<PlanRow[]> {
    const open = { in: ['READY', 'STARTED'] };
    return tx.productionPlan.findMany({
      where: {
        productionPlanStatus: filter.status,
        productSpec: filter.itemType ? { item: { itemType: filter.itemType } } : undefined,
        ...(filter.needsAction === true
          ? { OR: [{ productionPlanStatus: 'PLANNED' }, { productionPlanStatus: { in: ['CONFIRMED', 'IN_PROGRESS'] }, productionResults: { some: { productionResultStatus: open } } }] }
          : {}),
        ...(filter.needsAction === false
          ? { NOT: { OR: [{ productionPlanStatus: 'PLANNED' }, { productionPlanStatus: { in: ['CONFIRMED', 'IN_PROGRESS'] }, productionResults: { some: { productionResultStatus: open } } }] } }
          : {}),
      },
      include: planInclude,
      orderBy: { id: 'desc' },
    });
  }

  findPlan(tx: Tx, id: number): Promise<PlanRow | null> {
    return tx.productionPlan.findUnique({ where: { id }, include: planInclude });
  }

  updatePlan(tx: Tx, id: number, data: Prisma.ProductionPlanUncheckedUpdateInput) {
    return tx.productionPlan.update({ where: { id }, data });
  }

  openPlansOfItem(tx: Tx, salesOrderItemId: number): Promise<PlanRow[]> {
    return tx.productionPlan.findMany({
      where: { salesOrderItemId, productionPlanStatus: { in: ['PLANNED', 'CONFIRMED', 'IN_PROGRESS'] } },
      include: planInclude,
      orderBy: { id: 'asc' },
    });
  }

  findSalesOrderItem(tx: Tx, id: number) {
    return tx.salesOrderItem.findUnique({
      where: { id },
      include: { salesOrder: { include: { customer: true } }, productSpec: { include: { ...specInclude, coilMapping: { include: { slabSpec: { include: specInclude } } } } } },
    });
  }

  // ───────────── 실적 ─────────────
  createResults(tx: Tx, rows: Prisma.ProductionResultCreateManyInput[]) {
    return tx.productionResult.createMany({ data: rows });
  }

  createResult(tx: Tx, data: Prisma.ProductionResultUncheckedCreateInput) {
    return tx.productionResult.create({ data });
  }

  listResults(tx: Tx, filter: ResultFilter): Promise<ResultRow[]> {
    return tx.productionResult.findMany({
      where: { productionPlanId: filter.planId, processCode: filter.processCode, productionResultStatus: filter.status },
      include: resultInclude,
      orderBy: [{ productionPlanId: 'desc' }, { id: 'asc' }],
    });
  }

  findResult(tx: Tx, id: number): Promise<ResultRow | null> {
    return tx.productionResult.findUnique({ where: { id }, include: resultInclude });
  }

  updateResult(tx: Tx, id: number, data: Prisma.ProductionResultUncheckedUpdateInput) {
    return tx.productionResult.update({ where: { id }, data });
  }

  /** 계획 완료 시 한 번도 시작하지 않은 열연 대기 행을 정리한다. */
  deleteReadyRollingResults(tx: Tx, productionPlanId: number) {
    return tx.productionResult.deleteMany({ where: { productionPlanId, processCode: 'HOT_ROLLING', productionResultStatus: 'READY' } });
  }

  // ───────────── LOT ─────────────
  createLot(tx: Tx, data: Prisma.LotUncheckedCreateInput) {
    return tx.lot.create({ data });
  }

  updateLot(tx: Tx, id: number, data: Prisma.LotUncheckedUpdateInput) {
    return tx.lot.update({ where: { id }, data });
  }

  createRelations(tx: Tx, rows: Prisma.LotRelationCreateManyInput[]) {
    return tx.lotRelation.createMany({ data: rows });
  }

  /** 이 계획이 만든 LOT (용선·히트·슬래브·코일). */
  planLots(tx: Tx, productionPlanId: number): Promise<LotRow[]> {
    return tx.lot.findMany({ where: { productionPlanId }, include: lotInclude, orderBy: [{ producedAt: 'asc' }, { lotNo: 'asc' }] });
  }

  countPlanCoils(tx: Tx, productionPlanId: number): Promise<number> {
    return tx.lot.count({ where: { productionPlanId, lotType: 'COIL' } });
  }

  /** 계획의 용선 LOT 중 잔량이 남은 것 (생산 순). */
  planHotMetalLots(tx: Tx, productionPlanId: number) {
    return tx.lot.findMany({ where: { productionPlanId, lotType: 'HOT_METAL', lotStatus: 'IN_STOCK', remainingTon: { gt: 0 } }, orderBy: [{ producedAt: 'asc' }, { id: 'asc' }] });
  }

  /** 제강 실적이 만든 히트 LOT. */
  heatLotOfResult(tx: Tx, productionResultId: number) {
    return tx.lot.findFirst({ where: { productionResultId, lotType: 'HEAT' } });
  }

  /** 원료 LOT 입고일 FIFO (잔량이 남은 것). */
  rawLotsFifo(tx: Tx, rawMaterialId: number) {
    return tx.lot.findMany({ where: { rawMaterialId, lotType: 'RAW_MATERIAL', lotStatus: 'IN_STOCK', remainingTon: { gt: 0 } }, orderBy: [{ producedAt: 'asc' }, { id: 'asc' }] });
  }

  /** 코일 수주 품목의 열연 투입용으로 귀속된 적격 슬래브. */
  earmarkedSlabs(tx: Tx, coilSalesOrderItemId: number): Promise<LotRow[]> {
    return tx.lot.findMany({ where: { ...eligibleSlab, salesOrderItemId: coilSalesOrderItemId }, include: lotInclude, orderBy: fifo });
  }

  /**
   * 재고 풀에 있는 미배정 적격 슬래브 (여재 후보, FIFO). StockService.recommendLots의 풀 조건과 같게 맞춘다:
   * 살아 있는 코일 수주 품목에 귀속된 슬래브만 뺀다.
   */
  async poolSlabs(tx: Tx, slabSpecId: number): Promise<LotRow[]> {
    const lots = await tx.lot.findMany({
      where: { ...eligibleSlab, productSpecId: slabSpecId, allocations: { none: { status: 'CONFIRMED' } } },
      include: { ...lotInclude, salesOrderItem: { include: { productSpec: { include: { item: true } } } } },
      orderBy: fifo,
    });
    return lots.filter((l) => !(l.salesOrderItem && l.salesOrderItem.salesOrderItemStatus !== 'CANCELLED' && l.salesOrderItem.productSpec.item.itemType === 'COIL'));
  }

  findInventoryBySpec(tx: Tx, productSpecId: number) {
    return tx.inventory.findUnique({ where: { productSpecId } });
  }

  // ───────────── 배정 (조회만. 변경은 StockService) ─────────────
  rollingAllocations(tx: Tx, productionPlanId: number, status?: string) {
    return tx.allocation.findMany({
      where: { productionPlanId, purpose: 'ROLLING', status },
      include: { lot: { include: { productSpec: { include: { slabMapping: { include: { coilSpec: true } } } }, heatLot: { select: { id: true, lotNo: true, isPassed: true } } } } },
      orderBy: [{ lot: { producedAt: 'asc' } }, { lot: { lotNo: 'asc' } }],
    });
  }

  countConfirmedRollingAllocations(tx: Tx, productionPlanId: number): Promise<number> {
    return tx.allocation.count({ where: { productionPlanId, purpose: 'ROLLING', status: 'CONFIRMED' } });
  }

  // ───────────── 원료·원단위 ─────────────
  /** 제선 원단위 (용선 1t당 t, 강종 공통). */
  ironmakingRates(tx: Tx) {
    return tx.specificConsumption.findMany({
      where: { consumptionUnit: 'TON_PER_TON', steelGradeId: null },
      include: { rawMaterial: { include: { item: true } } },
      orderBy: { rawMaterialId: 'asc' },
    });
  }

  /** 강종의 합금철 원단위 (용강 1t당 kg). */
  alloyRates(tx: Tx, steelGradeId: number) {
    return tx.specificConsumption.findMany({
      where: { consumptionUnit: 'KG_PER_TON', steelGradeId },
      include: { rawMaterial: { include: { item: true } } },
      orderBy: { rawMaterialId: 'asc' },
    });
  }

  /** 원료 재고(톤) 차감. ProductionMaterialService.consumeRaw 전용 (StockService 우회, 사유는 그쪽 주석). */
  decrementRawInventoryTon(tx: Tx, rawMaterialId: number, ton: Prisma.Decimal) {
    return tx.inventory.update({ where: { rawMaterialId }, data: { onHandTon: { decrement: ton } } });
  }

  rawMaterials(tx: Tx) {
    return tx.rawMaterial.findMany({ include: { item: true, inventories: true }, orderBy: { id: 'asc' } });
  }

  async rawRemainingTon(tx: Tx, rawMaterialId: number): Promise<Prisma.Decimal> {
    const agg = await tx.lot.aggregate({ where: { rawMaterialId, lotType: 'RAW_MATERIAL', lotStatus: 'IN_STOCK' }, _sum: { remainingTon: true } });
    return agg._sum.remainingTon ?? new Prisma.Decimal(0);
  }
}
