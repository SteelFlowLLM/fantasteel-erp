import { forwardRef, Module } from '@nestjs/common';
import { AiAssistantModule } from '../ai-assistant/ai-assistant.module';
import { IntegrationModule } from '../integration/integration.module';
import { LlmModule } from '../llm/llm.module';
import { NotificationModule } from '../notification/notification.module';
import { AiResearchController } from './ai-research.controller';
import { ResearchErpLookup } from './ai-research.erp';
import { AiResearchRepository } from './ai-research.repository';
import { AiResearchRunner } from './ai-research.runner';
import { AiResearchService } from './ai-research.service';

/** 철강맨AI 심층 조사 (이슈 #378, docs/backend/ai-research.md). 웹 검색·페이지 읽기는 ai-assistant의 웹 도구(같은 캐시·한도·SSRF 막기)를, ERP 자료는 철강맨AI의 조회 도구(이슈 #435)를 쓴다 */
@Module({
  imports: [LlmModule, forwardRef(() => AiAssistantModule), NotificationModule, IntegrationModule],
  controllers: [AiResearchController],
  providers: [AiResearchService, AiResearchRepository, AiResearchRunner, ResearchErpLookup],
  // 철강맨AI의 심층 조사 카드(이슈 #408)가 조사를 만든다
  exports: [AiResearchService],
})
export class AiResearchModule {}
