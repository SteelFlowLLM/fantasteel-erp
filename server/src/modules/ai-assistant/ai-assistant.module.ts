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
import { AssistantBrowserToolbox } from './browser/assistant-browser-toolbox';
import { BrowserPool } from './browser/browser-pool';

/** AI 어시스턴트 (REQ-AST, docs/backend/ai-assistant.md). 조회 도구는 각 모듈의 조회 service를 쓴다. 웹 도구는 web/ (이슈 #367), 브라우저 도구는 browser/ (이슈 #373) */
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
    // 브라우저 사용(이슈 #373): Chrome 하나를 서버에 두고(처음 쓸 때 띄움) 답마다 새 컨텍스트를 빌린다. 서버가 꺼질 때 닫는다
    { provide: AssistantBrowserToolbox, useFactory: () => new AssistantBrowserToolbox(new BrowserPool()) },
  ],
  // 심층 조사(이슈 #378)가 같은 웹 검색 클라이언트(캐시·1분 한도)와 페이지 읽기(SSRF 막기·동시 4개)를 쓴다
  exports: [AiAssistantService, AssistantWebToolbox],
})
export class AiAssistantModule {}
