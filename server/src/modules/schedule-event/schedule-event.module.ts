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
})
export class ScheduleEventModule {}
