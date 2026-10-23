import { forwardRef, Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { SalesOrderModule } from '../sales-order/sales-order.module';
import { ShipmentController } from './shipment.controller';
import { ShipmentRepository } from './shipment.repository';
import { ShipmentService } from './shipment.service';

/** 출하요청·출고 확정·밀시트 (REQ-SHP-001~004, BP-SHP-01). 작업 안내: docs/backend/shipment.md */
@Module({
  // 출고 확정이 수주 품목 상태를 다시 계산한다(sales-order). sales-order → inventory → shipment 순환이라 forwardRef
  imports: [forwardRef(() => InventoryModule), forwardRef(() => SalesOrderModule)],
  controllers: [ShipmentController],
  providers: [ShipmentService, ShipmentRepository],
  // inventory가 배정 확정·해제 후 refreshAllocationStatus를 부른다
  exports: [ShipmentService],
})
export class ShipmentModule {}
