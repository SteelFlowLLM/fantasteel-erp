import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { PastCaseController } from './past-case.controller';
import { PastCaseRepository } from './past-case.repository';
import { PastCaseService } from './past-case.service';

/** 과거 사례 (EX, docs/backend/past-case.md). AI 어시스턴트의 사례 검색 도구가 PastCaseService를 쓴다 */
@Module({
  imports: [LlmModule],
  controllers: [PastCaseController],
  providers: [PastCaseService, PastCaseRepository],
  exports: [PastCaseService],
})
export class PastCaseModule {}
