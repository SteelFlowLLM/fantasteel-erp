import { Module } from '@nestjs/common';
import { ScheduleEventController } from './schedule-event.controller';
import { ScheduleEventRepository } from './schedule-event.repository';
import { ScheduleEventService } from './schedule-event.service';

/** 내 일정 (Voice2ERP 6단계). 작업 안내: docs/backend/schedule-event.md */
@Module({
  controllers: [ScheduleEventController],
  providers: [ScheduleEventService, ScheduleEventRepository],
  // 철강맨AI 승인 카드(내 일정 추가)가 같은 등록 로직을 쓴다
  exports: [ScheduleEventService],
})
export class ScheduleEventModule {}
