import { Injectable } from '@nestjs/common';
import { ALLOCATION_STATUS } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';
import { findLotEligibility, traceLotBackward, traceLotForward } from '../../generated/prisma/sql';
import type { Tx } from '../../prisma/prisma.service';

const lotSelect = {
  id: true,
  lotNo: true,
  lotType: true,
  lotStatus: true,
  itemId: true,
  steelGradeId: true,
  productionResultId: true,
  goodsReceiptId: true,
  producedDate: true,
  initialTon: true,
  remainingTon: true,
  dispositionStatus: true,
  dispositionReason: true,
  item: { select: { itemCode: true, itemName: true, rawMaterialType: true, steelGradeId: true } },
  yard: { select: { yardName: true } },
} satisfies Prisma.LotSelect;

type LotBase = Prisma.LotGetPayload<{ select: typeof lotSelect }>;

/** LOT 한 건과 표시용 이름들. 중첩 select를 깊게 쓰지 않고 강종·실적·검사는 따로 읽어 붙인다 */
export interface LotRow extends LotBase {
  /** 히트는 LOT의 강종, 슬래브·코일은 규격의 강종 */
  steelGrade: { steelGradeCode: string; steelGradeName: string } | null;
  blastFurnaceCode: string | null;
  converterCode: string | null;
  inspectionResult: string | null;
}

/**
 * lot·lot_relation·allocation 등은 읽기만 한다 (docs/backend/lot.md). 쓰기 함수는 두지 않는다.
 * Prisma 7은 중첩 select를 여러 행에 걸쳐 깊게 읽으면 "Expected zero or one element"로 실패해서, 한 단계씩 따로 읽는다.
 */
@Injectable()
export class LotRepository {
  /** 번호·유형·상태·규격 조건에 맞는 LOT id를 생산완료일 최근 순 → LOT 번호 순으로 */
  findLotIds(tx: Tx, where: Prisma.LotWhereInput, skip: number, take: number) {
    return tx.lot.findMany({
      where,
      orderBy: [{ producedDate: { sort: 'desc', nulls: 'last' } }, { lotNo: 'asc' }],
      skip,
      take,
      select: { id: true },
    });
  }

  countLots(tx: Tx, where: Prisma.LotWhereInput) {
    return tx.lot.count({ where });
  }

  /** 주어진 id의 LOT을 읽어 id 순서를 그대로 돌려준다. 없는 id는 건너뛴다 */
  async findLotRows(tx: Tx, lotIds: number[]): Promise<LotRow[]> {
    if (lotIds.length === 0) return [];
    const lots = await tx.lot.findMany({ where: { id: { in: lotIds } }, select: lotSelect });
    const gradeIds = [...new Set(lots.flatMap((l) => [l.steelGradeId, l.item?.steelGradeId]).filter((id): id is number => id != null))];
    const resultIds = [...new Set(lots.map((l) => l.productionResultId).filter((id): id is number => id != null))];
    const [grades, results, inspections] = await Promise.all([
      tx.steelGrade.findMany({ where: { id: { in: gradeIds } }, select: { id: true, steelGradeCode: true, steelGradeName: true } }),
      tx.productionResult.findMany({ where: { id: { in: resultIds } }, select: { id: true, blastFurnaceCode: true, converterCode: true } }),
      tx.qualityInspection.findMany({ where: { lotId: { in: lotIds } }, select: { lotId: true, inspectionResult: true } }),
    ]);
    const gradeById = new Map(grades.map((g) => [g.id, g]));
    const resultById = new Map(results.map((r) => [r.id, r]));
    const inspectionByLot = new Map(inspections.map((q) => [q.lotId, q.inspectionResult]));
    const rowById = new Map(
      lots.map((lot) => {
        const grade = gradeById.get(lot.steelGradeId ?? lot.item?.steelGradeId ?? -1) ?? null;
        const result = lot.productionResultId === null ? undefined : resultById.get(lot.productionResultId);
        const row: LotRow = {
          ...lot,
          steelGrade: grade ? { steelGradeCode: grade.steelGradeCode, steelGradeName: grade.steelGradeName } : null,
          blastFurnaceCode: result?.blastFurnaceCode ?? null,
          converterCode: result?.converterCode ?? null,
          inspectionResult: inspectionByLot.get(lot.id) ?? null,
        };
        return [lot.id, row] as const;
      }),
    );
    return lotIds.flatMap((id) => rowById.get(id) ?? []);
  }

  findGoodsReceiptNo(tx: Tx, goodsReceiptId: number) {
    return tx.goodsReceipt.findUnique({ where: { id: goodsReceiptId }, select: { goodsReceiptNo: true } });
  }

  findInspection(tx: Tx, lotId: number) {
    return tx.qualityInspection.findUnique({
      where: { lotId },
      select: {
        inspectionResult: true,
        inspectedAt: true,
        inspectorEmployee: { select: { employeeName: true } },
        inspectionStandard: { select: { inspectionStandardCode: true, versionNo: true, processType: true } },
        qualityInspectionValues: {
          orderBy: { inspectionStandardItemId: 'asc' },
          select: { measuredValue: true, inspectionStandardItem: { select: { inspectionItemCode: true, inspectionItemName: true, unit: true, minValue: true, maxValue: true } } },
        },
      },
    });
  }

  /** 적격 여부(자기 검사 PASS + 상위 히트 PASS). 슬래브·코일만 의미가 있다 */
  async findEligibility(tx: Tx, lotId: number): Promise<boolean> {
    return (await tx.$queryRawTyped(findLotEligibility(lotId)))[0]?.is_eligible ?? false;
  }

  /** 시작 LOT과 그 조상(역) 또는 자손(정)의 id와 거리. 순환은 SQL이 막는다 */
  async walkRelations(tx: Tx, lotId: number, direction: 'backward' | 'forward'): Promise<{ lotId: number; depth: number }[]> {
    const rows = await tx.$queryRawTyped(direction === 'backward' ? traceLotBackward(lotId) : traceLotForward(lotId));
    return rows.map((r) => ({ lotId: r.lot_id ?? lotId, depth: r.depth ?? 0 }));
  }

  /** 주어진 LOT들 사이의 연결만 (한쪽이라도 범위 밖이면 뺀다) */
  findRelationsAmong(tx: Tx, lotIds: number[]) {
    return tx.lotRelation.findMany({
      where: { parentLotId: { in: lotIds }, childLotId: { in: lotIds } },
      orderBy: { id: 'asc' },
      select: { id: true, parentLotId: true, childLotId: true, lotRelationEvidence: true, inputTon: true, inputStartedAt: true, inputEndedAt: true },
    });
  }

  /** 이 LOT의 바로 위(부모)·아래(자식) 연결 */
  findDirectRelations(tx: Tx, lotId: number) {
    return tx.lotRelation.findMany({
      where: { OR: [{ parentLotId: lotId }, { childLotId: lotId }] },
      orderBy: { id: 'asc' },
      select: { id: true, parentLotId: true, childLotId: true, lotRelationEvidence: true, inputTon: true, inputStartedAt: true, inputEndedAt: true },
    });
  }

  findLotLabels(tx: Tx, lotIds: number[]) {
    return tx.lot.findMany({ where: { id: { in: lotIds } }, select: { id: true, lotNo: true, lotType: true } });
  }

  /** 해제되지 않은 배정 */
  findLiveAllocations(tx: Tx, lotIds: number[], purpose?: string) {
    return tx.allocation.findMany({
      where: { lotId: { in: lotIds }, allocationStatus: { not: ALLOCATION_STATUS.RELEASED }, ...(purpose ? { allocationPurpose: purpose } : {}) },
      orderBy: { id: 'asc' },
      select: { id: true, lotId: true, allocationPurpose: true, allocationStatus: true, shipmentRequestItemId: true, productionPlanId: true },
    });
  }

  findShipmentRequestItems(tx: Tx, ids: number[]) {
    return tx.shipmentRequestItem.findMany({ where: { id: { in: ids } }, select: { id: true, shipmentRequestId: true, salesOrderItemId: true } });
  }

  findShipmentRequests(tx: Tx, ids: number[]) {
    return tx.shipmentRequest.findMany({
      where: { id: { in: ids } },
      select: { id: true, shipmentRequestNo: true, shipmentRequestStatus: true, issuedAt: true, customerId: true },
    });
  }

  findCustomers(tx: Tx, ids: number[]) {
    return tx.customer.findMany({ where: { id: { in: ids } }, select: { id: true, customerName: true } });
  }

  findSalesOrderItems(tx: Tx, ids: number[]) {
    return tx.salesOrderItem.findMany({ where: { id: { in: ids } }, select: { id: true, salesOrderId: true, dueDate: true } });
  }

  findSalesOrders(tx: Tx, ids: number[]) {
    return tx.salesOrder.findMany({ where: { id: { in: ids } }, select: { id: true, salesOrderNo: true } });
  }

  findMillSheets(tx: Tx, shipmentRequestIds: number[]) {
    return tx.millSheet.findMany({
      where: { shipmentRequestId: { in: shipmentRequestIds } },
      orderBy: { id: 'asc' },
      select: { id: true, millSheetNo: true, shipmentRequestId: true, salesOrderId: true },
    });
  }

  findProductionPlans(tx: Tx, ids: number[]) {
    return tx.productionPlan.findMany({ where: { id: { in: ids } }, select: { id: true, productionPlanNo: true } });
  }
}
