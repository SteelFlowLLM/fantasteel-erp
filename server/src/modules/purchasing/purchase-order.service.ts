import { Injectable } from '@nestjs/common';
import { ERROR_CODE, NOTIFICATION_TYPE, PURCHASE_ORDER_STATUS, PURCHASE_REQUISITION_STATUS, type AuthUser } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { lockRow } from '../../common/concurrency/locks';
import { AppException, badInput, notFound } from '../../common/errors/app.exception';
import { NumberingService } from '../../common/numbering/numbering.service';
import { RealtimeService } from '../../common/realtime/realtime.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessEventRecorder } from '../business-event/business-event.recorder';
import { NotificationSender } from '../notification/notification.sender';
import type { CreatePurchaseOrderDto, ListPurchaseOrdersDto } from './dto/purchase-order.dto';
import {
  PurchaseOrderRepository, type OrderableRequisitionItemRow, type PurchaseOrderDetailRow, type PurchaseOrderListRow,
} from './purchase-order.repository';
import { itemsSummary, parsePositiveTon, rawMaterialView, toDateOnly, todayKst, ZERO } from './purchasing.util';

const outstanding = (orderedTon: Prisma.Decimal, receivedTon: Prisma.Decimal) => Prisma.Decimal.max(ZERO, orderedTon.sub(receivedTon));

@Injectable()
export class PurchaseOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: PurchaseOrderRepository,
    private readonly numbering: NumberingService,
    private readonly events: BusinessEventRecorder,
    private readonly notifications: NotificationSender,
    private readonly realtime: RealtimeService,
  ) {}

  async list(q: ListPurchaseOrdersDto) {
    const where: Prisma.PurchaseOrderWhereInput = {};
    if (q.status) where.purchaseOrderStatus = q.status;
    if (q.supplierId) where.supplierId = q.supplierId;
    return (await this.repo.findMany(this.prisma, where)).map(toListView);
  }

  async detail(id: number) {
    const row = await this.repo.findDetail(this.prisma, id);
    if (!row) throw notFound('발주');
    return toDetailView(row);
  }

  /** 발주할 수 있는 구매요청 품목을 기본 공급업체별로 묶는다 (공급업체 1곳당 발주 1건, REQ-PUR-003). */
  async orderable() {
    const rows = await this.repo.findOrderableItems(this.prisma);
    const groups = new Map<number, { supplier: { id: number; supplierCode: string; supplierName: string } | null; items: ReturnType<typeof toOrderableView>[] }>();
    for (const row of rows) {
      const supplier = row.rawMaterial.item.defaultSupplier;
      const key = supplier?.id ?? 0;
      if (!groups.has(key)) groups.set(key, { supplier, items: [] });
      groups.get(key)!.items.push(toOrderableView(row));
    }
    return [...groups.values()].map((g) => ({ ...g, totalUnorderedTon: g.items.reduce((sum, it) => sum.add(it.unorderedTon), ZERO) }));
  }

  /**
   * 발주: 승인된 구매요청 품목으로만 만든다 (PUR-002). 만들면 바로 CONFIRMED라 입고예정에 잡힌다.
   * 구매요청 품목의 발주 누계를 같은 tx에서 올려 요청-발주 배분량을 보존한다.
   */
  async create(dto: CreatePurchaseOrderDto, user: AuthUser) {
    const id = await this.prisma.tx(async (tx) => {
      const supplier = await this.repo.findSupplier(tx, dto.supplierId);
      if (!supplier) throw notFound('공급업체');
      if (!supplier.isActive) throw badInput(`${supplier.supplierName}은(는) 사용 중지된 공급업체입니다`);
      const dueDate = toDateOnly(dto.dueDate, '납기');
      if (dto.dueDate < todayKst()) throw badInput('납기는 오늘 이후로 입력해 주세요');

      const itemIds = dto.items.map((it) => it.purchaseRequisitionItemId);
      if (new Set(itemIds).size !== itemIds.length) throw badInput('같은 구매요청 품목이 두 번 들어 있습니다');

      // 구매요청을 id 순으로 잠근 뒤 품목을 다시 읽는다 (동시에 같은 품목을 발주해도 남은 양을 넘지 않게)
      const peek = await this.repo.findRequisitionItems(tx, itemIds);
      if (peek.length !== itemIds.length) throw notFound('구매요청 품목');
      for (const requisitionId of [...new Set(peek.map((p) => p.purchaseRequisitionId))].sort((a, b) => a - b)) await lockRow(tx, 'purchase_requisition', requisitionId);
      const rows = new Map((await this.repo.findRequisitionItems(tx, itemIds)).map((r) => [r.id, r]));

      const lines = dto.items.map((it) => {
        const row = rows.get(it.purchaseRequisitionItemId)!;
        const requisition = row.purchaseRequisition;
        const name = row.rawMaterial.item.itemName;
        const orderedTon = parsePositiveTon(it.orderedTon, '발주 수량(톤)');
        if (requisition.purchaseRequisitionStatus === PURCHASE_REQUISITION_STATUS.ORDERED) throw badInput(`${requisition.purchaseRequisitionNo} ${name}: 이미 전량 발주했습니다`);
        if (requisition.purchaseRequisitionStatus !== PURCHASE_REQUISITION_STATUS.APPROVED) {
          throw new AppException(ERROR_CODE.PUR_002, `${requisition.purchaseRequisitionNo}: 부서장 승인 전에는 발주할 수 없습니다`);
        }
        const unorderedTon = row.requiredTon.sub(row.orderedTon);
        if (orderedTon.gt(unorderedTon)) throw badInput(`${requisition.purchaseRequisitionNo} ${name}: 발주할 수 있는 남은 수량은 ${Prisma.Decimal.max(ZERO, unorderedTon).toFixed(3)}t입니다`);
        const defaultSupplierId = row.rawMaterial.item.defaultSupplierId;
        if (defaultSupplierId !== null && defaultSupplierId !== supplier.id) throw badInput(`${name}의 기본 공급업체는 ${row.rawMaterial.item.defaultSupplier?.supplierName ?? ''}입니다. 공급업체별로 나눠 발주해 주세요`);
        return { row, orderedTon };
      });

      const confirmedAt = new Date();
      const purchaseOrder = await this.repo.create(tx, {
        purchaseOrderNo: await this.numbering.documentNo(tx, 'PO'),
        supplierId: supplier.id,
        purchaseOrderStatus: PURCHASE_ORDER_STATUS.CONFIRMED,
        dueDate,
        orderedEmployeeId: user.employeeId,
        confirmedAt,
        items: lines.map((l) => ({ rawMaterialId: l.row.rawMaterialId, purchaseRequisitionItemId: l.row.id, orderedTon: l.orderedTon })),
      });

      for (const l of lines) await this.repo.addOrderedTon(tx, l.row.id, l.orderedTon);
      const requisitions = new Map(lines.map((l) => [l.row.purchaseRequisitionId, l.row.purchaseRequisition]));
      const fullyOrdered: string[] = [];
      for (const [requisitionId, requisition] of requisitions) {
        const tons = await this.repo.findRequisitionItemTons(tx, requisitionId);
        if (tons.every((t) => t.orderedTon.gte(t.requiredTon))) {
          await this.repo.setRequisitionStatus(tx, requisitionId, PURCHASE_REQUISITION_STATUS.ORDERED);
          fullyOrdered.push(requisition.purchaseRequisitionNo);
        }
      }

      const summary = itemsSummary(lines.map((l) => ({ rawMaterial: l.row.rawMaterial, ton: l.orderedTon })));
      await this.events.record(tx, {
        actor: user,
        eventType: 'PURCHASE_ORDER_CONFIRMED',
        targetType: 'PURCHASE_ORDER',
        targetId: purchaseOrder.id,
        targetNo: purchaseOrder.purchaseOrderNo,
        summary: `발주 ${purchaseOrder.purchaseOrderNo} 확정 · ${supplier.supplierName} (${summary})`,
        after: {
          purchaseOrderStatus: PURCHASE_ORDER_STATUS.CONFIRMED, supplierId: supplier.id, dueDate: dto.dueDate,
          items: lines.map((l) => ({
            purchaseRequisitionNo: l.row.purchaseRequisition.purchaseRequisitionNo, purchaseRequisitionItemId: l.row.id,
            rawMaterialId: l.row.rawMaterialId, orderedTon: l.orderedTon,
          })),
          orderedPurchaseRequisitionNos: fullyOrdered,
        },
      });
      const requesterIds = [...new Set(lines.map((l) => l.row.purchaseRequisition.requesterId))];
      await this.notifications.toEmployees(tx, requesterIds, {
        notificationType: NOTIFICATION_TYPE.PURCHASE,
        title: `발주 ${purchaseOrder.purchaseOrderNo} 확정`,
        body: `${supplier.supplierName} · ${summary} · 납기 ${dto.dueDate}`,
        linkPath: '/purchase-orders',
        dedupeKey: `PO_CONFIRMED:${purchaseOrder.id}`,
        excludeEmployeeId: user.employeeId,
      });
      this.realtime.changed('purchase-orders', 'purchase-requisitions', 'mrp-runs');
      return purchaseOrder.id;
    });
    return this.detail(id);
  }
}

function toOrderableView(row: OrderableRequisitionItemRow) {
  return {
    purchaseRequisitionItemId: row.id,
    purchaseRequisitionId: row.purchaseRequisition.id,
    purchaseRequisitionNo: row.purchaseRequisition.purchaseRequisitionNo,
    desiredReceiptDate: row.purchaseRequisition.desiredReceiptDate,
    lineNo: row.lineNo,
    rawMaterial: rawMaterialView(row.rawMaterial),
    requiredTon: row.requiredTon,
    orderedTon: row.orderedTon,
    unorderedTon: Prisma.Decimal.max(ZERO, row.requiredTon.sub(row.orderedTon)),
  };
}

function toListView(row: PurchaseOrderListRow) {
  const { items, ...head } = row;
  const totalOrderedTon = items.reduce((sum, it) => sum.add(it.orderedTon), ZERO);
  const totalReceivedTon = items.reduce((sum, it) => sum.add(it.receivedTon), ZERO);
  return {
    ...head,
    totalOrderedTon,
    totalReceivedTon,
    totalOutstandingTon: outstanding(totalOrderedTon, totalReceivedTon),
    items: items.map((it) => ({
      id: it.id,
      lineNo: it.lineNo,
      rawMaterial: rawMaterialView(it.rawMaterial),
      purchaseRequisitionItemId: it.purchaseRequisitionItemId,
      orderedTon: it.orderedTon,
      receivedTon: it.receivedTon,
      outstandingTon: outstanding(it.orderedTon, it.receivedTon),
    })),
  };
}

function toDetailView(row: PurchaseOrderDetailRow) {
  const { items, ...head } = row;
  const totalOrderedTon = items.reduce((sum, it) => sum.add(it.orderedTon), ZERO);
  const totalReceivedTon = items.reduce((sum, it) => sum.add(it.receivedTon), ZERO);
  return {
    ...head,
    totalOrderedTon,
    totalReceivedTon,
    totalOutstandingTon: outstanding(totalOrderedTon, totalReceivedTon),
    items: items.map((it) => ({
      id: it.id,
      lineNo: it.lineNo,
      rawMaterial: rawMaterialView(it.rawMaterial),
      purchaseRequisitionItemId: it.purchaseRequisitionItemId,
      purchaseRequisition: it.purchaseRequisitionItem
        ? { id: it.purchaseRequisitionItem.purchaseRequisition.id, purchaseRequisitionNo: it.purchaseRequisitionItem.purchaseRequisition.purchaseRequisitionNo, lineNo: it.purchaseRequisitionItem.lineNo }
        : null,
      orderedTon: it.orderedTon,
      receivedTon: it.receivedTon,
      outstandingTon: outstanding(it.orderedTon, it.receivedTon),
      goodsReceipts: it.goodsReceipts.map((gr) => ({
        id: gr.id,
        goodsReceiptNo: gr.goodsReceiptNo,
        goodsReceiptStatus: gr.goodsReceiptStatus,
        receivedTon: gr.receivedTon,
        receiptDate: gr.receiptDate,
        confirmedAt: gr.confirmedAt,
        yard: gr.yard,
        lot: gr.lot,
      })),
    })),
  };
}
