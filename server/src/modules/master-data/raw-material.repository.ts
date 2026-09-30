import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

const include = { item: { include: { defaultSupplier: true } }, yard: true, inventories: true } satisfies Prisma.RawMaterialInclude;
export type RawMaterialRow = Prisma.RawMaterialGetPayload<{ include: typeof include }>;

@Injectable()
export class RawMaterialRepository {
  findMany(tx: Tx, where: Prisma.RawMaterialWhereInput): Promise<RawMaterialRow[]> {
    return tx.rawMaterial.findMany({ where, include, orderBy: { id: 'asc' } });
  }
  findById(tx: Tx, id: number): Promise<RawMaterialRow | null> {
    return tx.rawMaterial.findUnique({ where: { id }, include });
  }
  findByMaterialCode(tx: Tx, materialCode: string) {
    return tx.rawMaterial.findUnique({ where: { materialCode } });
  }
  /** 원료 품목 + 원료 상세 + 원료 재고 행(0톤)을 한 번에 만든다 (호출하는 쪽의 tx 안에서). */
  async createWithInventory(tx: Tx, input: { itemCode: string; itemName: string; materialCode: string; rawMaterialType: string; yardId: number | null; defaultSupplierId: number | null }): Promise<RawMaterialRow> {
    const item = await tx.item.create({
      data: { itemCode: input.itemCode, itemName: input.itemName, itemType: 'RAW_MATERIAL', unitType: 'TON', defaultSupplierId: input.defaultSupplierId },
    });
    const raw = await tx.rawMaterial.create({
      data: { itemId: item.id, materialCode: input.materialCode, rawMaterialType: input.rawMaterialType, yardId: input.yardId },
    });
    await tx.inventory.create({ data: { rawMaterialId: raw.id } });
    return (await this.findById(tx, raw.id))!;
  }
  updateItem(tx: Tx, itemId: number, data: Prisma.ItemUncheckedUpdateInput) {
    return tx.item.update({ where: { id: itemId }, data });
  }
  updateDetail(tx: Tx, id: number, data: Prisma.RawMaterialUncheckedUpdateInput) {
    return tx.rawMaterial.update({ where: { id }, data });
  }
}
