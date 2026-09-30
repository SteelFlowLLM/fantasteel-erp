import { Injectable } from '@nestjs/common';
import type { SalesOrderItemStatus } from '@fantasteel/shared';
import { RealtimeService } from '../../common/realtime/realtime.service';
import type { Tx } from '../../prisma/prisma.service';

/** 수주 품목 상태 재계산. 헤더 상태는 저장하지 않고 품목 상태에서 계산한다 (REQ-SO-005). */
@Injectable()
export class SalesOrderStatusService {
  constructor(private readonly realtime: RealtimeService) {}

  /**
   * 출고·생산계획 변화 뒤에 호출한다.
   * SHIPPED: 전량 출고 / PARTIALLY_SHIPPED: 일부 출고 / IN_PROGRESS: 생산계획이 있음(취소 제외) / 그 외 REGISTERED.
   */
  async recalcItem(tx: Tx, salesOrderItemId: number): Promise<SalesOrderItemStatus> {
    const item = await tx.salesOrderItem.findUniqueOrThrow({ where: { id: salesOrderItemId } });
    if (item.salesOrderItemStatus === 'CANCELLED') return 'CANCELLED';
    let status: SalesOrderItemStatus;
    if (item.shippedQty >= item.orderedQty) status = 'SHIPPED';
    else if (item.shippedQty > 0) status = 'PARTIALLY_SHIPPED';
    else {
      // 생산계획이 한 번이라도 있었으면(취소 제외) 진행 중으로 본다. 계획이 끝났다고 접수로 되돌리지 않는다
      const openPlans = await tx.productionPlan.count({ where: { salesOrderItemId, productionPlanStatus: { not: 'CANCELLED' } } });
      status = openPlans > 0 ? 'IN_PROGRESS' : 'REGISTERED';
    }
    if (status !== item.salesOrderItemStatus) {
      await tx.salesOrderItem.update({ where: { id: item.id }, data: { salesOrderItemStatus: status } });
      this.realtime.changed('sales-orders');
    }
    return status;
  }
}
