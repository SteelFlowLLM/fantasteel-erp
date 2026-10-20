import { Module } from '@nestjs/common';
import { BrowserSettingsStore } from './browser-settings.store';
import { LlmClient } from './llm.client';
import { LlmController } from './llm.controller';
import { LlmService } from './llm.service';
import { LlmSettingsStore } from './llm-settings.store';

/** LLM 연결 (LM Studio·OpenAI 호환). AI 어시스턴트·Message → ERP 추출이 LlmService·LlmClient를 가져다 쓴다 */
@Module({
  controllers: [LlmController],
  providers: [LlmService, LlmClient, LlmSettingsStore, BrowserSettingsStore],
  exports: [LlmService, LlmClient, LlmSettingsStore, BrowserSettingsStore],
})
export class LlmModule {}
