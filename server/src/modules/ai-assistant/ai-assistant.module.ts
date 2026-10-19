import { Module } from '@nestjs/common';
import { BusinessEventModule } from '../business-event/business-event.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { IntegrationModule } from '../integration/integration.module';
import { InventoryModule } from '../inventory/inventory.module';
import { LlmModule } from '../llm/llm.module';
import { MeetingMinutesModule } from '../meeting-minutes/meeting-minutes.module';
import { MessageActionModule } from '../message-action/message-action.module';
import { MrpModule } from '../mrp/mrp.module';
import { NotificationModule } from '../notification/notification.module';
import { PastCaseModule } from '../past-case/past-case.module';
import { LotModule } from '../lot/lot.module';
import { ProductionModule } from '../production/production.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { ScheduleEventModule } from '../schedule-event/schedule-event.module';
import { NotionAssistantService } from '../integration/notion/notion-assistant.service';
import { GoogleDriveService } from '../integration/google-drive/google-drive.service';
import { AssistantDriveToolbox } from './drive/assistant-drive-toolbox';
import { QualityModule } from '../quality/quality.module';
import { SalesOrderModule } from '../sales-order/sales-order.module';
import { ShipmentModule } from '../shipment/shipment.module';
import { AiActionCardService } from './ai-action-card.service';
import { AiOpsCardService } from './ai-ops-card.service';
import { AiUpdateCardService } from './ai-update-card.service';
import { AiNotionCardService } from './notion/ai-notion-card.service';
import { AssistantNotionToolbox } from './notion/assistant-notion-toolbox';
import { AiAssistantController } from './ai-assistant.controller';
import { AiAssistantRepository } from './ai-assistant.repository';
import { AiAssistantService } from './ai-assistant.service';
import { AssistantToolbox } from './tools/assistant-toolbox';
import { AssistantWebToolbox, defaultWebToolDeps } from './web/assistant-web-toolbox';
import { AssistantBrowserToolbox } from './browser/assistant-browser-toolbox';
import { BrowserPool } from './browser/browser-pool';
import { AssistantScreenToolbox, ScreenActionBroker } from './screen/assistant-screen-toolbox';

/** AI 어시스턴트 (REQ-AST, docs/backend/ai-assistant.md). 조회 도구는 각 모듈의 조회 service를 쓴다. 웹 도구는 web/ (이슈 #367), 브라우저 도구는 browser/ (이슈 #373) */
@Module({
  imports: [
    IntegrationModule,
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
    // 불합격률·수율·출하 실적·원료 소요처럼 묶은 숫자는 대시보드·MRP 계산을 그대로 쓴다
    DashboardModule,
    MrpModule,
    // 실행 카드가 업무·알림·구매요청 초안을 만든다 (REQ-AST-005)
    NotificationModule,
    MessageActionModule,
    // 내 일정 조회·일정 고치기 카드가 일정 화면과 같은 service를 쓴다 (이슈 #398)
    ScheduleEventModule,
  ],
  controllers: [AiAssistantController],
  providers: [
    AiAssistantService,
    AiAssistantRepository,
    AssistantToolbox,
    AiActionCardService,
    AiOpsCardService,
    AiUpdateCardService,
    AiNotionCardService,
    // Notion 도구(이슈 #398): 읽기는 IntegrationModule의 NotionAssistantService, 쓰기 카드는 AiNotionCardService
    { provide: AssistantNotionToolbox, useFactory: (notion: NotionAssistantService, cards: AiNotionCardService) => new AssistantNotionToolbox(notion, cards), inject: [NotionAssistantService, AiNotionCardService] },
    // Drive 도구(이슈 #398 2단계): 회사 Drive 폴더 읽기는 IntegrationModule의 GoogleDriveService
    { provide: AssistantDriveToolbox, useFactory: (drive: GoogleDriveService) => new AssistantDriveToolbox(drive), inject: [GoogleDriveService] },
    // 웹 도구(이슈 #367): 검색 캐시·1분 한도·SSRF를 막는 연결을 서버에 하나만 둔다. 시험은 가짜 의존성을 넣어 따로 만든다
    { provide: AssistantWebToolbox, useFactory: () => new AssistantWebToolbox(defaultWebToolDeps()) },
    // 브라우저 사용(이슈 #373): Chrome 하나를 서버에 두고(처음 쓸 때 띄움) 답마다 새 컨텍스트를 빌린다. 서버가 꺼질 때 닫는다
    { provide: AssistantBrowserToolbox, useFactory: () => new AssistantBrowserToolbox(new BrowserPool()) },
    // ERP 화면 조작(이슈 #382, 시험 중): 화면 동작을 기다리는 자리를 서버 메모리에 하나만 둔다
    { provide: AssistantScreenToolbox, useFactory: () => new AssistantScreenToolbox(new ScreenActionBroker()) },
  ],
  // 심층 조사(이슈 #378)가 같은 웹 검색 클라이언트(캐시·1분 한도)와 페이지 읽기(SSRF 막기·동시 4개)를 쓴다
  exports: [AiAssistantService, AssistantWebToolbox],
})
export class AiAssistantModule {}
