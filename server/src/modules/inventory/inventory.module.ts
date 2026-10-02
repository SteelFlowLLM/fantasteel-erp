import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryRepository } from './inventory.repository';
import { InventoryService } from './inventory.service';

/** 재고·예약·배정 (REQ-INV-001~009, BP-INV-01·02). 작업 안내: docs/backend/inventory.md */
@Module({
  controllers: [InventoryController],
  providers: [InventoryService, InventoryRepository],
})
export class InventoryModule {}
