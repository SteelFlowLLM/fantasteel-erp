import { Module } from '@nestjs/common';
import { BusinessEventModule } from '../business-event/business-event.module';
import { InventoryModule } from '../inventory/inventory.module';
import { LlmModule } from '../llm/llm.module';
import { LotModule } from '../lot/lot.module';
import { ProductionModule } from '../production/production.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { QualityModule } from '../quality/quality.module';
import { SalesOrderModule } from '../sales-order/sales-order.module';
import { ShipmentModule } from '../shipment/shipment.module';
import { AiAssistantController } from './ai-assistant.controller';
import { AiAssistantRepository } from './ai-assistant.repository';
import { AiAssistantService } from './ai-assistant.service';
import { AssistantToolbox } from './tools/assistant-toolbox';

/** AI 어시스턴트 (REQ-AST, docs/backend/ai-assistant.md). 조회 도구는 각 모듈의 조회 service를 쓴다 */
@Module({
  imports: [LlmModule, InventoryModule, SalesOrderModule, ProductionModule, LotModule, QualityModule, PurchasingModule, ShipmentModule, BusinessEventModule],
  controllers: [AiAssistantController],
  providers: [AiAssistantService, AiAssistantRepository, AssistantToolbox],
})
export class AiAssistantModule {}
