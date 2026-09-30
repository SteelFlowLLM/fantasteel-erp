import { Injectable } from '@nestjs/common';
import type { AuthUser, EventReasonCode } from '@fantasteel/shared';
import { NumberingService } from '../../common/numbering/numbering.service';
import { RealtimeService } from '../../common/realtime/realtime.service';
import type { Tx } from '../../prisma/prisma.service';
import { BusinessEventRecorder } from '../business-event/business-event.recorder';
import { StockService } from '../inventory/stock.service';
import { NotificationSender } from '../notification/notification.sender';

/**
 * 다른 모듈(수주 등록·취소)이 생산계획을 만들거나 취소할 때 쓰는 최소 쓰기 함수.
 * 히트 편성·실적·재생산 등 나머지 생산 로직은 production 모듈의 service에 둔다.
 */
@Injectable()
export class ProductionPlanWriter {
  constructor(
    private readonly numbering: NumberingService,
    private readonly events: BusinessEventRecorder,
    private readonly notifications: NotificationSender,
    private readonly stock: StockService,
    private readonly realtime: RealtimeService,
  ) {}

  /** 수주 품목의 부족 매수로 생산계획(PLANNED)을 만들고 수주 품목과 연결한다 (REQ-PRD-001). */
  async createForShortage(
    tx: Tx,
    input: { salesOrderItemId: number; shortageQty: number; actor: AuthUser | null; isReproduction?: boolean; reasonCode?: EventReasonCode; reason?: string },
  ) {
    const item = await tx.salesOrderItem.findUniqueOrThrow({
      where: { id: input.salesOrderItemId },
      include: { salesOrder: true, productSpec: { include: { steelGrade: true, item: true } } },
    });
    const plan = await tx.productionPlan.create({
      data: {
        productionPlanNo: await this.numbering.documentNo(tx, 'PP'),
        salesOrderItemId: item.id,
        productSpecId: item.productSpecId,
        steelGradeId: item.productSpec.steelGradeId,
        shortageQty: input.shortageQty,
        productionPlanStatus: 'PLANNED',
        isReproduction: input.isReproduction ?? false,
        createdEmployeeId: input.actor?.employeeId ?? null,
      },
    });
    const unit = item.productSpec.item.itemType === 'COIL' ? '개' : '매';
    await this.events.record(tx, {
      actor: input.actor,
      eventType: input.isReproduction ? 'REPRODUCTION_PLAN_CREATED' : 'PRODUCTION_PLAN_CREATED',
      targetType: 'PRODUCTION_PLAN',
      targetId: plan.id,
      targetNo: plan.productionPlanNo,
      salesOrderId: item.salesOrderId,
      summary: `${item.salesOrder.salesOrderNo} #${item.lineNo} 부족 ${input.shortageQty}${unit} ${input.isReproduction ? '재생산 계획' : '생산계획'} 생성`,
      after: { productionPlanNo: plan.productionPlanNo, shortageQty: input.shortageQty, productSpecId: item.productSpecId },
      reasonCode: input.reasonCode ?? 'ORDER_SHORTAGE',
      reason: input.reason ?? null,
    });
    await this.notifications.toRole(tx, 'PRODUCTION', {
      notificationType: 'PRODUCTION',
      title: `생산계획 ${plan.productionPlanNo} · 히트 편성 필요`,
      body: `${item.salesOrder.salesOrderNo} ${item.productSpec.steelGrade.steelGradeCode} 부족 ${input.shortageQty}${unit}`,
      linkPath: `/production/plans?plan=${plan.id}`,
      dedupeKey: `PLAN_CREATED:${plan.id}`,
      excludeEmployeeId: input.actor?.employeeId ?? null,
    });
    if (item.salesOrderItemStatus === 'REGISTERED') await tx.salesOrderItem.update({ where: { id: item.id }, data: { salesOrderItemStatus: 'IN_PROGRESS' } });
    this.realtime.changed('production-plans', 'sales-orders');
    return plan;
  }

  /**
   * 수주 취소 시 그 품목의 생산계획 처리 (REQ-SO-006, BP-SO-02).
   * - 시작 전(실적 없음) 계획: CANCELLED
   * - 생산 중 계획: 수주 연결을 끊는다(sales_order_item_id = null). 진행분은 완료·합격 후 슬래브 여재가 된다.
   *   이미 합격해 열연 투입용으로 잡아 둔 슬래브는 바로 여재로 돌린다.
   */
  async handleSalesOrderItemCancelled(tx: Tx, salesOrderItemId: number, actor: AuthUser | null): Promise<void> {
    const item = await tx.salesOrderItem.findUniqueOrThrow({ where: { id: salesOrderItemId }, include: { salesOrder: true } });
    const plans = await tx.productionPlan.findMany({
      where: { salesOrderItemId, productionPlanStatus: { in: ['PLANNED', 'CONFIRMED', 'IN_PROGRESS'] } },
      include: { productionResults: { where: { productionResultStatus: { in: ['STARTED', 'COMPLETED'] } }, select: { id: true } } },
    });
    for (const plan of plans) {
      // 열연 배정(CONFIRMED)은 해제한다. 귀속은 아래에서 한꺼번에 푼다.
      const allocs = await tx.allocation.findMany({ where: { productionPlanId: plan.id, status: 'CONFIRMED' } });
      for (const a of allocs) await this.stock.releaseAllocation(tx, a.id, { keepEarmark: true });
      if (!plan.productionResults.length) {
        await tx.productionPlan.update({ where: { id: plan.id }, data: { productionPlanStatus: 'CANCELLED', cancelledAt: new Date() } });
        await this.events.record(tx, {
          actor, eventType: 'PRODUCTION_PLAN_CANCELLED', targetType: 'PRODUCTION_PLAN', targetId: plan.id, targetNo: plan.productionPlanNo,
          salesOrderId: item.salesOrderId, summary: `수주 취소로 시작 전 생산계획 ${plan.productionPlanNo} 취소`, reasonCode: 'ORDER_CANCELLED',
          before: { productionPlanStatus: plan.productionPlanStatus }, after: { productionPlanStatus: 'CANCELLED' },
        });
      } else {
        await tx.productionPlan.update({ where: { id: plan.id }, data: { salesOrderItemId: null } });
        await this.events.record(tx, {
          actor, eventType: 'SURPLUS_CONVERTED', targetType: 'PRODUCTION_PLAN', targetId: plan.id, targetNo: plan.productionPlanNo,
          salesOrderId: item.salesOrderId, summary: `수주 취소: 생산 중 물량(${plan.productionPlanNo})은 완료 후 슬래브 여재로 전환`, reasonCode: 'SURPLUS_CONVERSION',
          before: { salesOrderItemId }, after: { salesOrderItemId: null },
        });
      }
    }
    // 이 수주 품목에 묶여 있던 미소진 LOT의 연결을 끊는다. 적격 귀속 슬래브는 재고 풀(여재)로 들어간다.
    const lots = await tx.lot.findMany({ where: { salesOrderItemId, lotStatus: 'IN_STOCK', lotType: { in: ['SLAB', 'COIL'] } }, include: { productSpec: { include: { item: true } } } });
    const itemSpec = await tx.productSpec.findUniqueOrThrow({ where: { id: item.productSpecId }, include: { item: true } });
    for (const lot of lots) {
      const earmarkedSlab = lot.lotType === 'SLAB' && itemSpec.item.itemType === 'COIL';
      if (earmarkedSlab) await this.stock.releaseEarmark(tx, lot.id);
      else await tx.lot.update({ where: { id: lot.id }, data: { salesOrderItemId: null } });
    }
    this.realtime.changed('production-plans', 'lots', 'inventories');
  }
}
