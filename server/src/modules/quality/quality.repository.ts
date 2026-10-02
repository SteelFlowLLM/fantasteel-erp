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
const inspectedLotSelect = {
  id: true,
  lotNo: true,
  lotType: true,
  steelGrade: { select: { id: true, steelGradeCode: true } },
  item: { select: { thicknessMm: true, steelGrade: { select: { id: true, steelGradeCode: true } } } },
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

const listLotSelect = {
  ...inspectedLotSelect,
  qualityInspection: {
    select: {
      id: true,
      inspectionResult: true,
      inspectedAt: true,
      inspectionStandard: { select: { id: true, inspectionStandardCode: true, versionNo: true } },
    },
  },
} satisfies Prisma.LotSelect;

const inspectionDetailSelect = {
  id: true,
  inspectionResult: true,
  inspectedAt: true,
  inspectorEmployee: { select: { id: true, employeeName: true } },
  inspectionStandard: {
    select: {
      id: true,
      inspectionStandardCode: true,
      versionNo: true,
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
    },
  },
  qualityInspectionValues: { select: { inspectionStandardItemId: true, measuredValue: true } },
  lot: { select: inspectedLotSelect },
} satisfies Prisma.QualityInspectionSelect;

export type InspectedLot = Prisma.LotGetPayload<{ select: typeof inspectedLotSelect }>;
export type QualityInspectionListLot = Prisma.LotGetPayload<{ select: typeof listLotSelect }>;
export type QualityInspectionDetailRecord = Prisma.QualityInspectionGetPayload<{ select: typeof inspectionDetailSelect }>;

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

  /** 검사 상세 (API-116): 검사 1건 + 판정에 쓴 기준 버전의 항목 + 측정값 + LOT */
  findInspectionDetail(tx: Tx, qualityInspectionId: number) {
    return tx.qualityInspection.findUnique({ where: { id: qualityInspectionId }, select: inspectionDetailSelect });
  }

  /** 검사 등록 대상 LOT: 공정·강종·두께·이미 있는 검사, 작업 로그에 붙일 수주(LOT → 실적 → 계획 → 수주 품목) */
  findLotForRegistration(tx: Tx, lotId: number) {
    return tx.lot.findUnique({
      where: { id: lotId },
      select: {
        ...inspectedLotSelect,
        qualityInspection: { select: { id: true } },
        productionResult: {
          select: { productionPlan: { select: { salesOrderItem: { select: { salesOrderId: true } } } } },
        },
      },
    });
  }

  /** 그 공정·강종의 최신 기준 버전과 항목 (quality.md 4장 "기준 고르기") */
  findLatestInspectionStandard(tx: Tx, processType: string, steelGradeId: number) {
    return tx.inspectionStandard.findFirst({
      where: { processType, steelGradeId },
      orderBy: [{ versionNo: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        inspectionStandardCode: true,
        versionNo: true,
        inspectionStandardItems: {
          orderBy: { id: 'asc' },
          select: {
            id: true,
            inspectionItemCode: true,
            minValue: true,
            maxValue: true,
            thicknessOverMm: true,
            thicknessUptoMm: true,
            isRequired: true,
          },
        },
      },
    });
  }

  createQualityInspection(tx: Tx, data: Prisma.QualityInspectionUncheckedCreateInput) {
    return tx.qualityInspection.create({ data, select: { id: true } });
  }

  createQualityInspectionValues(tx: Tx, data: Prisma.QualityInspectionValueCreateManyInput[]) {
    return tx.qualityInspectionValue.createMany({ data });
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
