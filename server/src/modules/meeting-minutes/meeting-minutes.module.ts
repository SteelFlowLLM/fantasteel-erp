import { Module } from '@nestjs/common';
import { MeetingMinutesController } from './meeting-minutes.controller';
import { MeetingMinutesRepository } from './meeting-minutes.repository';
import { MeetingTranscriptionRunner } from './meeting-transcription.runner';
import { IntegrationModule } from '../integration/integration.module';
import { LlmModule } from '../llm/llm.module';
import { MeetingAnalysisRunner } from './meeting-analysis.runner';
import { MeetingCandidateContextService } from './meeting-candidate.context';
import { MessageActionModule } from '../message-action/message-action.module';
import { NotificationModule } from '../notification/notification.module';
import { SttModule } from '../stt/stt.module';
import { MeetingMinutesService } from './meeting-minutes.service';
import { MeetingSpeakerSuggester } from './meeting-speaker-suggest';

/** Voice2ERP 회의록 (REQ-VOC-002, BP-VOC-01). 작업 안내: docs/backend/meeting-minutes.md */
@Module({
  imports: [SttModule, LlmModule, NotificationModule, MessageActionModule, IntegrationModule],
  controllers: [MeetingMinutesController],
  providers: [MeetingMinutesService, MeetingMinutesRepository, MeetingTranscriptionRunner, MeetingAnalysisRunner, MeetingCandidateContextService, MeetingSpeakerSuggester],
  // AI 어시스턴트가 회의 질문에 쓰려고 상세 읽기(get)만 부른다
  exports: [MeetingMinutesService],
})
export class MeetingMinutesModule {}
