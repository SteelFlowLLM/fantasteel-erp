import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';
import { escapeLike } from './like-pattern';

const SALES_ORDER_ITEM_INCLUDE = { salesOrder: { include: { customer: true } } } satisfies Prisma.SalesOrderItemInclude;

/** 목록·상세 공통. 검사는 가장 최근 1건과 항목별 합격 여부만 가져온다. */
export const LOT_VIEW_INCLUDE = {
  rawMaterial: { include: { item: true } },
  productSpec: true,
  steelGrade: true,
  heatLot: { select: { id: true, lotNo: true, isPassed: true } },
  yard: true,
  supplier: true,
  salesOrderItem: { include: SALES_ORDER_ITEM_INCLUDE },
  qualityInspections: { orderBy: { id: 'desc' }, take: 1, include: { values: { select: { isPassed: true } } } },
  allocations: {
    where: { status: 'CONFIRMED' },
    take: 1,
    include: { salesOrderItem: { include: { salesOrder: true } }, productionPlan: true, shipmentRequestItem: { include: { shipmentRequest: true } } },
  },
} satisfies Prisma.LotInclude;
export type LotViewRow = Prisma.LotGetPayload<{ include: typeof LOT_VIEW_INCLUDE }>;

/** 추적 노드용. 출고·배정·수주 연결까지 한 번에 가져온다. */
export const LOT_TRACE_INCLUDE = {
  rawMaterial: { include: { item: true } },
  productSpec: true,
  steelGrade: true,
  heatLot: { select: { id: true, lotNo: true, isPassed: true } },
  salesOrderItem: { include: SALES_ORDER_ITEM_INCLUDE },
  qualityInspections: { orderBy: { id: 'desc' }, take: 1, include: { values: { select: { isPassed: true } } } },
  allocations: {
    where: { status: { in: ['CONFIRMED', 'CONSUMED'] }, salesOrderItemId: { not: null } },
    include: { salesOrderItem: { include: SALES_ORDER_ITEM_INCLUDE } },
  },
  goodsIssueItems: {
    include: {
      goodsIssue: true,
      shipmentRequestItem: { include: { shipmentRequest: { include: { customer: true } }, salesOrderItem: { include: SALES_ORDER_ITEM_INCLUDE } } },
    },
  },
} satisfies Prisma.LotInclude;
export type LotTraceRow = Prisma.LotGetPayload<{ include: typeof LOT_TRACE_INCLUDE }>;

const LIST_ORDER: Prisma.LotOrderByWithRelationInput[] = [{ producedAt: 'desc' }, { id: 'desc' }];

@Injectable()
export class LotRepository {
  list(db: Tx, where: Prisma.LotWhereInput, take: number): Promise<LotViewRow[]> {
    return db.lot.findMany({ where, include: LOT_VIEW_INCLUDE, orderBy: LIST_ORDER, take });
  }

  count(db: Tx, where: Prisma.LotWhereInput): Promise<number> {
    return db.lot.count({ where });
  }

  findById(db: Tx, id: number): Promise<LotViewRow | null> {
    return db.lot.findUnique({ where: { id }, include: LOT_VIEW_INCLUDE });
  }

  findByNo(db: Tx, lotNo: string): Promise<LotViewRow | null> {
    return db.lot.findUnique({ where: { lotNo }, include: LOT_VIEW_INCLUDE });
  }

  /** 번호 일부 검색. 정확히 일치하는 것을 앞에 두려고 따로 가져온다. */
  async searchByNo(db: Tx, q: string, take: number) {
    const select = { id: true, lotNo: true, lotType: true, lotStatus: true, isPassed: true } satisfies Prisma.LotSelect;
    const [exact, partial] = await Promise.all([
      db.lot.findMany({ where: { lotNo: { equals: escapeLike(q), mode: 'insensitive' } }, select, take }),
      db.lot.findMany({ where: { lotNo: { contains: escapeLike(q), mode: 'insensitive' } }, select, orderBy: [{ producedAt: 'desc' }, { id: 'desc' }], take }),
    ]);
    const seen = new Set<number>();
    return [...exact, ...partial].filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true))).slice(0, take);
  }

  /** 상세용: 이 LOT의 모든 검사와 측정값 */
  inspectionsOfLot(db: Tx, lotId: number) {
    return db.qualityInspection.findMany({ where: { lotId }, orderBy: { id: 'desc' }, include: { values: { orderBy: { sortOrder: 'asc' } } } });
  }

  employeeNames(db: Tx, ids: number[]) {
    return db.employee.findMany({ where: { id: { in: ids } }, select: { id: true, employeeName: true } });
  }

  /** 부모·자식 LOT 목록 (상세용) */
  relationsOfLot(db: Tx, lotId: number) {
    const lotSelect = { id: true, lotNo: true, lotType: true } satisfies Prisma.LotSelect;
    return Promise.all([
      db.lotRelation.findMany({ where: { childLotId: lotId }, include: { parentLot: { select: lotSelect } }, orderBy: { id: 'asc' } }),
      db.lotRelation.findMany({ where: { parentLotId: lotId }, include: { childLot: { select: lotSelect } }, orderBy: { id: 'asc' } }),
    ]);
  }

  // ───────────── LOT 관계 (lot_relation) ─────────────

  relationsByChildIds(db: Tx, childIds: number[]) {
    return db.lotRelation.findMany({ where: { childLotId: { in: childIds } }, orderBy: { id: 'asc' } });
  }

  relationsByParentIds(db: Tx, parentIds: number[]) {
    return db.lotRelation.findMany({ where: { parentLotId: { in: parentIds } }, orderBy: { id: 'asc' } });
  }

  lotsForTrace(db: Tx, ids: number[]): Promise<LotTraceRow[]> {
    return db.lot.findMany({ where: { id: { in: ids } }, include: LOT_TRACE_INCLUDE });
  }

  millSheets(db: Tx, goodsIssueIds: number[]) {
    return db.millSheet.findMany({ where: { goodsIssueId: { in: goodsIssueIds } }, select: { id: true, millSheetNo: true, goodsIssueId: true, salesOrderId: true }, orderBy: { id: 'asc' } });
  }
}
