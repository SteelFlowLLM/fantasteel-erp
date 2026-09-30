import { Module } from '@nestjs/common';
import { ApproverPolicy } from './approver.policy';
import { GoodsReceiptController } from './goods-receipt.controller';
import { GoodsReceiptRepository } from './goods-receipt.repository';
import { GoodsReceiptService } from './goods-receipt.service';
import { PurchaseOrderController } from './purchase-order.controller';
import { PurchaseOrderRepository } from './purchase-order.repository';
import { PurchaseOrderService } from './purchase-order.service';
import { PurchaseRequisitionActionHandler } from './purchase-requisition-action.handler';
import { ApprovalController, PurchaseRequisitionController } from './purchase-requisition.controller';
import { PurchaseRequisitionRepository } from './purchase-requisition.repository';
import { PurchaseRequisitionService } from './purchase-requisition.service';

// 구매요청·부서장 승인·발주·입고 (REQ-PUR-001~004). 실행 핸들러는 message-action 모듈이 가져다 쓴다.
@Module({
  controllers: [PurchaseRequisitionController, ApprovalController, PurchaseOrderController, GoodsReceiptController],
  providers: [
    ApproverPolicy,
    PurchaseRequisitionRepository, PurchaseRequisitionService, PurchaseRequisitionActionHandler,
    PurchaseOrderRepository, PurchaseOrderService,
    GoodsReceiptRepository, GoodsReceiptService,
  ],
  exports: [PurchaseRequisitionActionHandler],
})
export class PurchasingModule {}
