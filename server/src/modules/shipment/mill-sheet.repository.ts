import { Injectable } from '@nestjs/common';
import { LOT_RELATION_TYPE, PDF_STATUS, type PdfStatus } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

const INSPECTIONS = { orderBy: { id: 'desc' }, include: { values: { orderBy: { sortOrder: 'asc' } } } } satisfies Prisma.Lot$qualityInspectionsArgs;

const SNAPSHOT_LOT_INCLUDE = {
  qualityInspections: INSPECTIONS,
  heatLot: { select: { id: true, lotNo: true, qualityInspections: INSPECTIONS } },
  parentRelations: {
    where: { relationType: LOT_RELATION_TYPE.SLAB_TO_COIL },
    select: { parentLot: { select: { lotNo: true, qualityInspections: INSPECTIONS } } },
  },
} satisfies Prisma.LotInclude;
export type SnapshotLotRow = Prisma.LotGetPayload<{ include: typeof SNAPSHOT_LOT_INCLUDE }>;
export type SnapshotInspectionRow = SnapshotLotRow['qualityInspections'][number];

@Injectable()
export class MillSheetRepository {
  /** 스냅샷에 복사할 LOT·히트·검사값 (출고 확정 tx 안에서 한 번만 읽는다). */
  findLotsForSnapshot(tx: Tx, lotIds: number[]) {
    return tx.lot.findMany({ where: { id: { in: lotIds } }, include: SNAPSHOT_LOT_INCLUDE, orderBy: [{ producedAt: 'asc' }, { lotNo: 'asc' }] });
  }

  create(tx: Tx, data: { millSheetNo: string; goodsIssueId: number; salesOrderId: number; customerId: number; issuedAt: Date; snapshot: Prisma.InputJsonValue }) {
    return tx.millSheet.create({ data: { ...data, pdfStatus: PDF_STATUS.PENDING } });
  }

  findById(tx: Tx, id: number) {
    return tx.millSheet.findUnique({ where: { id } });
  }

  findMany(tx: Tx, filter: { customerId?: number; salesOrderId?: number; goodsIssueId?: number; from?: Date; to?: Date; keyword?: string }) {
    const keyword = filter.keyword?.trim();
    const where: Prisma.MillSheetWhereInput = {
      ...(filter.customerId ? { customerId: filter.customerId } : {}),
      ...(filter.salesOrderId ? { salesOrderId: filter.salesOrderId } : {}),
      ...(filter.goodsIssueId ? { goodsIssueId: filter.goodsIssueId } : {}),
      ...(filter.from || filter.to ? { issuedAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) } } : {}),
      ...(keyword ? { millSheetNo: { contains: keyword, mode: 'insensitive' } } : {}),
    };
    return tx.millSheet.findMany({ where, orderBy: { id: 'desc' } });
  }

  updatePdf(tx: Tx, id: number, pdfStatus: PdfStatus, pdfPath?: string | null) {
    return tx.millSheet.update({ where: { id }, data: { pdfStatus, ...(pdfPath !== undefined ? { pdfPath } : {}) } });
  }
}
