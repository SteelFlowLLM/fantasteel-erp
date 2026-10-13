import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { AiAssistantController } from './ai-assistant.controller';
import { AiAssistantService } from './ai-assistant.service';

/** AI 어시스턴트 (REQ-AST, docs/backend/ai-assistant.md) */
@Module({
  imports: [LlmModule],
  controllers: [AiAssistantController],
  providers: [AiAssistantService],
})
export class AiAssistantModule {}
