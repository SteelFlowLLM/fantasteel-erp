import { Module } from '@nestjs/common';
import { MeetingMinutesController } from './meeting-minutes.controller';
import { MeetingMinutesRepository } from './meeting-minutes.repository';
import { MeetingTranscriptionRunner } from './meeting-transcription.runner';
import { LlmModule } from '../llm/llm.module';
import { MeetingAnalysisRunner } from './meeting-analysis.runner';
import { SttModule } from '../stt/stt.module';
import { MeetingMinutesService } from './meeting-minutes.service';

/** Voice2ERP 회의록 (REQ-VOC-002, BP-VOC-01). 작업 안내: docs/backend/meeting-minutes.md */
@Module({
  imports: [SttModule, LlmModule],
  controllers: [MeetingMinutesController],
  providers: [MeetingMinutesService, MeetingMinutesRepository, MeetingTranscriptionRunner, MeetingAnalysisRunner],
})
export class MeetingMinutesModule {}
