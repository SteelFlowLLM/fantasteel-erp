import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

const specInclude = { item: true, steelGrade: true } satisfies Prisma.ProductSpecInclude;
const include = { slabSpec: { include: specInclude }, coilSpec: { include: specInclude } } satisfies Prisma.SpecMappingInclude;
export type SpecMappingRow = Prisma.SpecMappingGetPayload<{ include: typeof include }>;

@Injectable()
export class SpecMappingRepository {
  findMany(tx: Tx, where: Prisma.SpecMappingWhereInput): Promise<SpecMappingRow[]> {
    return tx.specMapping.findMany({ where, include, orderBy: { id: 'asc' } });
  }
  findById(tx: Tx, id: number): Promise<SpecMappingRow | null> {
    return tx.specMapping.findUnique({ where: { id }, include });
  }
  findBySlab(tx: Tx, slabSpecId: number) {
    return tx.specMapping.findUnique({ where: { slabSpecId }, include: { coilSpec: true } });
  }
  findByCoil(tx: Tx, coilSpecId: number) {
    return tx.specMapping.findUnique({ where: { coilSpecId }, include: { slabSpec: true } });
  }
  findSpec(tx: Tx, id: number) {
    return tx.productSpec.findUnique({ where: { id }, include: { item: true } });
  }
  create(tx: Tx, slabSpecId: number, coilSpecId: number): Promise<SpecMappingRow> {
    return tx.specMapping.create({ data: { slabSpecId, coilSpecId }, include });
  }
  update(tx: Tx, id: number, coilSpecId: number): Promise<SpecMappingRow> {
    return tx.specMapping.update({ where: { id }, data: { coilSpecId }, include });
  }
  delete(tx: Tx, id: number) {
    return tx.specMapping.delete({ where: { id } });
  }
}
