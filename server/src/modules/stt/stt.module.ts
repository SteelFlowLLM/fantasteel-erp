import { Module } from '@nestjs/common';
import { SttClient } from './stt.client';
import { SttController } from './stt.controller';
import { SttLocalServerService } from './stt-local-server.service';
import { SttService } from './stt.service';
import { SttSettingsStore } from './stt-settings.store';

/** 음성 인식 연결 (whisper.cpp·OpenAI 호환). 회의록 음성 등록이 SttClient·SttSettingsStore를 가져다 쓴다 */
@Module({
  controllers: [SttController],
  providers: [SttService, SttClient, SttSettingsStore, SttLocalServerService],
  exports: [SttClient, SttSettingsStore],
})
export class SttModule {}
