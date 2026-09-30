import { Injectable } from '@nestjs/common';
import type { Tx } from '../../prisma/prisma.service';
import type { ReadinessSnapshot } from './readiness.rules';

@Injectable()
export class ReadinessRepository {
  async loadSnapshot(tx: Tx): Promise<ReadinessSnapshot> {
    const [grades, specs, mappings, routings, raws, consumptions, inspections, setting] = await Promise.all([
      tx.steelGrade.findMany({ include: { _count: { select: { compositionSpecs: true } } }, orderBy: { id: 'asc' } }),
      tx.productSpec.findMany({ include: { item: true }, orderBy: { id: 'asc' } }),
      tx.specMapping.findMany({ include: { slabSpec: true, coilSpec: true }, orderBy: { id: 'asc' } }),
      tx.routing.findMany({ orderBy: [{ itemType: 'asc' }, { processSeq: 'asc' }] }),
      tx.rawMaterial.findMany({ include: { item: { include: { defaultSupplier: true } } }, orderBy: { id: 'asc' } }),
      tx.specificConsumption.findMany(),
      tx.inspectionItem.findMany({ select: { processCode: true, steelGradeId: true } }),
      tx.productionSetting.findUnique({ where: { id: 1 } }),
    ]);
    return {
      steelGrades: grades.map((g) => ({ id: g.id, steelGradeCode: g.steelGradeCode, isActive: g.isActive, compositionSpecCount: g._count.compositionSpecs })),
      productSpecs: specs.map((p) => ({ id: p.id, specCode: p.specCode, itemType: p.item.itemType, isActive: p.isActive })),
      mappings: mappings.map((m) => ({
        id: m.id, slabSpecId: m.slabSpecId, coilSpecId: m.coilSpecId, slabSpecCode: m.slabSpec.specCode, coilSpecCode: m.coilSpec.specCode,
        slabWeightTon: m.slabSpec.theoreticalWeightTon, coilWeightTon: m.coilSpec.theoreticalWeightTon,
      })),
      routings: routings.map((r) => ({ itemType: r.itemType, processCode: r.processCode, plannedYieldRate: r.plannedYieldRate })),
      rawMaterials: raws.map((r) => ({
        id: r.id, materialCode: r.materialCode, itemName: r.item.itemName, rawMaterialType: r.rawMaterialType, isActive: r.item.isActive,
        defaultSupplierId: r.item.defaultSupplierId, defaultSupplierActive: r.item.defaultSupplier ? r.item.defaultSupplier.isActive : null,
      })),
      consumptions: consumptions.map((c) => ({ rawMaterialId: c.rawMaterialId, steelGradeId: c.steelGradeId, consumptionRate: c.consumptionRate })),
      inspectionItems: inspections,
      productionSetting: setting ? { heatCapacityTon: setting.heatCapacityTon, deliveryRiskDays: setting.deliveryRiskDays } : null,
    };
  }
}
