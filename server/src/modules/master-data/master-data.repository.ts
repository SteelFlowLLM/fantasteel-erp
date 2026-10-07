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

  findSpecMappings(tx: Tx, id?: number) {
    return tx.specMapping.findMany({
      where: { id },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        slabItem: { select: { ...SPEC_SELECT, steelGrade: { select: { steelGradeCode: true } } } },
        coilItem: { select: SPEC_SELECT },
      },
    });
  }

  findRoutings(tx: Tx, id?: number) {
    return tx.routing.findMany({ where: { id }, orderBy: [{ itemType: 'asc' }, { sequenceNo: 'asc' }] });
  }

  findSpecificConsumptions(tx: Tx, id?: number) {
    return tx.specificConsumption.findMany({
      where: { id },
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

  findItem(tx: Tx, id: number) {
    return tx.item.findUnique({ where: { id } });
  }

  findItemByCode(tx: Tx, itemCode: string) {
    return tx.item.findUnique({ where: { itemCode }, select: { id: true } });
  }

  /** 같은 유형·강종·두께·폭·길이 규격 (REQ-MST-003 중복 금지) */
  findSameSpec(tx: Tx, spec: { itemType: ItemType; steelGradeId: number; thicknessMm: string; widthMm: string; lengthMm: string }, exceptId?: number) {
    return tx.item.findFirst({ where: { ...spec, id: exceptId === undefined ? undefined : { not: exceptId } }, select: { itemCode: true } });
  }

  findSteelGrade(tx: Tx, id: number) {
    return tx.steelGrade.findUnique({ where: { id } });
  }

  findSteelGradeByCode(tx: Tx, steelGradeCode: string) {
    return tx.steelGrade.findUnique({ where: { steelGradeCode }, select: { id: true } });
  }

  findYard(tx: Tx, id: number) {
    return tx.yard.findUnique({ where: { id }, select: { id: true, yardType: true } });
  }

  findSupplier(tx: Tx, id: number) {
    return tx.supplier.findUnique({ where: { id }, select: { id: true } });
  }

  /**
   * 규격이 쓰였는지 (MST-002): 수주 품목·LOT이 있거나 재고 수량이 있다 (master-data.md 8장 임시 결정).
   * 재고 행은 inventory 모듈이 필요할 때 만들어서 행이 있다는 것만으로는 보지 않는다.
   * 같은 tx에서 동시에 쿼리하지 않도록 차례로 센다.
   */
  async isSpecUsed(tx: Tx, itemId: number): Promise<boolean> {
    if ((await tx.salesOrderItem.count({ where: { itemId } })) > 0) return true;
    if ((await tx.lot.count({ where: { itemId } })) > 0) return true;
    return (await tx.inventory.count({ where: { itemId, OR: [{ onHandQty: { gt: 0 } }, { reservedQty: { gt: 0 } }] } })) > 0;
  }

  /** 이 규격이 슬래브나 코일로 들어간 매핑 */
  findSpecMappingOf(tx: Tx, itemId: number) {
    return tx.specMapping.findFirst({ where: { OR: [{ slabItemId: itemId }, { coilItemId: itemId }] } });
  }

  createItem(tx: Tx, data: Prisma.ItemUncheckedCreateInput) {
    return tx.item.create({ data, select: { id: true } });
  }

  updateItem(tx: Tx, id: number, data: Prisma.ItemUncheckedUpdateInput) {
    return tx.item.update({ where: { id }, data, select: { id: true } });
  }

  createSteelGrade(tx: Tx, data: { steelGradeCode: string; steelGradeName: string; standardNo: string }) {
    return tx.steelGrade.create({ data, select: { id: true, steelGradeCode: true, steelGradeName: true, standardNo: true } });
  }

  createSpecMapping(tx: Tx, data: { slabItemId: number; coilItemId: number }) {
    return tx.specMapping.create({ data, select: { id: true } });
  }

  findRouting(tx: Tx, id: number) {
    return tx.routing.findUnique({ where: { id } });
  }

  /** 같은 품목 유형에서 공정이나 순서가 겹치는 라우팅 (unique (item_type, process_type)·(item_type, sequence_no)) */
  findRoutingConflict(tx: Tx, itemType: string, key: { processType?: string; sequenceNo?: number }, exceptId?: number) {
    // undefined 조건은 Prisma가 빼 버려 모든 행과 맞으므로 보낸 키만 OR에 넣는다
    const or = [...(key.processType ? [{ processType: key.processType }] : []), ...(key.sequenceNo !== undefined ? [{ sequenceNo: key.sequenceNo }] : [])];
    if (or.length === 0) return Promise.resolve(null);
    return tx.routing.findFirst({
      where: { itemType, id: exceptId === undefined ? undefined : { not: exceptId }, OR: or },
      select: { processType: true, sequenceNo: true },
    });
  }

  createRouting(tx: Tx, data: { itemType: string; processType: string; sequenceNo: number; plannedYieldRate: string | null }) {
    return tx.routing.create({ data, select: { id: true } });
  }

  updateRouting(tx: Tx, id: number, data: { sequenceNo?: number; plannedYieldRate?: string | null }) {
    return tx.routing.update({ where: { id }, data, select: { id: true } });
  }

  findSpecificConsumption(tx: Tx, id: number) {
    return tx.specificConsumption.findUnique({ where: { id }, select: { id: true } });
  }

  /** 원료당 공통 원단위 1행, 원료·강종당 1행 (부분 unique) */
  findSameSpecificConsumption(tx: Tx, rawMaterialItemId: number, steelGradeId: number | null) {
    return tx.specificConsumption.findFirst({ where: { rawMaterialItemId, steelGradeId }, select: { id: true } });
  }

  createSpecificConsumption(tx: Tx, data: { rawMaterialItemId: number; steelGradeId: number | null; consumptionRate: string }) {
    return tx.specificConsumption.create({ data, select: { id: true } });
  }

  updateSpecificConsumption(tx: Tx, id: number, consumptionRate: string) {
    return tx.specificConsumption.update({ where: { id }, data: { consumptionRate }, select: { id: true } });
  }

  updateProductionSetting(tx: Tx, id: number, data: { heatCapacityTon?: string; deliveryRiskDays?: number }) {
    return tx.productionSetting.update({ where: { id }, data, select: { id: true } });
  }
}
