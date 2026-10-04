import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

export interface InspectionStandardFilter {
  processType?: string;
  steelGradeId?: number;
}

const standardWithItemsSelect = {
  id: true,
  inspectionStandardCode: true,
  versionNo: true,
  processType: true,
  createdAt: true,
  steelGrade: { select: { id: true, steelGradeCode: true } },
  // ERD에 표시 순서 컬럼이 없어 등록 순서(id)로 보여 준다
  inspectionStandardItems: {
    orderBy: { id: 'asc' },
    select: {
      id: true,
      inspectionItemCode: true,
      inspectionItemName: true,
      unit: true,
      minValue: true,
      maxValue: true,
      thicknessOverMm: true,
      thicknessUptoMm: true,
      isRequired: true,
    },
  },
} satisfies Prisma.InspectionStandardSelect;

export type InspectionStandardWithItems = Prisma.InspectionStandardGetPayload<{ select: typeof standardWithItemsSelect }>;

@Injectable()
export class InspectionStandardRepository {
  /** 최신 버전을 고르고 정렬하기 위한 기준 버전 목록 (항목 제외). 시드 기준 14개 수준이라 한 번에 읽는다 */
  findStandardVersions(tx: Tx, filter: InspectionStandardFilter) {
    return tx.inspectionStandard.findMany({
      where: { processType: filter.processType, steelGradeId: filter.steelGradeId },
      select: {
        id: true,
        inspectionStandardCode: true,
        versionNo: true,
        processType: true,
        steelGradeId: true,
        steelGrade: { select: { steelGradeCode: true } },
      },
    });
  }

  /** 기준 버전 1건과 항목 (API-120). 옛 버전도 읽는다 */
  findStandardWithItems(tx: Tx, inspectionStandardId: number) {
    return tx.inspectionStandard.findUnique({ where: { id: inspectionStandardId }, select: standardWithItemsSelect });
  }

  findSteelGrade(tx: Tx, steelGradeId: number) {
    return tx.steelGrade.findUnique({ where: { id: steelGradeId }, select: { id: true, steelGradeCode: true } });
  }

  /** 그 공정·강종에 이미 있는 기준(버전 무관) */
  findStandardByProcessAndSteelGrade(tx: Tx, processType: string, steelGradeId: number) {
    return tx.inspectionStandard.findFirst({
      where: { processType, steelGradeId },
      select: { id: true, inspectionStandardCode: true },
    });
  }

  /** 기준 버전과 항목을 함께 만든다 */
  createStandardWithItems(
    tx: Tx,
    data: Omit<Prisma.InspectionStandardUncheckedCreateInput, 'inspectionStandardItems'>,
    items: Omit<Prisma.InspectionStandardItemUncheckedCreateInput, 'inspectionStandardId'>[],
  ) {
    return tx.inspectionStandard.create({
      data: { ...data, inspectionStandardItems: { create: items } },
      select: { id: true },
    });
  }

  /** 기준 버전과 항목 (한 페이지 분) */
  findStandardsWithItems(tx: Tx, inspectionStandardIds: number[]) {
    return tx.inspectionStandard.findMany({
      where: { id: { in: inspectionStandardIds } },
      select: standardWithItemsSelect,
    });
  }
}
