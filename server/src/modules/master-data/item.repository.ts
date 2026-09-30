import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

const include = { defaultSupplier: true, rawMaterial: true } satisfies Prisma.ItemInclude;
export type ItemRow = Prisma.ItemGetPayload<{ include: typeof include }>;

@Injectable()
export class ItemRepository {
  findMany(tx: Tx, where: Prisma.ItemWhereInput): Promise<ItemRow[]> {
    return tx.item.findMany({ where, include, orderBy: { id: 'asc' } });
  }
  findById(tx: Tx, id: number): Promise<ItemRow | null> {
    return tx.item.findUnique({ where: { id }, include });
  }
  findByCode(tx: Tx, itemCode: string) {
    return tx.item.findUnique({ where: { itemCode } });
  }
  create(tx: Tx, data: Prisma.ItemUncheckedCreateInput): Promise<ItemRow> {
    return tx.item.create({ data, include });
  }
  update(tx: Tx, id: number, data: Prisma.ItemUncheckedUpdateInput): Promise<ItemRow> {
    return tx.item.update({ where: { id }, data, include });
  }
}
