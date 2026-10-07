import { Injectable } from '@nestjs/common';
import type { ItemType } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

const SPEC_SELECT = { id: true, itemCode: true, steelGradeId: true, thicknessMm: true, widthMm: true, lengthMm: true, theoreticalWeightTon: true } as const;

/**
 * DB 접근은 여기서만 한다. 함수의 첫 인자는 tx (컨벤션 8장).
 * 집계·3개 이상 JOIN·잠금(FOR UPDATE)은 prisma/sql/*.sql(TypedSQL)로 만들고 tx.$queryRawTyped(...)로 부른다.
 */
@Injectable()
export class MasterDataRepository {
  findCustomers(tx: Tx) {
    return tx.customer.findMany({ orderBy: { customerCode: 'asc' }, select: { id: true, customerCode: true, customerName: true } });
  }

  findItems(tx: Tx, filter: { itemType?: ItemType; id?: number } = {}) {
    return tx.item.findMany({
      where: { itemType: filter.itemType, id: filter.id },
      orderBy: [{ itemType: 'asc' }, { itemCode: 'asc' }],
      include: { steelGrade: { select: { steelGradeCode: true } } },
    });
  }

  findSteelGrades(tx: Tx) {
    return tx.steelGrade.findMany({ orderBy: { id: 'asc' }, select: { id: true, steelGradeCode: true, steelGradeName: true, standardNo: true } });
  }

  findSpecMappings(tx: Tx) {
    return tx.specMapping.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        slabItem: { select: { ...SPEC_SELECT, steelGrade: { select: { steelGradeCode: true } } } },
        coilItem: { select: SPEC_SELECT },
      },
    });
  }

  findRoutings(tx: Tx) {
    return tx.routing.findMany({ orderBy: [{ itemType: 'asc' }, { sequenceNo: 'asc' }] });
  }

  findSpecificConsumptions(tx: Tx) {
    return tx.specificConsumption.findMany({
      orderBy: [{ rawMaterialItemId: 'asc' }, { steelGradeId: { sort: 'asc', nulls: 'first' } }],
      include: { rawMaterialItem: { select: { itemCode: true, rawMaterialType: true } }, steelGrade: { select: { steelGradeCode: true } } },
    });
  }

  findSuppliers(tx: Tx) {
    return tx.supplier.findMany({ orderBy: { supplierCode: 'asc' }, select: { id: true, supplierCode: true, supplierName: true } });
  }

  findYards(tx: Tx) {
    return tx.yard.findMany({ orderBy: { yardCode: 'asc' }, select: { id: true, yardCode: true, yardName: true, yardType: true } });
  }

  /** production_setting은 1행만 둔다 */
  findProductionSetting(tx: Tx) {
    return tx.productionSetting.findFirst({ orderBy: { id: 'asc' } });
  }

  // ── 등록·수정 (트랜잭션 안에서 부르므로 관계를 함께 고르지 않는다) ──

  findItemByCode(tx: Tx, itemCode: string) {
    return tx.item.findUnique({ where: { itemCode }, select: { id: true } });
  }

  /** 같은 유형·강종·두께·폭·길이 규격 (REQ-MST-003 중복 금지) */
  findSameSpec(tx: Tx, spec: { itemType: ItemType; steelGradeId: number; thicknessMm: string; widthMm: string; lengthMm: string }) {
    return tx.item.findFirst({ where: spec, select: { itemCode: true } });
  }

  findSteelGrade(tx: Tx, id: number) {
    return tx.steelGrade.findUnique({ where: { id } });
  }

  findYard(tx: Tx, id: number) {
    return tx.yard.findUnique({ where: { id }, select: { id: true, yardType: true } });
  }

  findSupplier(tx: Tx, id: number) {
    return tx.supplier.findUnique({ where: { id }, select: { id: true } });
  }

  createItem(tx: Tx, data: Prisma.ItemUncheckedCreateInput) {
    return tx.item.create({ data, select: { id: true } });
  }
}
