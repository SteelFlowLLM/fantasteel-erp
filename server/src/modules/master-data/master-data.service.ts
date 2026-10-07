import { Injectable } from '@nestjs/common';
import {
  ITEM_TYPE,
  ITEM_TYPE_LABEL,
  UNIT_TYPE,
  YARD_TYPE_LABEL,
  calcTheoreticalWeightTon,
  type CustomerView,
  type ItemType,
  type ItemView,
  type ProcessType,
  type ProductionSettingView,
  type RawMaterialType,
  type RoutingView,
  type SpecificConsumptionView,
  type SpecMappingItemView,
  type SpecMappingView,
  type SteelGradeView,
  type SupplierView,
  type UnitType,
  type YardType,
  type YardView,
} from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import type { CreateItemDto } from './dto/item.dto';
import type { CreateSteelGradeDto } from './dto/steel-grade.dto';
import { MasterDataRepository } from './master-data.repository';

type ItemRow = Awaited<ReturnType<MasterDataRepository['findItems']>>[number];
type SpecRow = Awaited<ReturnType<MasterDataRepository['findSpecMappings']>>[number]['coilItem'];
interface SpecInput {
  steelGradeId: number;
  thicknessMm: string;
  widthMm: string;
  lengthMm: string;
}

/** 열연 계획 수율·라우팅 수율은 routing.planned_yield_rate와 같은 소수 4자리 */
const YIELD_SCALE = 4;

/**
 * 업무 로직·트랜잭션·데이터에 따른 권한 검사 (컨벤션 6장).
 * BUSINESS_EVENT_TYPE([06])에 기준정보 이벤트가 없어 작업 로그는 남기지 않는다 (master-data.md 5장).
 * 9.3에 코드가 없는 거부(중복·중량 초과·야드 유형 등)는 COM-004에 문구를 붙인다 (master-data.md 8장 임시 결정).
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
    const rows = await this.repository.findItems(this.prisma, { itemType });
    return rows.map(toItemView);
  }

  private async itemView(id: number): Promise<ItemView> {
    const [row] = await this.repository.findItems(this.prisma, { id });
    if (!row) throw new AppException('COM-003', '품목을 찾을 수 없어요');
    return toItemView(row);
  }

  /** API-166. 원료는 받은 원료 코드로, 규격은 강종·치수로 규격 코드·품목명·1매 이론중량을 만든다 */
  async createItem(dto: CreateItemDto): Promise<ItemView> {
    const { id } = await this.prisma.$transaction(async (tx) => {
      await this.assertYard(tx, dto.defaultYardId, dto.itemType);
      if (dto.itemType === ITEM_TYPE.RAW_MATERIAL) {
        const itemCode = dto.itemCode ?? '';
        if (await this.repository.findItemByCode(tx, itemCode)) throw new AppException('COM-004', `품목 코드 ${itemCode}이(가) 이미 있어요`);
        if (dto.defaultSupplierId != null) await this.assertSupplier(tx, dto.defaultSupplierId);
        return this.repository.createItem(tx, {
          itemCode,
          itemName: dto.itemName ?? '',
          itemType: dto.itemType,
          unitType: UNIT_TYPE.TON,
          rawMaterialType: dto.rawMaterialType,
          defaultYardId: dto.defaultYardId,
          defaultSupplierId: dto.defaultSupplierId ?? null,
        });
      }
      if (dto.defaultSupplierId != null) throw new AppException('COM-004', '기본 공급업체는 원료에만 지정해요');
      const spec = await this.readSpec(tx, dto.itemType, {
        steelGradeId: dto.steelGradeId ?? 0,
        thicknessMm: dto.thicknessMm ?? '0',
        widthMm: dto.widthMm ?? '0',
        lengthMm: dto.lengthMm ?? '0',
      });
      return this.repository.createItem(tx, { ...spec, itemType: dto.itemType, unitType: UNIT_TYPE.QTY, defaultYardId: dto.defaultYardId });
    });
    return this.itemView(id);
  }

  /** 강종·치수 확인 → 규격 코드·품목명·1매 이론중량 (REQ-MST-003, 코드 모양은 seed.ts specCode와 같다) */
  private async readSpec(tx: Tx, itemType: ItemType, input: SpecInput) {
    const grade = await this.repository.findSteelGrade(tx, input.steelGradeId);
    if (!grade) throw new AppException('COM-003', '강종을 찾을 수 없어요');
    const dims = {
      thicknessMm: new Prisma.Decimal(input.thicknessMm).toFixed(2),
      widthMm: new Prisma.Decimal(input.widthMm).toFixed(2),
      lengthMm: new Prisma.Decimal(input.lengthMm).toFixed(2),
    };
    const theoreticalWeightTon = calcTheoreticalWeightTon(dims.thicknessMm, dims.widthMm, dims.lengthMm);
    if (!new Prisma.Decimal(theoreticalWeightTon).gt(0)) throw new AppException('COM-004', '1매 이론중량이 0이 되는 치수예요. 치수를 확인해 주세요');
    const same = await this.repository.findSameSpec(tx, { itemType, steelGradeId: grade.id, ...dims });
    if (same) throw new AppException('COM-004', `같은 강종·두께·폭·길이의 규격이 이미 있어요 (${same.itemCode})`);
    const size = [dims.thicknessMm, dims.widthMm, dims.lengthMm].map(trimZeros);
    return {
      itemCode: `${itemType === ITEM_TYPE.SLAB ? 'SL' : 'CL'}-${grade.steelGradeCode}-${size.join('x')}`,
      itemName: `${grade.steelGradeCode} ${ITEM_TYPE_LABEL[itemType]} ${size.join('×')}`,
      steelGradeId: grade.id,
      ...dims,
      theoreticalWeightTon,
    };
  }

  /** 기본 야드는 품목 유형과 같은 유형의 야드 (master-data.md 8장 임시 결정) */
  private async assertYard(tx: Tx, yardId: number, itemType: ItemType) {
    const yard = await this.repository.findYard(tx, yardId);
    if (!yard) throw new AppException('COM-003', '야드를 찾을 수 없어요');
    if (yard.yardType !== itemType) throw new AppException('COM-004', `${YARD_TYPE_LABEL[itemType]}만 기본 야드로 고를 수 있어요`);
  }

  private async assertSupplier(tx: Tx, supplierId: number) {
    if (!(await this.repository.findSupplier(tx, supplierId))) throw new AppException('COM-003', '공급업체를 찾을 수 없어요');
  }

  /** API-168 */
  async listSteelGrades(): Promise<SteelGradeView[]> {
    return this.repository.findSteelGrades(this.prisma);
  }

  /** API-169 */
  async createSteelGrade(dto: CreateSteelGradeDto): Promise<SteelGradeView> {
    return this.prisma.$transaction(async (tx) => {
      if (await this.repository.findSteelGradeByCode(tx, dto.steelGradeCode)) throw new AppException('COM-004', `강종 ${dto.steelGradeCode}이(가) 이미 있어요`);
      return this.repository.createSteelGrade(tx, { steelGradeCode: dto.steelGradeCode, steelGradeName: dto.steelGradeName, standardNo: dto.standardNo });
    });
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

/** 규격 코드·품목명의 치수는 끝의 0을 뗀다 (250.00 → 250, 2.50 → 2.5) */
const trimZeros = (value: string) => (value.includes('.') ? value.replace(/\.?0+$/, '') : value);

function toItemView(r: ItemRow): ItemView {
  return {
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
  };
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
