import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
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

const CASE_SELECT = {
  id: true,
  caseNo: true,
  caseCategory: true,
  title: true,
  phenomenon: true,
  cause: true,
  actionTaken: true,
  equipmentText: true,
  occurredDate: true,
  createdAt: true,
  createdEmployee: { select: { employeeName: true } },
  pastCaseLots: { orderBy: { id: 'asc' }, select: { lot: { select: { id: true, lotNo: true } } } },
} as const;

export type PastCaseRow = Prisma.PastCaseGetPayload<{ select: typeof CASE_SELECT }>;

/** 등록 사례(past_case·past_case_lot)와 초안·등록에 쓰는 LOT 조회 */
@Injectable()
export class PastCaseRepository {
  /** 등록 사례 전부 (예시 사례는 shared PAST_CASE_EXAMPLES) */
  findCases(tx: Tx): Promise<PastCaseRow[]> {
    return tx.pastCase.findMany({ select: CASE_SELECT, orderBy: { id: 'asc' } });
  }

  findCase(tx: Tx, id: number): Promise<PastCaseRow | null> {
    return tx.pastCase.findUnique({ where: { id }, select: CASE_SELECT });
  }

  createCase(tx: Tx, data: Omit<Prisma.PastCaseUncheckedCreateInput, 'pastCaseLots'>, lotIds: readonly number[]) {
    return tx.pastCase.create({ data: { ...data, pastCaseLots: { create: lotIds.map((lotId) => ({ lotId })) } }, select: { id: true } });
  }

  updateCaseNo(tx: Tx, id: number, caseNo: string) {
    return tx.pastCase.update({ where: { id }, data: { caseNo }, select: { id: true } });
  }

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
