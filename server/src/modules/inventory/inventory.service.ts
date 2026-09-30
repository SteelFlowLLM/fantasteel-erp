import { Injectable } from '@nestjs/common';
import { ITEM_QTY_UNIT, ITEM_TYPE, LOT_TYPE, SALES_ORDER_ITEM_STATUS } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ListInventoriesDto, ListSurplusDto } from './dto/list-inventories.dto';
import { InventoryRepository } from './inventory.repository';

const tonText = (d: Prisma.Decimal) => d.toFixed(3);
const DAY_MS = 86_400_000;

export interface ProductInventoryView {
  productSpecId: number;
  specCode: string;
  itemType: 'SLAB' | 'COIL';
  qtyUnit: string;
  steelGradeId: number;
  steelGradeCode: string;
  thicknessMm: string;
  widthMm: string;
  lengthMm: string;
  theoreticalWeightTon: string;
  yardName: string | null;
  /** 합격·미소진 매수 (재고 풀. 여재 포함, 열연 투입용 귀속 슬래브 제외) */
  onHandQty: number;
  /** ACTIVE 예약 매수 합계 */
  reservedQty: number;
  /** 가용재고 = onHandQty − reservedQty */
  availableQty: number;
  /** 검사 대기 (자기 검사 또는 상위 히트 성분 검사 전) */
  pendingInspectionQty: number;
  /** 불합격 (자기 검사 불합격 또는 상위 히트 불합격) */
  failedQty: number;
  /** 열연 투입용으로 코일 수주에 귀속된 합격 슬래브 (재고 풀 밖) */
  earmarkedQty: number;
  onHandTon: string;
  reservedTon: string;
  availableTon: string;
}

export interface RawMaterialInventoryView {
  rawMaterialId: number;
  materialCode: string;
  itemCode: string;
  itemName: string;
  rawMaterialType: string;
  yardName: string | null;
  /** 원료 LOT 잔량 합계 */
  onHandTon: string;
  /** 입고예정 = 확정 발주의 (발주량 − 입고 누계) 합계 */
  scheduledReceiptTon: string;
}

export interface InventoryListView {
  products: ProductInventoryView[];
  rawMaterials: RawMaterialInventoryView[];
}

export interface SurplusLotView {
  lotId: number;
  lotNo: string;
  productSpecId: number;
  specCode: string;
  steelGradeCode: string;
  heatNo: string | null;
  producedAt: string;
  /** 생산완료 뒤 지난 일수 */
  ageDays: number;
  theoreticalWeightTon: string;
  yardName: string | null;
  productionPlanId: number | null;
}

export interface SurplusSpecView {
  productSpecId: number;
  specCode: string;
  steelGradeCode: string;
  /** 여재 슬래브 매수·톤 */
  surplusQty: number;
  surplusTon: string;
  /** 같은 규격 재고 풀의 예약·가용 매수. 여재 중 reservedQty만큼은 이미 수주에 예약되어 있다(예약은 LOT을 정하지 않는다). */
  reservedQty: number;
  availableQty: number;
}

export interface SurplusView {
  lots: SurplusLotView[];
  specs: SurplusSpecView[];
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: InventoryRepository,
  ) {}

  /** 제품: 규격별 합격·예약·가용 매수와 톤 계산값 / 원료: 톤 잔량과 입고예정 (REQ-INV-001). */
  async list(q: ListInventoriesDto): Promise<InventoryListView> {
    const wantProducts = q.itemType !== ITEM_TYPE.RAW_MATERIAL;
    const wantRaw = (!q.itemType || q.itemType === ITEM_TYPE.RAW_MATERIAL) && !q.steelGrade && !q.productSpecId;
    return {
      products: wantProducts ? await this.products(q) : [],
      rawMaterials: wantRaw ? await this.rawMaterials() : [],
    };
  }

  private async products(q: ListInventoriesDto): Promise<ProductInventoryView[]> {
    const specs = await this.repo.findProductSpecs(this.prisma, {
      itemType: q.itemType === ITEM_TYPE.SLAB || q.itemType === ITEM_TYPE.COIL ? q.itemType : undefined,
      steelGradeCode: q.steelGrade,
      productSpecId: q.productSpecId,
    });
    const lots = await this.repo.findInStockProductLots(this.prisma, specs.map((s) => s.id));
    const counts = new Map<number, { pending: number; failed: number; earmarked: number }>();
    for (const lot of lots) {
      if (lot.productSpecId === null) continue;
      const c = counts.get(lot.productSpecId) ?? { pending: 0, failed: 0, earmarked: 0 };
      counts.set(lot.productSpecId, c);
      if (lot.isPassed === false || lot.heatLot?.isPassed === false) c.failed += 1;
      else if (lot.isPassed !== true || lot.heatLot?.isPassed !== true) c.pending += 1;
      else if (
        lot.lotType === LOT_TYPE.SLAB && lot.salesOrderItem && lot.salesOrderItem.salesOrderItemStatus !== SALES_ORDER_ITEM_STATUS.CANCELLED &&
        lot.salesOrderItem.productSpec.item.itemType === ITEM_TYPE.COIL
      ) c.earmarked += 1;
    }
    return specs.map((s) => {
      const itemType = s.item.itemType as 'SLAB' | 'COIL';
      const pool = s.inventories[0] ?? { onHandQty: 0, reservedQty: 0 };
      const availableQty = Math.max(0, pool.onHandQty - pool.reservedQty);
      const c = counts.get(s.id) ?? { pending: 0, failed: 0, earmarked: 0 };
      return {
        productSpecId: s.id,
        specCode: s.specCode,
        itemType,
        qtyUnit: ITEM_QTY_UNIT[itemType],
        steelGradeId: s.steelGrade.id,
        steelGradeCode: s.steelGrade.steelGradeCode,
        thicknessMm: s.thicknessMm.toString(),
        widthMm: s.widthMm.toString(),
        lengthMm: s.lengthMm.toString(),
        theoreticalWeightTon: tonText(s.theoreticalWeightTon),
        yardName: s.yard?.yardName ?? null,
        onHandQty: pool.onHandQty,
        reservedQty: pool.reservedQty,
        availableQty,
        pendingInspectionQty: c.pending,
        failedQty: c.failed,
        earmarkedQty: c.earmarked,
        onHandTon: tonText(s.theoreticalWeightTon.mul(pool.onHandQty)),
        reservedTon: tonText(s.theoreticalWeightTon.mul(pool.reservedQty)),
        availableTon: tonText(s.theoreticalWeightTon.mul(availableQty)),
      };
    });
  }

  private async rawMaterials(): Promise<RawMaterialInventoryView[]> {
    const rows = await this.repo.findRawMaterials(this.prisma);
    const scheduled = new Map<number, Prisma.Decimal>();
    for (const line of await this.repo.findOpenPurchaseOrderItems(this.prisma)) {
      const open = Prisma.Decimal.max(0, line.orderedTon.sub(line.receivedTon));
      scheduled.set(line.rawMaterialId, (scheduled.get(line.rawMaterialId) ?? new Prisma.Decimal(0)).add(open));
    }
    return rows.map((r) => ({
      rawMaterialId: r.id,
      materialCode: r.materialCode,
      itemCode: r.item.itemCode,
      itemName: r.item.itemName,
      rawMaterialType: r.rawMaterialType,
      yardName: r.yard?.yardName ?? null,
      onHandTon: tonText(r.inventories[0]?.onHandTon ?? new Prisma.Decimal(0)),
      scheduledReceiptTon: tonText(scheduled.get(r.id) ?? new Prisma.Decimal(0)),
    }));
  }

  /** 여재 (REQ-INV-008): 미배정 합격 슬래브. 컬럼 없이 계산한다. */
  async surplus(q: ListSurplusDto): Promise<SurplusView> {
    const rows = await this.repo.findSurplusSlabs(this.prisma, { steelGradeCode: q.steelGrade, productSpecId: q.productSpecId });
    const now = Date.now();
    const specs = new Map<number, SurplusSpecView & { ton: Prisma.Decimal }>();
    const lots = rows.map((l): SurplusLotView => {
      const spec = l.productSpec!;
      const pool = spec.inventories[0] ?? { onHandQty: 0, reservedQty: 0 };
      const summary = specs.get(spec.id) ?? {
        productSpecId: spec.id, specCode: spec.specCode, steelGradeCode: spec.steelGrade.steelGradeCode,
        surplusQty: 0, surplusTon: '0.000', reservedQty: pool.reservedQty, availableQty: Math.max(0, pool.onHandQty - pool.reservedQty), ton: new Prisma.Decimal(0),
      };
      summary.surplusQty += 1;
      summary.ton = summary.ton.add(spec.theoreticalWeightTon);
      summary.surplusTon = tonText(summary.ton);
      specs.set(spec.id, summary);
      return {
        lotId: l.id,
        lotNo: l.lotNo,
        productSpecId: spec.id,
        specCode: spec.specCode,
        steelGradeCode: spec.steelGrade.steelGradeCode,
        heatNo: l.heatLot?.lotNo ?? null,
        producedAt: l.producedAt.toISOString(),
        ageDays: Math.max(0, Math.floor((now - l.producedAt.getTime()) / DAY_MS)),
        theoreticalWeightTon: tonText(spec.theoreticalWeightTon),
        yardName: l.yard?.yardName ?? null,
        productionPlanId: l.productionPlanId,
      };
    });
    return { lots, specs: [...specs.values()].map(({ ton: _ton, ...rest }) => rest) };
  }
}
