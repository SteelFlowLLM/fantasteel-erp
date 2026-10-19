import { Module } from '@nestjs/common';
import { BusinessEventModule } from '../business-event/business-event.module';
import { InventoryModule } from '../inventory/inventory.module';
import { LlmModule } from '../llm/llm.module';
import { MeetingMinutesModule } from '../meeting-minutes/meeting-minutes.module';
import { MessageActionModule } from '../message-action/message-action.module';
import { NotificationModule } from '../notification/notification.module';
import { PastCaseModule } from '../past-case/past-case.module';
import { LotModule } from '../lot/lot.module';
import { ProductionModule } from '../production/production.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { QualityModule } from '../quality/quality.module';
import { SalesOrderModule } from '../sales-order/sales-order.module';
import { ShipmentModule } from '../shipment/shipment.module';
import { AiActionCardService } from './ai-action-card.service';
import { AiOpsCardService } from './ai-ops-card.service';
import { AiAssistantController } from './ai-assistant.controller';
import { AiAssistantRepository } from './ai-assistant.repository';
import { AiAssistantService } from './ai-assistant.service';
import { AssistantToolbox } from './tools/assistant-toolbox';
import { AssistantWebToolbox, defaultWebToolDeps } from './web/assistant-web-toolbox';

/** AI 어시스턴트 (REQ-AST, docs/backend/ai-assistant.md). 조회 도구는 각 모듈의 조회 service를 쓴다. 웹 도구는 web/ (이슈 #367) */
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
    // 실행 카드가 업무·알림·구매요청 초안을 만든다 (REQ-AST-005)
    NotificationModule,
    MessageActionModule,
  ],
  controllers: [AiAssistantController],
  providers: [
    AiAssistantService,
    AiAssistantRepository,
    AssistantToolbox,
    AiActionCardService,
    AiOpsCardService,
    // 웹 도구(이슈 #367): 검색 캐시·1분 한도·SSRF를 막는 연결을 서버에 하나만 둔다. 시험은 가짜 의존성을 넣어 따로 만든다
    { provide: AssistantWebToolbox, useFactory: () => new AssistantWebToolbox(defaultWebToolDeps()) },
  ],
  exports: [AiAssistantService],
})
export class AiAssistantModule {}
