import { forwardRef, Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductionModule } from '../production/production.module';
import { IdempotencyStore } from './idempotency.store';
import { SalesOrderController } from './sales-order.controller';
import { SalesOrderRepository } from './sales-order.repository';
import { SalesOrderService } from './sales-order.service';

/** 수주·충족 현황·수주 취소 (REQ-SO-001~006, BP-SO-01·02). 작업 안내: docs/backend/sales-order.md */
@Module({
  // shipment가 recalcItemStatus를 부르고 shipment ↔ inventory가 서로 부르는 순환이라 forwardRef
  imports: [forwardRef(() => InventoryModule), forwardRef(() => ProductionModule)],
  controllers: [SalesOrderController],
  providers: [SalesOrderService, SalesOrderRepository, IdempotencyStore],
  exports: [SalesOrderService],
})
export class SalesOrderModule {}
