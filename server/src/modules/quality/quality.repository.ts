import { Injectable } from '@nestjs/common';
import {
  ALLOCATION_PURPOSE,
  ALLOCATION_STATUS,
  INSPECTION_RESULT,
  LOT_TYPE,
  type InspectionResult,
  type LotType,
} from '@fantasteel/shared';
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
export const inspectedLotSelect = {
  id: true,
  lotNo: true,
  lotType: true,
  lotStatus: true,
  producedDate: true,
  productionResult: { select: { productionPlan: { select: { id: true, productionPlanNo: true } } } },
  steelGrade: { select: { id: true, steelGradeCode: true } },
  item: { select: { id: true, itemCode: true, itemName: true, thicknessMm: true, steelGrade: { select: { id: true, steelGradeCode: true } } } },
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
  updatedAt: true,
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

/** 판정에 필요한 기준 항목 컬럼 */
const judgedStandardSelect = {
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
} satisfies Prisma.InspectionStandardSelect;

/** 작업 로그에 붙일 수주 (LOT → 실적 → 계획 → 수주 품목) */
const lotSalesOrderSelect = {
  productionResult: {
    // inspectedLotSelect의 productionResult를 덮어쓰므로 계획 id·번호도 같이 읽는다
    select: { productionPlan: { select: { id: true, productionPlanNo: true, salesOrderItem: { select: { salesOrderId: true } } } } },
  },
} satisfies Prisma.LotSelect;

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
        ...lotSalesOrderSelect,
      },
    });
  }

  /**
   * 측정값 수정 대상 검사: 판정에 쓴 기준 버전(바꾸지 않음)·기존 값·LOT 두께,
   * 밀시트 확인에 쓸 하위 LOT(히트 → 슬래브 → 코일, lot_relation)
   */
  findInspectionForUpdate(tx: Tx, qualityInspectionId: number) {
    return tx.qualityInspection.findUnique({
      where: { id: qualityInspectionId },
      select: {
        id: true,
        inspectionResult: true,
        inspectionStandard: { select: judgedStandardSelect },
        qualityInspectionValues: { select: { inspectionStandardItemId: true, measuredValue: true } },
        lot: {
          select: {
            id: true,
            lotType: true,
            item: { select: { thicknessMm: true } },
            ...lotSalesOrderSelect,
            lotRelationsAsParentLot: {
              select: { childLot: { select: { id: true, lotRelationsAsParentLot: { select: { childLotId: true } } } } },
            },
          },
        },
      },
    });
  }

  /**
   * 이 LOT들이 출고돼 발행된 밀시트 번호. LOT 연결 테이블이 없어
   * allocation(SHIPMENT, CONSUMED) → 출하요청 품목 → (출하요청, 수주)로 밀시트를 찾는다 ([ERD] mill_sheet Note)
   */
  async findIssuedMillSheetNos(tx: Tx, lotIds: number[]): Promise<string[]> {
    const allocations = await tx.allocation.findMany({
      where: {
        lotId: { in: lotIds },
        allocationPurpose: ALLOCATION_PURPOSE.SHIPMENT,
        allocationStatus: ALLOCATION_STATUS.CONSUMED,
      },
      select: { shipmentRequestItem: { select: { shipmentRequestId: true, salesOrderItem: { select: { salesOrderId: true } } } } },
    });
    const keys = allocations.flatMap(({ shipmentRequestItem: item }) =>
      item ? [{ shipmentRequestId: item.shipmentRequestId, salesOrderId: item.salesOrderItem.salesOrderId }] : [],
    );
    if (!keys.length) return [];
    const millSheets = await tx.millSheet.findMany({
      where: { OR: keys },
      select: { millSheetNo: true },
      orderBy: { millSheetNo: 'asc' },
    });
    return millSheets.map((m) => m.millSheetNo);
  }

  /** updated_at이 그대로일 때만 판정을 바꾼다(행 잠금 포함). false면 그 사이 다른 수정이 있었다 */
  async updateInspectionResultIfUnchanged(
    tx: Tx,
    qualityInspectionId: number,
    expectedUpdatedAt: Date,
    inspectionResult: InspectionResult,
  ): Promise<boolean> {
    const { count } = await tx.qualityInspection.updateMany({
      where: { id: qualityInspectionId, updatedAt: expectedUpdatedAt },
      data: { inspectionResult },
    });
    return count === 1;
  }

  /** 보완은 새 값 행, 오타 수정은 같은 값 행을 고친다 ((검사, 항목) unique) */
  async upsertQualityInspectionValues(
    tx: Tx,
    qualityInspectionId: number,
    values: { inspectionStandardItemId: number; measuredValue: Prisma.Decimal }[],
  ): Promise<void> {
    for (const { inspectionStandardItemId, measuredValue } of values) {
      await tx.qualityInspectionValue.upsert({
        where: { qualityInspectionId_inspectionStandardItemId: { qualityInspectionId, inspectionStandardItemId } },
        create: { qualityInspectionId, inspectionStandardItemId, measuredValue },
        update: { measuredValue },
      });
    }
  }

  /** 그 공정·강종의 최신 기준 버전과 항목 (quality.md 4장 "기준 고르기") */
  findLatestInspectionStandard(tx: Tx, processType: string, steelGradeId: number) {
    return tx.inspectionStandard.findFirst({
      where: { processType, steelGradeId },
      orderBy: [{ versionNo: 'desc' }, { id: 'desc' }],
      select: judgedStandardSelect,
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
