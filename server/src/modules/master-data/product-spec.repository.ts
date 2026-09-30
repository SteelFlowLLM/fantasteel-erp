import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

const include = {
  item: true,
  steelGrade: true,
  yard: true,
  slabMapping: { include: { coilSpec: { include: { item: true } } } },
  coilMapping: { include: { slabSpec: { include: { item: true } } } },
} satisfies Prisma.ProductSpecInclude;
export type ProductSpecRow = Prisma.ProductSpecGetPayload<{ include: typeof include }>;

@Injectable()
export class ProductSpecRepository {
  findMany(tx: Tx, where: Prisma.ProductSpecWhereInput): Promise<ProductSpecRow[]> {
    return tx.productSpec.findMany({ where, include, orderBy: [{ itemId: 'asc' }, { steelGradeId: 'asc' }, { widthMm: 'asc' }, { id: 'asc' }] });
  }
  findById(tx: Tx, id: number): Promise<ProductSpecRow | null> {
    return tx.productSpec.findUnique({ where: { id }, include });
  }
  findByCombination(tx: Tx, steelGradeId: number, thicknessMm: Prisma.Decimal, widthMm: Prisma.Decimal, lengthMm: Prisma.Decimal) {
    return tx.productSpec.findUnique({ where: { steelGradeId_thicknessMm_widthMm_lengthMm: { steelGradeId, thicknessMm, widthMm, lengthMm } } });
  }
  findBySpecCode(tx: Tx, specCode: string) {
    return tx.productSpec.findUnique({ where: { specCode } });
  }
  async create(tx: Tx, data: Prisma.ProductSpecUncheckedCreateInput): Promise<ProductSpecRow> {
    const row = await tx.productSpec.create({ data });
    // 재고 화면·예약이 규격마다 재고 행(0매)을 기대한다 (시드와 같은 방식)
    await tx.inventory.create({ data: { productSpecId: row.id } });
    return (await this.findById(tx, row.id))!;
  }
  async update(tx: Tx, id: number, data: Prisma.ProductSpecUncheckedUpdateInput): Promise<ProductSpecRow> {
    await tx.productSpec.update({ where: { id }, data });
    return (await this.findById(tx, id))!;
  }

  /**
   * 사용된 규격 id 집합 (REQ-MST-003): 수주 품목·LOT·생산계획이 참조하거나, 재고에 수량(보유·예약)이 있거나, 예약이 있는 규격.
   * ids를 생략하면 모든 규격을 대상으로 한다.
   */
  async usedSpecIds(tx: Tx, ids?: number[]): Promise<Set<number>> {
    const inIds = ids ? { in: ids } : undefined;
    const ref = { productSpecId: inIds ?? undefined };
    const pick = { productSpecId: true } as const;
    const used = new Set<number>();
    const add = (rows: { productSpecId: number | null }[]) => rows.forEach((r) => r.productSpecId !== null && used.add(r.productSpecId));
    add(await tx.salesOrderItem.findMany({ where: ref, distinct: ['productSpecId'], select: pick }));
    add(await tx.reservation.findMany({ where: ref, distinct: ['productSpecId'], select: pick }));
    add(await tx.productionPlan.findMany({ where: ref, distinct: ['productSpecId'], select: pick }));
    add(await tx.lot.findMany({ where: { productSpecId: inIds ?? { not: null } }, distinct: ['productSpecId'], select: pick }));
    add(await tx.inventory.findMany({ where: { productSpecId: inIds ?? { not: null }, OR: [{ onHandQty: { gt: 0 } }, { reservedQty: { gt: 0 } }] }, select: pick }));
    return used;
  }
}
