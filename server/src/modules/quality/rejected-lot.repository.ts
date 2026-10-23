import { Injectable } from '@nestjs/common';
import { BUSINESS_EVENT_TYPE, INSPECTION_RESULT, LOT_TYPE } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';
import { inspectedLotSelect, inspectionDetailSelect } from './quality.repository';

const rejectedLotSelect = {
  ...inspectedLotSelect,
  dispositionStatus: true,
  dispositionReason: true,
  updatedAt: true,
  qualityInspection: { select: { id: true, inspectionResult: true } },
} satisfies Prisma.LotSelect;

export type RejectedLot = Prisma.LotGetPayload<{ select: typeof rejectedLotSelect }>;

const failed = { qualityInspection: { is: { inspectionResult: INSPECTION_RESULT.FAIL } } } satisfies Prisma.LotWhereInput;
const failedHeat = { lotType: LOT_TYPE.HEAT, ...failed } satisfies Prisma.LotWhereInput;

/**
 * 불합격 LOT (TRM-078): 자기 검사가 FAIL인 히트·슬래브·코일 + 불합격 히트의 하위 슬래브·코일.
 * 계보는 lot_relation으로 찾는다(슬래브 → 히트, 코일 → 슬래브 → 히트). LOT 번호를 파싱하지 않는다 ([ERD])
 */
const rejectedLotWhere = {
  OR: [
    { lotType: { in: [LOT_TYPE.HEAT, LOT_TYPE.SLAB, LOT_TYPE.COIL] }, ...failed },
    { lotType: LOT_TYPE.SLAB, lotRelationsAsChildLot: { some: { parentLot: failedHeat } } },
    {
      lotType: LOT_TYPE.COIL,
      lotRelationsAsChildLot: {
        some: { parentLot: { lotType: LOT_TYPE.SLAB, lotRelationsAsChildLot: { some: { parentLot: failedHeat } } } },
      },
    },
  ],
} satisfies Prisma.LotWhereInput;

@Injectable()
export class RejectedLotRepository {
  /** 불합격 LOT 목록. 최근에 생긴 LOT부터 */
  async findRejectedLots(tx: Tx, page: { skip: number; take: number; lotId?: number }) {
    const where = page.lotId === undefined ? rejectedLotWhere : { AND: [{ id: page.lotId }, rejectedLotWhere] };
    const [lots, total] = await Promise.all([
      tx.lot.findMany({
        where,
        select: rejectedLotSelect,
        orderBy: { id: 'desc' },
        skip: page.skip,
        take: page.take,
      }),
      tx.lot.count({ where }),
    ]);
    return { lots, total };
  }

  /** 근거 검사(항목·측정값·기준) 한 번에 읽기 */
  findInspectionsByLotIds(tx: Tx, lotIds: number[]) {
    if (!lotIds.length) return Promise.resolve([]);
    return tx.qualityInspection.findMany({ where: { lotId: { in: lotIds } }, select: inspectionDetailSelect });
  }

  /** LOT별로 불합격 처리 상태를 마지막으로 지정한 시각 (작업 로그 DISPOSITION_SET의 발생 시각). 지정한 적 없는 LOT은 빠진다 */
  async findDispositionTimes(tx: Tx, lotIds: number[]): Promise<Map<number, Date>> {
    if (!lotIds.length) return new Map();
    const rows = await tx.businessEvent.groupBy({
      by: ['targetId'],
      where: { businessEventType: BUSINESS_EVENT_TYPE.DISPOSITION_SET, targetType: 'lot', targetId: { in: lotIds } },
      _max: { createdAt: true },
    });
    return new Map(rows.flatMap((r) => (r._max.createdAt ? [[r.targetId, r._max.createdAt] as const] : [])));
  }

  lotExists(tx: Tx, lotId: number): Promise<boolean> {
    return tx.lot.count({ where: { id: lotId } }).then((count) => count > 0);
  }

  /** 불합격 LOT 1건 (목록과 같은 조건). 불합격이 아니면 null. 작업 로그에 붙일 수주(LOT → 실적 → 계획 → 수주 품목)도 읽는다 */
  findRejectedLot(tx: Tx, lotId: number) {
    return tx.lot.findFirst({
      where: { AND: [{ id: lotId }, rejectedLotWhere] },
      select: {
        ...rejectedLotSelect,
        productionResult: {
          // inspectedLotSelect의 productionResult를 덮어쓰므로 계획 id·번호도 같이 읽는다
          select: { productionPlan: { select: { id: true, productionPlanNo: true, salesOrderItem: { select: { salesOrderId: true } } } } },
        },
      },
    });
  }

  /** updated_at이 그대로일 때만 처리 상태·사유를 바꾼다(행 잠금 포함). false면 그 사이 다른 수정이 있었다 */
  async updateDispositionIfUnchanged(
    tx: Tx,
    lotId: number,
    expectedUpdatedAt: Date,
    data: { dispositionStatus: string; dispositionReason: string },
  ): Promise<boolean> {
    const { count } = await tx.lot.updateMany({ where: { id: lotId, updatedAt: expectedUpdatedAt }, data });
    return count === 1;
  }
}
