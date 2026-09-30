import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

/** 검사·불합격 화면에 필요한 LOT 주변 정보. */
export const inspectionLotInclude = {
  steelGrade: { select: { id: true, steelGradeCode: true } },
  productSpec: { select: { id: true, specCode: true, theoreticalWeightTon: true } },
  heatLot: { select: { id: true, lotNo: true, isPassed: true } },
  productionPlan: { select: { id: true, productionPlanNo: true, salesOrderItemId: true, salesOrderItem: { include: { salesOrder: { include: { customer: true } } } } } },
  salesOrderItem: { include: { salesOrder: { include: { customer: true } } } },
} satisfies Prisma.LotInclude;
export type InspectionLotRow = Prisma.LotGetPayload<{ include: typeof inspectionLotInclude }>;

export const inspectionInclude = {
  values: { orderBy: { sortOrder: 'asc' } },
  lot: { include: inspectionLotInclude },
} satisfies Prisma.QualityInspectionInclude;
export type InspectionRow = Prisma.QualityInspectionGetPayload<{ include: typeof inspectionInclude }>;

const INSPECTED_TYPES = ['HEAT', 'SLAB', 'COIL'];

@Injectable()
export class QualityRepository {
  findLot(tx: Tx, id: number): Promise<InspectionLotRow | null> {
    return tx.lot.findUnique({ where: { id }, include: inspectionLotInclude });
  }

  /** 검사 대기 LOT: 아직 판정 전이고, 상위 히트가 불합격이 아닌 히트·슬래브·코일. */
  pendingLots(tx: Tx, filter: { lotType?: string; lotId?: number }): Promise<InspectionLotRow[]> {
    return tx.lot.findMany({
      where: {
        id: filter.lotId,
        isPassed: null,
        OR: [
          { lotType: 'HEAT' },
          // 상위 히트가 합격이거나 아직 미판정인 것 (SQL의 NULL 비교 때문에 NOT … = false 로 쓰면 미판정 히트가 빠진다)
          { lotType: { in: ['SLAB', 'COIL'] }, lotStatus: 'IN_STOCK', heatLot: { OR: [{ isPassed: true }, { isPassed: null }] } },
        ],
        ...(filter.lotType ? { lotType: filter.lotType } : {}),
      },
      include: inspectionLotInclude,
      orderBy: [{ producedAt: 'asc' }, { lotNo: 'asc' }],
    });
  }

  compositionSpecs(tx: Tx, steelGradeId: number) {
    return tx.compositionSpec.findMany({ where: { steelGradeId }, orderBy: { sortOrder: 'asc' } });
  }

  /** 공정의 검사 항목: 강종 전용 + 모든 강종 공통(steel_grade_id = null). */
  inspectionItems(tx: Tx, processCode: string, steelGradeId: number | null) {
    return tx.inspectionItem.findMany({
      where: { processCode, OR: [{ steelGradeId: null }, ...(steelGradeId ? [{ steelGradeId }] : [])] },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
  }

  findInspectionOfLot(tx: Tx, lotId: number, processCode: string) {
    return tx.qualityInspection.findFirst({ where: { lotId, processCode } });
  }

  createInspection(tx: Tx, data: Prisma.QualityInspectionUncheckedCreateInput, values: Omit<Prisma.QualityInspectionValueCreateManyInput, 'qualityInspectionId'>[]) {
    return tx.qualityInspection.create({ data: { ...data, values: { create: values } } });
  }

  findInspection(tx: Tx, id: number): Promise<InspectionRow | null> {
    return tx.qualityInspection.findUnique({ where: { id }, include: inspectionInclude });
  }

  listInspections(tx: Tx, filter: { processCode?: string; lotId?: number }): Promise<InspectionRow[]> {
    return tx.qualityInspection.findMany({
      where: { processCode: filter.processCode, lotId: filter.lotId, inspectionResult: { in: ['PASS', 'FAIL'] } },
      include: inspectionInclude,
      orderBy: [{ inspectedAt: 'desc' }, { id: 'desc' }],
      take: 300,
    });
  }

  setLotJudgment(tx: Tx, lotId: number, isPassed: boolean) {
    return tx.lot.update({ where: { id: lotId }, data: { isPassed } });
  }

  heatChildren(tx: Tx, heatLotId: number) {
    return tx.lot.findMany({ where: { heatLotId, lotType: { in: ['SLAB', 'COIL'] } }, select: { id: true, lotNo: true } });
  }

  confirmedAllocationsOfLots(tx: Tx, lotIds: number[]) {
    return tx.allocation.findMany({ where: { lotId: { in: lotIds }, status: 'CONFIRMED' }, include: { lot: { select: { lotNo: true } } } });
  }

  employeeNames(tx: Tx, ids: number[]) {
    return tx.employee.findMany({ where: { id: { in: ids } }, select: { id: true, employeeName: true } });
  }

  // ───────────── 불합격 LOT ─────────────
  /** 불합격 LOT + 불합격 히트의 하위 LOT. */
  rejectedLots(tx: Tx) {
    return tx.lot.findMany({
      where: { lotType: { in: INSPECTED_TYPES }, OR: [{ isPassed: false }, { heatLot: { isPassed: false } }] },
      include: {
        ...inspectionLotInclude,
        qualityInspections: { include: { values: { where: { isPassed: false }, orderBy: { sortOrder: 'asc' } } }, orderBy: { id: 'desc' } },
      },
      orderBy: [{ producedAt: 'desc' }, { lotNo: 'asc' }],
    });
  }

  failedInspectionOfLot(tx: Tx, lotId: number) {
    return tx.qualityInspection.findFirst({ where: { lotId, inspectionResult: 'FAIL' }, include: { values: { where: { isPassed: false }, orderBy: { sortOrder: 'asc' } } }, orderBy: { id: 'desc' } });
  }

  salesOrderItems(tx: Tx, ids: number[]) {
    return tx.salesOrderItem.findMany({ where: { id: { in: ids } }, include: { salesOrder: { include: { customer: true } } } });
  }

  salesOrderItemsWithSpec(tx: Tx, ids: number[]) {
    return tx.salesOrderItem.findMany({ where: { id: { in: ids } }, include: { productSpec: { include: { item: true } } } });
  }

  /** 코일 수주 품목의 열연 투입용으로 귀속된 적격 슬래브 수. */
  countEarmarkedSlabs(tx: Tx, coilSalesOrderItemId: number): Promise<number> {
    return tx.lot.count({ where: { salesOrderItemId: coilSalesOrderItemId, lotType: 'SLAB', lotStatus: 'IN_STOCK', isPassed: true, heatLot: { isPassed: true } } });
  }

  reproductionPlans(tx: Tx, salesOrderItemIds: number[]) {
    return tx.productionPlan.findMany({
      where: { salesOrderItemId: { in: salesOrderItemIds }, isReproduction: true, productionPlanStatus: { not: 'CANCELLED' } },
      select: { id: true, productionPlanNo: true, productionPlanStatus: true, salesOrderItemId: true, shortageQty: true },
      orderBy: { id: 'desc' },
    });
  }

  setDisposition(tx: Tx, lotId: number, data: { dispositionStatus: string; dispositionReason: string; dispositionAt: Date }) {
    return tx.lot.update({ where: { id: lotId }, data });
  }
}
