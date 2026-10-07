import { Injectable } from '@nestjs/common';
import { ALLOCATION_PURPOSE, ALLOCATION_STATUS, INSPECTION_RESULT, LOT_TYPE } from '@fantasteel/shared';
import { findAllocatableLots } from '../../generated/prisma/sql';
import type { Tx } from '../../prisma/prisma.service';

/** 대시보드는 읽기만 한다. 여러 모듈의 테이블을 단계별로 센다 */
@Injectable()
export class DashboardRepository {
  countPlansByStatus(tx: Tx) {
    return tx.productionPlan.groupBy({ by: ['productionPlanStatus'], _count: { _all: true } });
  }

  /** 판정 대기: 검사 행이 없거나 판정 대기(PENDING)인 히트·슬래브·코일 */
  async countPendingInspectionLots(tx: Tx) {
    const countOf = (lotType: string) =>
      tx.lot.count({
        where: {
          lotType,
          OR: [{ qualityInspection: { is: null } }, { qualityInspection: { is: { inspectionResult: INSPECTION_RESULT.PENDING } } }],
        },
      });
    const [heat, slab, coil] = await Promise.all([countOf(LOT_TYPE.HEAT), countOf(LOT_TYPE.SLAB), countOf(LOT_TYPE.COIL)]);
    return { heat, slab, coil };
  }

  countShipmentRequestsByStatus(tx: Tx) {
    return tx.shipmentRequest.groupBy({ by: ['shipmentRequestStatus'], _count: { _all: true } });
  }

  /** [from, to) 사이에 출고 확정된 출하요청 수와 출고 LOT 수(소진된 출하 배정) */
  async countIssuedBetween(tx: Tx, from: Date, to: Date) {
    const issuedAt = { gte: from, lt: to };
    const [requests, lots] = await Promise.all([
      tx.shipmentRequest.count({ where: { issuedAt } }),
      tx.allocation.count({
        where: { allocationPurpose: ALLOCATION_PURPOSE.SHIPMENT, allocationStatus: ALLOCATION_STATUS.CONSUMED, shipmentRequestItem: { shipmentRequest: { issuedAt } } },
      }),
    ]);
    return { requests, lots };
  }

  /** 미배정 합격 LOT (적격 + AVAILABLE + CONFIRMED 배정 없음, FIFO 순서). 배정 후보와 같은 쿼리를 쓴다 */
  findUnallocatedPassedLots(tx: Tx, itemId: number) {
    return tx.$queryRawTyped(findAllocatableLots(itemId));
  }

  /** 규격의 1매 이론중량 (여재 톤 계산) */
  findItemWeights(tx: Tx, itemIds: number[]) {
    return tx.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, theoreticalWeightTon: true } });
  }

  /** 생산계획의 품목 (계획 수율을 품목별로 고르려고) */
  findPlanItems(tx: Tx, productionPlanIds: number[]) {
    return tx.productionPlan.findMany({ where: { id: { in: productionPlanIds } }, select: { id: true, itemId: true } });
  }

  /** [from, to) 사이에 출고 확정된 출하요청과 그 출고 LOT(소진된 출하 배정)의 유형·1매 이론중량 */
  async findIssuedBetween(tx: Tx, from: Date, to: Date) {
    const issuedAt = { gte: from, lt: to };
    const [requests, allocations] = await Promise.all([
      tx.shipmentRequest.count({ where: { issuedAt } }),
      tx.allocation.findMany({
        where: { allocationPurpose: ALLOCATION_PURPOSE.SHIPMENT, allocationStatus: ALLOCATION_STATUS.CONSUMED, shipmentRequestItem: { shipmentRequest: { issuedAt } } },
        select: {
          lot: { select: { lotType: true, item: { select: { theoreticalWeightTon: true } } } },
          shipmentRequestItem: { select: { shipmentRequest: { select: { issuedAt: true } } } },
        },
      }),
    ]);
    return { requests, allocations };
  }
}
