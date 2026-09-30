import { Global, Module } from '@nestjs/common';
import { ShipmentModule } from '../shipment/shipment.module';
import { IdempotencyKeyRepository } from './idempotency-key.repository';
import { IdempotencyService } from './idempotency.service';
import { SalesOrderStatusService } from './sales-order-status.service';
import { SalesOrderController } from './sales-order.controller';
import { SalesOrderRepository } from './sales-order.repository';
import { SalesOrderService } from './sales-order.service';

// 상태 재계산은 출하·생산 모듈도 쓰므로 전역. 요청 고유키 처리(IdempotencyService)는 출고 확정도 쓴다.
// 수주 취소가 미출고 출하요청을 함께 취소하므로 ShipmentModule을 가져온다.
@Global()
@Module({
  imports: [ShipmentModule],
  controllers: [SalesOrderController],
  providers: [SalesOrderStatusService, SalesOrderService, SalesOrderRepository, IdempotencyService, IdempotencyKeyRepository],
  exports: [SalesOrderStatusService, IdempotencyService],
})
export class SalesOrderModule {}
