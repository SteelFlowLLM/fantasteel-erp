import { Injectable } from '@nestjs/common';
import { INSPECTION_RESULT, LOT_TYPE } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';
import { inspectedLotSelect } from './quality.repository';

const rejectedLotSelect = {
  ...inspectedLotSelect,
  dispositionStatus: true,
  dispositionReason: true,
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
  async findRejectedLots(tx: Tx, page: { skip: number; take: number }) {
    const [lots, total] = await Promise.all([
      tx.lot.findMany({
        where: rejectedLotWhere,
        select: rejectedLotSelect,
        orderBy: { id: 'desc' },
        skip: page.skip,
        take: page.take,
      }),
      tx.lot.count({ where: rejectedLotWhere }),
    ]);
    return { lots, total };
  }
}
