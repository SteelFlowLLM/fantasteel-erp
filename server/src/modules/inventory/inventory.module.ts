import { forwardRef, Module } from '@nestjs/common';
import { ShipmentModule } from '../shipment/shipment.module';
import { InventoryController } from './inventory.controller';
import { InventoryRepository } from './inventory.repository';
import { InventoryService } from './inventory.service';

/** 재고·예약·배정 (REQ-INV-001~009, BP-INV-01·02). 작업 안내: docs/backend/inventory.md */
@Module({
  // 출하 배정을 바꾸면 출하요청 상태를 다시 계산하고(shipment), 출하요청 취소는 배정을 해제한다(inventory) → 서로 부른다
  imports: [forwardRef(() => ShipmentModule)],
  controllers: [InventoryController],
  providers: [InventoryService, InventoryRepository],
  exports: [InventoryService],
})
export class InventoryModule {}
