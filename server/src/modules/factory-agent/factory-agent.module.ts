import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { LlmModule } from '../llm/llm.module';
import { MrpModule } from '../mrp/mrp.module';
import { NotificationModule } from '../notification/notification.module';
import { OrganizationModule } from '../organization/organization.module';
import { ProductionModule } from '../production/production.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { FactoryAgentController } from './factory-agent.controller';
import { FactoryAgentRepository } from './factory-agent.repository';
import { FactoryAgentScheduler } from './factory-agent.scheduler';
import { FactoryAgentService } from './factory-agent.service';

/** AI Factory Agent 위험 감지·대응 후보 (REQ-AGT-001~006, BP-AGT-01). 작업 안내: docs/backend/factory-agent.md */
@Module({
  imports: [InventoryModule, LlmModule, MrpModule, NotificationModule, OrganizationModule, ProductionModule, PurchasingModule],
  controllers: [FactoryAgentController],
  providers: [FactoryAgentService, FactoryAgentRepository, FactoryAgentScheduler],
  // message-action이 초안 API를 Agent 후보로 넘기고, quality가 검사 등록 뒤 이벤트 트리거를 부른다
  exports: [FactoryAgentService],
})
export class FactoryAgentModule {}
