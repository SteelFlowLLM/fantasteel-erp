import { Injectable } from '@nestjs/common';
import type { Tx } from '../../prisma/prisma.service';

const INSPECTION_SELECT = {
  inspectionResult: true,
  inspectedAt: true,
  inspectionStandard: { select: { processType: true } },
  qualityInspectionValues: {
    select: {
      measuredValue: true,
      inspectionStandardItem: { select: { inspectionItemCode: true, inspectionItemName: true, unit: true, minValue: true, maxValue: true } },
    },
  },
} as const;

const LOT_SELECT = {
  id: true,
  lotNo: true,
  lotType: true,
  dispositionStatus: true,
  dispositionReason: true,
  steelGrade: { select: { steelGradeCode: true } },
  item: { select: { itemCode: true, steelGrade: { select: { steelGradeCode: true } } } },
  qualityInspection: { select: INSPECTION_SELECT },
} as const;

/** 과거 사례 초안·등록에 쓰는 LOT 조회 (조회만) */
@Injectable()
export class PastCaseRepository {
  findLot(tx: Tx, lotId: number) {
    return tx.lot.findUnique({ where: { id: lotId }, select: LOT_SELECT });
  }

  /** 바로 위 투입 LOT (코일 → 슬래브 → 히트를 한 단계씩 올라간다) */
  findParentLots(tx: Tx, lotId: number) {
    return tx.lotRelation.findMany({ where: { childLotId: lotId }, select: { parentLot: { select: LOT_SELECT } } });
  }

  findLotNos(tx: Tx, lotIds: readonly number[]) {
    return tx.lot.findMany({ where: { id: { in: [...lotIds] } }, select: { id: true, lotNo: true } });
  }
}
