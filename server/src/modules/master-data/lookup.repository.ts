import { Injectable } from '@nestjs/common';
import type { Tx } from '../../prisma/prisma.service';

/** 화면 선택 목록용 조회. 사용 중인(active) 것만, 필요한 컬럼만 읽는다. */
@Injectable()
export class LookupRepository {
  async load(tx: Tx) {
    const [steelGrades, productSpecs, rawMaterials, customers, suppliers, yards, productionSetting] = await Promise.all([
      tx.steelGrade.findMany({ where: { isActive: true }, orderBy: { id: 'asc' }, select: { id: true, steelGradeCode: true, steelGradeName: true } }),
      tx.productSpec.findMany({
        where: { isActive: true },
        orderBy: [{ itemId: 'asc' }, { steelGradeId: 'asc' }, { widthMm: 'asc' }, { id: 'asc' }],
        select: {
          id: true, specCode: true, steelGradeId: true, thicknessMm: true, widthMm: true, lengthMm: true, theoreticalWeightTon: true,
          item: { select: { itemType: true } }, steelGrade: { select: { steelGradeCode: true } },
          slabMapping: { select: { coilSpecId: true } }, coilMapping: { select: { slabSpecId: true } },
        },
      }),
      tx.rawMaterial.findMany({
        where: { item: { isActive: true } },
        orderBy: { id: 'asc' },
        select: { id: true, materialCode: true, rawMaterialType: true, yardId: true, item: { select: { itemName: true, defaultSupplierId: true } } },
      }),
      tx.customer.findMany({ where: { isActive: true }, orderBy: { id: 'asc' }, select: { id: true, customerCode: true, customerName: true } }),
      tx.supplier.findMany({ where: { isActive: true }, orderBy: { id: 'asc' }, select: { id: true, supplierCode: true, supplierName: true } }),
      tx.yard.findMany({ where: { isActive: true }, orderBy: { id: 'asc' }, select: { id: true, yardCode: true, yardName: true, yardType: true } }),
      tx.productionSetting.findUnique({ where: { id: 1 }, select: { heatCapacityTon: true, deliveryRiskDays: true } }),
    ]);
    return { steelGrades, productSpecs, rawMaterials, customers, suppliers, yards, productionSetting };
  }
}
