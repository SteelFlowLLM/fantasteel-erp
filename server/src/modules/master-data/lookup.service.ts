import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LookupRepository } from './lookup.repository';

/**
 * 수주·생산·구매 화면의 선택 목록. 로그인한 모든 사원이 읽을 수 있다 (기준정보 관리 권한 불필요).
 * 사용 중지된 항목은 빠진다.
 */
@Injectable()
export class LookupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: LookupRepository,
  ) {}

  async lookups() {
    const d = await this.repo.load(this.prisma);
    return {
      steelGrades: d.steelGrades,
      productSpecs: d.productSpecs.map((s) => ({
        id: s.id,
        specCode: s.specCode,
        itemType: s.item.itemType,
        steelGradeId: s.steelGradeId,
        steelGradeCode: s.steelGrade.steelGradeCode,
        thicknessMm: s.thicknessMm,
        widthMm: s.widthMm,
        lengthMm: s.lengthMm,
        theoreticalWeightTon: s.theoreticalWeightTon,
        // 슬래브면 매핑된 코일 규격, 코일이면 매핑된 슬래브 규격
        mappedSpecId: s.slabMapping?.coilSpecId ?? s.coilMapping?.slabSpecId ?? null,
      })),
      rawMaterials: d.rawMaterials.map((r) => ({
        id: r.id, materialCode: r.materialCode, name: r.item.itemName, rawMaterialType: r.rawMaterialType, defaultSupplierId: r.item.defaultSupplierId, yardId: r.yardId,
      })),
      customers: d.customers,
      suppliers: d.suppliers,
      yards: d.yards,
      productionSetting: d.productionSetting,
    };
  }
}
