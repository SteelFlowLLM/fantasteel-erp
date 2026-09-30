import { Injectable } from '@nestjs/common';
import { ERROR_CODE, GOODS_RECEIPT_STATUS, LOT_STATUS, LOT_TYPE, PURCHASE_ORDER_STATUS, YARD_TYPE, type AuthUser } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { lockRawMaterialInventory, lockRow } from '../../common/concurrency/locks';
import { AppException, badInput, notFound } from '../../common/errors/app.exception';
import { NumberingService } from '../../common/numbering/numbering.service';
import { RealtimeService } from '../../common/realtime/realtime.service';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { BusinessEventRecorder } from '../business-event/business-event.recorder';
import { StockService } from '../inventory/stock.service';
import type { CreateGoodsReceiptDto, ListGoodsReceiptsDto } from './dto/goods-receipt.dto';
import { GoodsReceiptRepository, type GoodsReceiptRow } from './goods-receipt.repository';
import { dateOnlyText, parsePositiveTon, rawMaterialView, toDateOnly, todayKst, ZERO } from './purchasing.util';

const KST_OFFSET_MS = 9 * 3600_000;

/** 입고 시각: 입고일이 오늘이면 확정 시각, 지난 날짜면 그날 0시(KST). 원료 LOT의 FIFO 기준(produced_at)과 채번 날짜에 쓴다. */
function receiptMoment(receiptDate: Date, now: Date): Date {
  return dateOnlyText(receiptDate) === todayKst(now) ? now : new Date(receiptDate.getTime() - KST_OFFSET_MS);
}

@Injectable()
export class GoodsReceiptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: GoodsReceiptRepository,
    private readonly numbering: NumberingService,
    private readonly stock: StockService,
    private readonly events: BusinessEventRecorder,
    private readonly realtime: RealtimeService,
  ) {}

  async list(q: ListGoodsReceiptsDto) {
    const where: Prisma.GoodsReceiptWhereInput = {};
    if (q.status) where.goodsReceiptStatus = q.status;
    if (q.purchaseOrderId) where.purchaseOrderItem = { purchaseOrderId: q.purchaseOrderId };
    return (await this.repo.findMany(this.prisma, where)).map(toView);
  }

  /** 입고 초안. 재고·LOT은 확정할 때 바뀐다. */
  async create(dto: CreateGoodsReceiptDto) {
    const id = await this.prisma.tx(async (tx) => {
      const item = await this.repo.findPurchaseOrderItem(tx, dto.purchaseOrderItemId);
      if (!item) throw notFound('발주 품목');
      const receivedTon = parsePositiveTon(dto.receivedTon, '입고 수량(톤)');
      this.assertWithinOutstanding(item, receivedTon);
      const receiptDate = toDateOnly(dto.receiptDate, '입고일');
      if (dto.receiptDate > todayKst()) throw badInput('입고일은 오늘 이전으로 입력해 주세요');
      const yardId = await this.resolveYardId(tx, dto.yardId ?? item.rawMaterial.yardId);
      const row = await this.repo.create(tx, {
        goodsReceiptNo: await this.numbering.documentNo(tx, 'RCV'),
        purchaseOrderItemId: item.id,
        receivedTon,
        receiptDate,
        yardId,
        goodsReceiptStatus: GOODS_RECEIPT_STATUS.DRAFT,
        note: dto.note?.trim() || null,
      });
      this.realtime.changed('goods-receipts');
      return row.id;
    });
    return this.view(id);
  }

  /**
   * 입고 확정 (REQ-PUR-004, BP-PUR-02): 입고 → 발주 품목 → 원료 재고 순으로 잠그고,
   * 미입고량 재검증 → 원료 LOT 생성 → 원료 재고(톤) 증가 → 발주 입고 누계·상태 갱신을 한 tx로 처리한다.
   * 이미 확정된 입고를 다시 확정하면 아무것도 바꾸지 않고 확정된 결과를 돌려준다 (재시도해도 LOT이 하나 더 생기지 않는다).
   */
  async confirm(id: number, user: AuthUser) {
    await this.prisma.tx(async (tx) => {
      await lockRow(tx, 'goods_receipt', id);
      const receipt = await this.repo.findById(tx, id);
      if (!receipt) throw notFound('입고');
      if (receipt.goodsReceiptStatus === GOODS_RECEIPT_STATUS.CONFIRMED) return;

      await lockRow(tx, 'purchase_order_item', receipt.purchaseOrderItemId);
      const item = await this.repo.findPurchaseOrderItem(tx, receipt.purchaseOrderItemId);
      if (!item) throw notFound('발주 품목');
      await lockRawMaterialInventory(tx, item.rawMaterialId);
      this.assertWithinOutstanding(item, receipt.receivedTon);

      const now = new Date();
      const receivedAt = receiptMoment(receipt.receiptDate, now);
      await this.repo.confirm(tx, id, user.employeeId, now);
      const lot = await this.repo.createRawMaterialLot(tx, {
        lotNo: await this.numbering.rawMaterialLotNo(tx, item.rawMaterial.materialCode, receivedAt),
        lotType: LOT_TYPE.RAW_MATERIAL,
        rawMaterialId: item.rawMaterialId,
        initialTon: receipt.receivedTon,
        remainingTon: receipt.receivedTon,
        yardId: receipt.yardId,
        supplierId: item.purchaseOrder.supplierId,
        goodsReceiptId: receipt.id,
        lotStatus: LOT_STATUS.IN_STOCK,
        producedAt: receivedAt,
      });
      await this.stock.adjustRawMaterialTon(tx, item.rawMaterialId, receipt.receivedTon.toFixed(3));
      await this.repo.addReceivedTon(tx, item.id, receipt.receivedTon);

      const tons = await this.repo.findPurchaseOrderItemTons(tx, item.purchaseOrderId);
      const purchaseOrderStatus = tons.every((t) => t.receivedTon.gte(t.orderedTon)) ? PURCHASE_ORDER_STATUS.RECEIVED : PURCHASE_ORDER_STATUS.PARTIALLY_RECEIVED;
      await this.repo.setPurchaseOrderStatus(tx, item.purchaseOrderId, purchaseOrderStatus);

      const receivedTotal = item.receivedTon.add(receipt.receivedTon);
      await this.events.record(tx, {
        actor: user,
        eventType: 'GOODS_RECEIPT_CONFIRMED',
        targetType: 'GOODS_RECEIPT',
        targetId: receipt.id,
        targetNo: receipt.goodsReceiptNo,
        lotIds: [lot.id],
        summary: `${item.purchaseOrder.purchaseOrderNo} ${item.rawMaterial.item.itemName} ${receipt.receivedTon.toFixed(3)}t 입고 확정 · 원료 LOT ${lot.lotNo}`,
        before: { receivedTon: item.receivedTon, outstandingTon: item.orderedTon.sub(item.receivedTon), purchaseOrderStatus: item.purchaseOrder.purchaseOrderStatus },
        after: { receivedTon: receivedTotal, outstandingTon: item.orderedTon.sub(receivedTotal), purchaseOrderStatus, lotNo: lot.lotNo },
      });
      this.realtime.changed('goods-receipts', 'purchase-orders', 'lots', 'mrp-runs');
    });
    return this.view(id);
  }

  private assertWithinOutstanding(item: { orderedTon: Prisma.Decimal; receivedTon: Prisma.Decimal; rawMaterial: { item: { itemName: string } } }, receivedTon: Prisma.Decimal): void {
    const outstandingTon = Prisma.Decimal.max(ZERO, item.orderedTon.sub(item.receivedTon));
    if (receivedTon.gt(outstandingTon)) {
      throw new AppException(ERROR_CODE.PUR_003, `${item.rawMaterial.item.itemName}: 입고 수량이 발주 미입고량 ${outstandingTon.toFixed(3)}t를 넘습니다`);
    }
  }

  private async resolveYardId(tx: Tx, yardId: number | null): Promise<number | null> {
    if (yardId === null) return null;
    const yard = await this.repo.findYard(tx, yardId);
    if (!yard) throw notFound('야드');
    if (yard.yardType !== YARD_TYPE.RAW_MATERIAL || !yard.isActive) throw badInput('원료는 사용 중인 원료 야드에만 입고할 수 있습니다');
    return yard.id;
  }

  private async view(id: number) {
    const row = await this.repo.findById(this.prisma, id);
    if (!row) throw notFound('입고');
    return toView(row);
  }
}

function toView(row: GoodsReceiptRow) {
  const { purchaseOrderItem, ...head } = row;
  return {
    ...head,
    rawMaterial: rawMaterialView(purchaseOrderItem.rawMaterial),
    purchaseOrder: purchaseOrderItem.purchaseOrder,
    purchaseOrderItem: {
      id: purchaseOrderItem.id,
      lineNo: purchaseOrderItem.lineNo,
      orderedTon: purchaseOrderItem.orderedTon,
      receivedTon: purchaseOrderItem.receivedTon,
      outstandingTon: Prisma.Decimal.max(ZERO, purchaseOrderItem.orderedTon.sub(purchaseOrderItem.receivedTon)),
    },
  };
}
