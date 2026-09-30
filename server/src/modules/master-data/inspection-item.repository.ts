import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

const include = { steelGrade: true } satisfies Prisma.InspectionItemInclude;
export type InspectionItemRow = Prisma.InspectionItemGetPayload<{ include: typeof include }>;

@Injectable()
export class InspectionItemRepository {
  findMany(tx: Tx, where: Prisma.InspectionItemWhereInput): Promise<InspectionItemRow[]> {
    return tx.inspectionItem.findMany({ where, include, orderBy: [{ processCode: 'asc' }, { steelGradeId: { sort: 'asc', nulls: 'first' } }, { sortOrder: 'asc' }, { id: 'asc' }] });
  }
  findById(tx: Tx, id: number): Promise<InspectionItemRow | null> {
    return tx.inspectionItem.findUnique({ where: { id }, include });
  }
  /** (공정, 강종, 항목 코드)가 유일하다 — DB unique는 강종 null을 서로 다르게 보므로 앱에서 지킨다. */
  findByKey(tx: Tx, processCode: string, steelGradeId: number | null, inspectionItemCode: string) {
    return tx.inspectionItem.findFirst({ where: { processCode, steelGradeId, inspectionItemCode } });
  }
  create(tx: Tx, data: Prisma.InspectionItemUncheckedCreateInput): Promise<InspectionItemRow> {
    return tx.inspectionItem.create({ data, include });
  }
  update(tx: Tx, id: number, data: Prisma.InspectionItemUncheckedUpdateInput): Promise<InspectionItemRow> {
    return tx.inspectionItem.update({ where: { id }, data, include });
  }
  delete(tx: Tx, id: number) {
    return tx.inspectionItem.delete({ where: { id } });
  }
}
