import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

const include = { rawMaterial: { include: { item: true } }, steelGrade: true } satisfies Prisma.SpecificConsumptionInclude;
export type SpecificConsumptionRow = Prisma.SpecificConsumptionGetPayload<{ include: typeof include }>;

@Injectable()
export class SpecificConsumptionRepository {
  findMany(tx: Tx, where: Prisma.SpecificConsumptionWhereInput): Promise<SpecificConsumptionRow[]> {
    return tx.specificConsumption.findMany({ where, include, orderBy: [{ rawMaterialId: 'asc' }, { steelGradeId: { sort: 'asc', nulls: 'first' } }] });
  }
  findById(tx: Tx, id: number): Promise<SpecificConsumptionRow | null> {
    return tx.specificConsumption.findUnique({ where: { id }, include });
  }
  /** steelGradeId가 null이면 공통값. (원료, 강종) 쌍이 유일하다 — DB unique는 null을 서로 다르게 보므로 앱에서 지킨다. */
  findByKey(tx: Tx, rawMaterialId: number, steelGradeId: number | null) {
    return tx.specificConsumption.findFirst({ where: { rawMaterialId, steelGradeId }, include });
  }
  create(tx: Tx, data: Prisma.SpecificConsumptionUncheckedCreateInput): Promise<SpecificConsumptionRow> {
    return tx.specificConsumption.create({ data, include });
  }
  update(tx: Tx, id: number, consumptionRate: number, consumptionUnit: string): Promise<SpecificConsumptionRow> {
    return tx.specificConsumption.update({ where: { id }, data: { consumptionRate, consumptionUnit }, include });
  }
  delete(tx: Tx, id: number) {
    return tx.specificConsumption.delete({ where: { id } });
  }
}
