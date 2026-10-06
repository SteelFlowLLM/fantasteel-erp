import { forwardRef, Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { HotRollingService } from './hot-rolling.service';
import { ProductionController } from './production.controller';
import { ProductionResultRepository } from './production-result.repository';
import { ProductionResultService } from './production-result.service';
import { ProductionRepository } from './production.repository';
import { ProductionService } from './production.service';

/** 생산계획·히트 편성·작업 실적·실적 시뮬레이션·재생산 (REQ-PRD-001~004·006·007, BP-PRD-01·02, BP-SEED-01). 작업 안내: docs/backend/production.md */
@Module({
  // inventory → shipment → sales-order → production 순환 import라 forwardRef
  imports: [forwardRef(() => InventoryModule)],
  controllers: [ProductionController],
  providers: [ProductionService, ProductionRepository, ProductionResultService, ProductionResultRepository, HotRollingService],
  exports: [ProductionService],
})
export class ProductionModule {}
