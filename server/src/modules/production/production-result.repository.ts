import { Injectable } from '@nestjs/common';
import { ALLOCATION_PURPOSE, ALLOCATION_STATUS, BUSINESS_EVENT_TYPE, LOT_STATUS, LOT_TYPE, type LotRelationEvidence, type LotStatus, type LotType, type ProcessType } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { lockHotMetalLotsForFifo, lockRawMaterialLotsForFifo } from '../../generated/prisma/sql';
import type { Tx } from '../../prisma/prisma.service';

/** 작업 실적 화면 한 줄: 산출 LOT과 그 투입(부모) LOT */
export const resultViewSelect = {
  id: true,
  productionPlanId: true,
  processType: true,
  blastFurnaceCode: true,
  converterCode: true,
  startedAt: true,
  completedAt: true,
  simulatedLossRate: true,
  productionPlan: { select: { productionPlanNo: true } },
  lots: {
    orderBy: { id: 'asc' },
    select: {
      id: true,
      lotNo: true,
      lotType: true,
      initialTon: true,
      item: { select: { itemCode: true, theoreticalWeightTon: true } },
      lotRelationsAsChildLot: {
        orderBy: { id: 'asc' },
        select: { inputTon: true, parentLot: { select: { id: true, lotNo: true, lotType: true, item: { select: { itemCode: true } } } } },
      },
    },
  },
} satisfies Prisma.ProductionResultSelect;
export type ResultViewRow = Prisma.ProductionResultGetPayload<{ select: typeof resultViewSelect }>;

export interface ResultListFilter {
  productionPlanId?: number;
  processType?: ProcessType;
}

/** 작업 실적·LOT·LOT 관계 쓰기 (BP-PRD-02). 함수의 첫 인자는 tx (컨벤션 8장) */
@Injectable()
export class ProductionResultRepository {
  // ── 투입 LOT 잠금 (FIFO) ───────────────────────────────

  lockRawMaterialLots(tx: Tx, itemId: number, receivedUntil: Date) {
    return tx.$queryRawTyped(lockRawMaterialLotsForFifo(itemId, receivedUntil));
  }

  lockHotMetalLots(tx: Tx, producedUntil: Date) {
    return tx.$queryRawTyped(lockHotMetalLotsForFifo(producedUntil));
  }

  /** 원단위: 공통(용선 1t당 t, 합금철 제외)과 강종별 합금철(용강 1t당 kg) */
  findConsumptions(tx: Tx, steelGradeId: number | null) {
    return tx.specificConsumption.findMany({
      where: { OR: [{ steelGradeId: null }, ...(steelGradeId === null ? [] : [{ steelGradeId }])] },
      select: {
        steelGradeId: true,
        consumptionRate: true,
        rawMaterialItem: { select: { id: true, itemCode: true, itemName: true, rawMaterialType: true } },
      },
      orderBy: { rawMaterialItemId: 'asc' },
    });
  }

  async sumRawMaterialRemaining(tx: Tx, itemId: number): Promise<Prisma.Decimal> {
    const r = await tx.lot.aggregate({ where: { itemId, lotType: LOT_TYPE.RAW_MATERIAL, lotStatus: LOT_STATUS.AVAILABLE }, _sum: { remainingTon: true } });
    return r._sum.remainingTon ?? new Prisma.Decimal(0);
  }

  /** 쓸 수 있는 용선 LOT (생산 순) */
  findAvailableHotMetalLots(tx: Tx) {
    return tx.lot.findMany({
      where: { lotType: LOT_TYPE.HOT_METAL, lotStatus: LOT_STATUS.AVAILABLE, remainingTon: { gt: 0 } },
      select: { id: true, lotNo: true, remainingTon: true, productionResult: { select: { completedAt: true } } },
      orderBy: [{ productionResult: { completedAt: 'asc' } }, { lotNo: 'asc' }],
    });
  }

  // ── 실적 ─────────────────────────────────────────────

  createResult(tx: Tx, data: { productionPlanId: number | null; processType: ProcessType; blastFurnaceCode: string | null; converterCode: string | null; startedAt: Date; completedAt: Date | null }) {
    return tx.productionResult.create({ data });
  }

  completeResult(tx: Tx, id: number, data: { completedAt: Date; simulatedLossRate?: string | null }) {
    return tx.productionResult.update({ where: { id }, data });
  }

  findResult(tx: Tx, id: number) {
    return tx.productionResult.findUnique({ where: { id }, select: { id: true, productionPlanId: true, processType: true, blastFurnaceCode: true, converterCode: true, startedAt: true, completedAt: true } });
  }

  /** 작업 중(완료 시각 없음) 실적. 제선은 고로별, 나머지는 계획·공정별로 한 건만 둔다 */
  findOpenResults(tx: Tx, where: { productionPlanId?: number | null; processType?: ProcessType; blastFurnaceCode?: string }) {
    return tx.productionResult.findMany({
      where: { completedAt: null, productionPlanId: where.productionPlanId, processType: where.processType, blastFurnaceCode: where.blastFurnaceCode },
      select: { id: true, processType: true, startedAt: true, blastFurnaceCode: true, converterCode: true, productionPlanId: true },
      orderBy: { id: 'asc' },
    });
  }

  findResults(tx: Tx, filter: ResultListFilter, page?: { skip: number; take: number }) {
    return tx.productionResult.findMany({
      where: { productionPlanId: filter.productionPlanId, processType: filter.processType },
      select: resultViewSelect,
      orderBy: { id: 'desc' },
      skip: page?.skip,
      take: page?.take,
    });
  }

  countResults(tx: Tx, filter: ResultListFilter) {
    return tx.productionResult.count({ where: { productionPlanId: filter.productionPlanId, processType: filter.processType } });
  }

  findResultView(tx: Tx, id: number) {
    return tx.productionResult.findUnique({ where: { id }, select: resultViewSelect });
  }

  /** 실적의 작업 시작·등록 로그: 작업자와 연주 시작 히트를 읽는다 */
  findResultEvents(tx: Tx, resultIds: number[]) {
    if (resultIds.length === 0) return Promise.resolve([]);
    return tx.businessEvent.findMany({
      where: {
        targetType: 'production_result',
        targetId: { in: resultIds },
        businessEventType: { in: [BUSINESS_EVENT_TYPE.PRODUCTION_STARTED, BUSINESS_EVENT_TYPE.PRODUCTION_RESULT_REGISTERED] },
      },
      select: { targetId: true, businessEventType: true, afterData: true, actorEmployee: { select: { employeeName: true } } },
      orderBy: { id: 'asc' },
    });
  }

  /** 마지막으로 쓴 고로·전로 코드 (입력 기본값) */
  async findLastEquipmentCodes(tx: Tx) {
    const [bf, bof] = await Promise.all([
      tx.productionResult.findFirst({ where: { blastFurnaceCode: { not: null } }, orderBy: { id: 'desc' }, select: { blastFurnaceCode: true } }),
      tx.productionResult.findFirst({ where: { converterCode: { not: null } }, orderBy: { id: 'desc' }, select: { converterCode: true } }),
    ]);
    return { blastFurnaceCode: bf?.blastFurnaceCode ?? null, converterCode: bof?.converterCode ?? null };
  }

  // ── LOT ──────────────────────────────────────────────

  createLot(tx: Tx, data: { lotNo: string; lotType: LotType; itemId?: number | null; steelGradeId?: number | null; productionResultId: number; yardId?: number | null; initialTon?: Prisma.Decimal | null; remainingTon?: Prisma.Decimal | null; producedDate?: Date | null }) {
    return tx.lot.create({ data: { ...data, lotStatus: LOT_STATUS.AVAILABLE }, select: { id: true, lotNo: true } });
  }

  updateLot(tx: Tx, id: number, data: { remainingTon?: Prisma.Decimal; lotStatus?: LotStatus }) {
    return tx.lot.update({ where: { id }, data, select: { id: true } });
  }

  createLotRelations(tx: Tx, rows: { parentLotId: number; childLotId: number; lotRelationEvidence: LotRelationEvidence; inputTon?: Prisma.Decimal | null; inputStartedAt?: Date | null; inputEndedAt?: Date | null }[]) {
    return tx.lotRelation.createMany({ data: rows });
  }

  /** 연주할 히트: 만든 실적(계획), 톤, 강종, 이미 연주했는지(자식 수), 판정 */
  findHeat(tx: Tx, lotId: number) {
    return tx.lot.findUnique({
      where: { id: lotId },
      select: {
        id: true,
        lotNo: true,
        lotType: true,
        lotStatus: true,
        initialTon: true,
        steelGradeId: true,
        productionResult: { select: { productionPlanId: true, processType: true } },
        qualityInspection: { select: { inspectionResult: true } },
        _count: { select: { lotRelationsAsParentLot: true } },
      },
    });
  }

  /** 계획의 히트 (제강 실적으로 만든 것) */
  findHeatsOfPlan(tx: Tx, productionPlanId: number) {
    return tx.lot.findMany({
      where: { lotType: LOT_TYPE.HEAT, productionResult: { productionPlanId } },
      select: { id: true, lotNo: true, initialTon: true, qualityInspection: { select: { inspectionResult: true } }, _count: { select: { lotRelationsAsParentLot: true } } },
      orderBy: { id: 'asc' },
    });
  }

  countConfirmedRollingAllocations(tx: Tx, productionPlanId: number) {
    return tx.allocation.count({ where: { productionPlanId, allocationPurpose: ALLOCATION_PURPOSE.HOT_ROLLING, allocationStatus: ALLOCATION_STATUS.CONFIRMED } });
  }

  /** 원료 품목 정보 (부족 안내 문구) */
  findRawMaterialItems(tx: Tx) {
    return tx.item.findMany({ where: { rawMaterialType: { not: null } }, select: { id: true, itemCode: true, itemName: true, rawMaterialType: true } });
  }
}

