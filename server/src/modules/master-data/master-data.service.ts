import { Injectable } from '@nestjs/common';
import type {
  CustomerView,
  ItemType,
  ItemView,
  ProcessType,
  ProductionSettingView,
  RawMaterialType,
  RoutingView,
  SpecificConsumptionView,
  SpecMappingItemView,
  SpecMappingView,
  SteelGradeView,
  SupplierView,
  UnitType,
  YardType,
  YardView,
} from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { MasterDataRepository } from './master-data.repository';

type SpecRow = Awaited<ReturnType<MasterDataRepository['findSpecMappings']>>[number]['coilItem'];

/** 열연 계획 수율·라우팅 수율은 routing.planned_yield_rate와 같은 소수 4자리 */
const YIELD_SCALE = 4;

/**
 * 업무 로직·트랜잭션·데이터에 따른 권한 검사 (컨벤션 6장).
 * BUSINESS_EVENT_TYPE([06])에 기준정보 이벤트가 없어 작업 로그는 남기지 않는다 (master-data.md 5장).
 */
@Injectable()
export class MasterDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: MasterDataRepository,
  ) {}

  async listCustomers(): Promise<CustomerView[]> {
    return this.repository.findCustomers(this.prisma);
  }

  async listItems(itemType?: ItemType): Promise<ItemView[]> {
    const rows = await this.repository.findItems(this.prisma, itemType);
    return rows.map((r) => ({
      id: r.id,
      itemCode: r.itemCode,
      itemName: r.itemName,
      itemType: r.itemType as ItemType,
      unitType: r.unitType as UnitType,
      rawMaterialType: r.rawMaterialType as RawMaterialType | null,
      steelGradeId: r.steelGradeId,
      steelGradeCode: r.steelGrade?.steelGradeCode ?? null,
      thicknessMm: r.thicknessMm?.toFixed(2) ?? null,
      widthMm: r.widthMm?.toFixed(2) ?? null,
      lengthMm: r.lengthMm?.toFixed(2) ?? null,
      theoreticalWeightTon: r.theoreticalWeightTon?.toFixed(3) ?? null,
      defaultYardId: r.defaultYardId,
      defaultSupplierId: r.defaultSupplierId,
    }));
  }

  /** API-168 */
  async listSteelGrades(): Promise<SteelGradeView[]> {
    return this.repository.findSteelGrades(this.prisma);
  }

  /** API-170. 매핑된 규격은 슬래브·코일이라 치수·이론중량이 늘 있다 (item CHECK) */
  async listSpecMappings(): Promise<SpecMappingView[]> {
    const rows = await this.repository.findSpecMappings(this.prisma);
    return rows.map((r) => {
      const slabWeight = r.slabItem.theoreticalWeightTon;
      const coilWeight = r.coilItem.theoreticalWeightTon;
      return {
        id: r.id,
        steelGradeId: r.slabItem.steelGradeId ?? 0,
        steelGradeCode: r.slabItem.steelGrade?.steelGradeCode ?? '',
        slabItem: toSpecMappingItemView(r.slabItem),
        coilItem: toSpecMappingItemView(r.coilItem),
        hotRollingYieldRate: slabWeight && coilWeight && slabWeight.gt(0) ? coilWeight.div(slabWeight).toFixed(YIELD_SCALE) : '',
      };
    });
  }

  /** API-172. 품목 유형별 공정 순서대로 */
  async listRoutings(): Promise<RoutingView[]> {
    const rows = await this.repository.findRoutings(this.prisma);
    return rows.map((r) => ({
      id: r.id,
      itemType: r.itemType as ItemType,
      processType: r.processType as ProcessType,
      sequenceNo: r.sequenceNo,
      plannedYieldRate: r.plannedYieldRate?.toFixed(YIELD_SCALE) ?? null,
    }));
  }

  /** API-175 */
  async listSpecificConsumptions(): Promise<SpecificConsumptionView[]> {
    const rows = await this.repository.findSpecificConsumptions(this.prisma);
    return rows.map((r) => ({
      id: r.id,
      rawMaterialItemId: r.rawMaterialItemId,
      rawMaterialItemCode: r.rawMaterialItem.itemCode,
      rawMaterialType: r.rawMaterialItem.rawMaterialType as RawMaterialType,
      steelGradeId: r.steelGradeId,
      steelGradeCode: r.steelGrade?.steelGradeCode ?? null,
      consumptionRate: r.consumptionRate.toFixed(4),
    }));
  }

  /** API-181 */
  async listSuppliers(): Promise<SupplierView[]> {
    return this.repository.findSuppliers(this.prisma);
  }

  /** API-184 */
  async listYards(): Promise<YardView[]> {
    const rows = await this.repository.findYards(this.prisma);
    return rows.map((r) => ({ ...r, yardType: r.yardType as YardType }));
  }

  /** API-187 */
  async getProductionSetting(): Promise<ProductionSettingView> {
    const row = await this.repository.findProductionSetting(this.prisma);
    if (!row) throw new AppException('COM-003', '생산 설정값이 없어요');
    return { id: row.id, heatCapacityTon: row.heatCapacityTon.toFixed(3), deliveryRiskDays: row.deliveryRiskDays };
  }
}

function toSpecMappingItemView(r: SpecRow): SpecMappingItemView {
  return {
    id: r.id,
    itemCode: r.itemCode,
    thicknessMm: r.thicknessMm?.toFixed(2) ?? '',
    widthMm: r.widthMm?.toFixed(2) ?? '',
    lengthMm: r.lengthMm?.toFixed(2) ?? '',
    theoreticalWeightTon: r.theoreticalWeightTon?.toFixed(3) ?? '',
  };
}
