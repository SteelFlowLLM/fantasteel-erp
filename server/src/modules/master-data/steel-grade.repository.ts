import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

const include = { compositionSpecs: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } } satisfies Prisma.SteelGradeInclude;
export type SteelGradeRow = Prisma.SteelGradeGetPayload<{ include: typeof include }>;

@Injectable()
export class SteelGradeRepository {
  findMany(tx: Tx, where: Prisma.SteelGradeWhereInput): Promise<SteelGradeRow[]> {
    return tx.steelGrade.findMany({ where, include, orderBy: { id: 'asc' } });
  }
  findById(tx: Tx, id: number): Promise<SteelGradeRow | null> {
    return tx.steelGrade.findUnique({ where: { id }, include });
  }
  findByCode(tx: Tx, steelGradeCode: string) {
    return tx.steelGrade.findUnique({ where: { steelGradeCode } });
  }
  create(tx: Tx, data: Prisma.SteelGradeCreateInput): Promise<SteelGradeRow> {
    return tx.steelGrade.create({ data, include });
  }
  update(tx: Tx, id: number, data: Prisma.SteelGradeUpdateInput): Promise<SteelGradeRow> {
    return tx.steelGrade.update({ where: { id }, data, include });
  }
  delete(tx: Tx, id: number) {
    return tx.steelGrade.delete({ where: { id } });
  }
  deleteCompositionSpecs(tx: Tx, steelGradeId: number, elementCodes?: string[]) {
    return tx.compositionSpec.deleteMany({ where: { steelGradeId, ...(elementCodes ? { elementCode: { in: elementCodes } } : {}) } });
  }
  upsertCompositionSpec(tx: Tx, steelGradeId: number, data: { elementCode: string; minValue: number | null; maxValue: number | null; sortOrder: number }) {
    return tx.compositionSpec.upsert({
      where: { steelGradeId_elementCode: { steelGradeId, elementCode: data.elementCode } },
      create: { steelGradeId, ...data },
      update: { minValue: data.minValue, maxValue: data.maxValue, sortOrder: data.sortOrder },
    });
  }
  /** 삭제 전에 이 강종을 참조하는 데이터 건수 */
  async referenceCounts(tx: Tx, steelGradeId: number) {
    const [productSpecs, lots, productionPlans, inspectionItems, specificConsumptions] = await Promise.all([
      tx.productSpec.count({ where: { steelGradeId } }),
      tx.lot.count({ where: { steelGradeId } }),
      tx.productionPlan.count({ where: { steelGradeId } }),
      tx.inspectionItem.count({ where: { steelGradeId } }),
      tx.specificConsumption.count({ where: { steelGradeId } }),
    ]);
    return { productSpecs, lots, productionPlans, inspectionItems, specificConsumptions };
  }
}
