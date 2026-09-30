import { Global, Module } from '@nestjs/common';
import { AllocationController } from './allocation.controller';
import { AllocationRepository } from './allocation.repository';
import { AllocationService } from './allocation.service';
import { InventoryController } from './inventory.controller';
import { InventoryRepository } from './inventory.repository';
import { InventoryService } from './inventory.service';
import { StockService } from './stock.service';

// StockService는 수주·생산·품질·출하가 함께 쓰므로 전역.
@Global()
@Module({
  controllers: [InventoryController, AllocationController],
  providers: [StockService, InventoryService, InventoryRepository, AllocationService, AllocationRepository],
  exports: [StockService],
})
export class InventoryModule {}
