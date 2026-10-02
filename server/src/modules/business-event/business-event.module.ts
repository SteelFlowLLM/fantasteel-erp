import { Module } from '@nestjs/common';
import { BusinessEventController } from './business-event.controller';
import { BusinessEventRepository } from './business-event.repository';
import { BusinessEventService } from './business-event.service';

/** 작업 로그 조회·이력 재현 (REQ-LOG-001~003, BP-LOG-01). 기록은 common/business-event/business-event.recorder.ts. 작업 안내: docs/backend/business-event.md */
@Module({
  controllers: [BusinessEventController],
  providers: [BusinessEventService, BusinessEventRepository],
})
export class BusinessEventModule {}
