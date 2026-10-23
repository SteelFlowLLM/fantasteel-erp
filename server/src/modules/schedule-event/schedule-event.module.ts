import { Module } from '@nestjs/common';
import { IntegrationModule } from '../integration/integration.module';
import { ScheduleEventController } from './schedule-event.controller';
import { ScheduleEventRepository } from './schedule-event.repository';
import { ScheduleEventService } from './schedule-event.service';

/** 내 일정 (Voice2ERP 6단계). 작업 안내: docs/backend/schedule-event.md */
@Module({
  imports: [IntegrationModule],
  controllers: [ScheduleEventController],
  providers: [ScheduleEventService, ScheduleEventRepository],
  // 철강맨AI가 내 일정 조회·일정 고치기 카드에 같은 규칙을 쓴다 (이슈 #398)
  exports: [ScheduleEventService],
})
export class ScheduleEventModule {}
