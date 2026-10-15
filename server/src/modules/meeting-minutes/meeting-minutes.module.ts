import { Module } from '@nestjs/common';
import { MeetingMinutesController } from './meeting-minutes.controller';
import { MeetingMinutesRepository } from './meeting-minutes.repository';
import { MeetingMinutesService } from './meeting-minutes.service';

/** Voice2ERP 회의록 (REQ-VOC-002, BP-VOC-01). 작업 안내: docs/backend/meeting-minutes.md */
@Module({
  controllers: [MeetingMinutesController],
  providers: [MeetingMinutesService, MeetingMinutesRepository],
})
export class MeetingMinutesModule {}
