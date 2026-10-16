import { Module } from '@nestjs/common';
import { BusinessEventModule } from '../business-event/business-event.module';
import { InventoryModule } from '../inventory/inventory.module';
import { LlmModule } from '../llm/llm.module';
import { MeetingMinutesModule } from '../meeting-minutes/meeting-minutes.module';
import { PastCaseModule } from '../past-case/past-case.module';
import { LotModule } from '../lot/lot.module';
import { MessageActionModule } from '../message-action/message-action.module';
import { ProductionModule } from '../production/production.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { QualityModule } from '../quality/quality.module';
import { ScheduleEventModule } from '../schedule-event/schedule-event.module';
import { SalesOrderModule } from '../sales-order/sales-order.module';
import { ShipmentModule } from '../shipment/shipment.module';
import { AiAssistantController } from './ai-assistant.controller';
import { AssistantApprovalRegistry } from './approval/approval.registry';
import { AssistantActionRunner } from './approval/assistant-action.runner';
import { AiAssistantRepository } from './ai-assistant.repository';
import { AiAssistantService } from './ai-assistant.service';
import { AssistantToolbox } from './tools/assistant-toolbox';
import { AssistantWriteToolbox } from './tools/assistant-write-toolbox';

/**
 * AI 어시스턴트 (REQ-AST, docs/backend/ai-assistant.md). 조회 도구는 각 모듈의 조회 service를 쓰고,
 * 쓰기 도구(승인 카드)는 내 일정(schedule-event)·구매요청 초안(message-action) service를 쓴다
 */
@Module({
  imports: [
    LlmModule,
    InventoryModule,
    SalesOrderModule,
    ProductionModule,
    LotModule,
    QualityModule,
    PurchasingModule,
    ShipmentModule,
    BusinessEventModule,
    MeetingMinutesModule,
    PastCaseModule,
    ScheduleEventModule,
    MessageActionModule,
  ],
  controllers: [AiAssistantController],
  providers: [AiAssistantService, AiAssistantRepository, AssistantToolbox, AssistantWriteToolbox, AssistantApprovalRegistry, AssistantActionRunner],
  exports: [AiAssistantService],
})
export class AiAssistantModule {}
