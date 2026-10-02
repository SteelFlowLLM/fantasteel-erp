import { Injectable } from '@nestjs/common';
import { INSPECTION_RESULT, LOT_TYPE, type InspectionResult, type LotType } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

export interface QualityInspectionListFilter {
  lotTypes: LotType[];
  /** true = 검사 대기(검사 행 없음 또는 PENDING), false = 판정 끝 */
  isPending: boolean;
  /** 판정 끝 목록에서 거를 판정 */
  inspectionResults: InspectionResult[];
  lotId?: number;
  lotNo?: string;
  skip: number;
  take: number;
}

const inspectionResultSelect = { select: { inspectionResult: true } } as const;

const heatParentSelect = {
  where: { parentLot: { lotType: LOT_TYPE.HEAT } },
  select: { parentLot: { select: { id: true, lotNo: true, qualityInspection: inspectionResultSelect } } },
} as const;

/** 슬래브 → 히트, 코일 → 슬래브 → 히트 (lot_relation, LOT 번호 파싱으로 계보를 만들지 않음 [ERD]) */
const listLotSelect = {
  id: true,
  lotNo: true,
  lotType: true,
  steelGrade: { select: { id: true, steelGradeCode: true } },
  item: { select: { thicknessMm: true, steelGrade: { select: { id: true, steelGradeCode: true } } } },
  qualityInspection: {
    select: {
      id: true,
      inspectionResult: true,
      inspectedAt: true,
      inspectionStandard: { select: { id: true, inspectionStandardCode: true, versionNo: true } },
    },
  },
  lotRelationsAsChildLot: {
    where: { parentLot: { lotType: { in: [LOT_TYPE.HEAT, LOT_TYPE.SLAB] } } },
    select: {
      parentLot: {
        select: {
          id: true,
          lotNo: true,
          lotType: true,
          qualityInspection: inspectionResultSelect,
          lotRelationsAsChildLot: heatParentSelect,
        },
      },
    },
  },
} satisfies Prisma.LotSelect;

export type QualityInspectionListLot = Prisma.LotGetPayload<{ select: typeof listLotSelect }>;

const failedHeat = { lotType: LOT_TYPE.HEAT, qualityInspection: { is: { inspectionResult: INSPECTION_RESULT.FAIL } } };

@Injectable()
export class QualityRepository {
  /** 검사 대기·검사 목록 (API-125). 정렬: 대기는 먼저 생긴 LOT부터, 판정 끝은 최근 검사부터 */
  async findInspectionListLots(tx: Tx, filter: QualityInspectionListFilter) {
    const where = this.buildListWhere(filter);
    const orderBy: Prisma.LotOrderByWithRelationInput[] = filter.isPending
      ? [{ id: 'asc' }]
      : [{ qualityInspection: { inspectedAt: 'desc' } }, { id: 'desc' }];
    const [lots, total] = await Promise.all([
      tx.lot.findMany({ where, select: listLotSelect, orderBy, skip: filter.skip, take: filter.take }),
      tx.lot.count({ where }),
    ]);
    return { lots, total };
  }

  /** 공정·강종별 최신 버전을 고르기 위한 기준 목록. 시드 기준 14개 수준이라 한 번에 읽는다 */
  findInspectionStandardVersions(tx: Tx) {
    return tx.inspectionStandard.findMany({
      select: { id: true, inspectionStandardCode: true, versionNo: true, processType: true, steelGradeId: true },
    });
  }

  private buildListWhere(filter: QualityInspectionListFilter): Prisma.LotWhereInput {
    const conditions: Prisma.LotWhereInput[] = [{ lotType: { in: filter.lotTypes } }];
    if (filter.isPending) {
      conditions.push({
        OR: [
          { qualityInspection: { is: null } },
          { qualityInspection: { is: { inspectionResult: INSPECTION_RESULT.PENDING } } },
        ],
      });
      // 상위 히트가 불합격이면 검사할 필요가 없다 (불합격 히트의 하위 LOT은 이미 불합격, TRM-078)
      conditions.push({
        NOT: {
          lotRelationsAsChildLot: {
            some: {
              parentLot: {
                OR: [failedHeat, { lotType: LOT_TYPE.SLAB, lotRelationsAsChildLot: { some: { parentLot: failedHeat } } }],
              },
            },
          },
        },
      });
    } else {
      conditions.push({ qualityInspection: { is: { inspectionResult: { in: filter.inspectionResults } } } });
    }
    if (filter.lotId !== undefined) conditions.push({ id: filter.lotId });
    if (filter.lotNo) conditions.push({ lotNo: { startsWith: filter.lotNo } });
    return { AND: conditions };
  }
}
