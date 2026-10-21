import { Module } from '@nestjs/common';
import { SttClient } from './stt.client';
import { SttController } from './stt.controller';
import { SttLocalServerService } from './stt-local-server.service';
import { SttService } from './stt.service';
import { SttSettingsStore } from './stt-settings.store';
import { SttWakeLimiter } from './stt-wake-limiter';
import { SteelmanWakeSettingsStore } from './steelman-wake-settings.store';

/** 음성 인식 연결 (whisper.cpp·OpenAI 호환). 회의록 음성 등록이 SttClient·SttSettingsStore를, 철강맨AI가 철강맨 부르기 회사 설정을 가져다 쓴다 */
@Module({
  controllers: [SttController],
  providers: [SttService, SttClient, SttSettingsStore, SttLocalServerService, SttWakeLimiter, SteelmanWakeSettingsStore],
  exports: [SttClient, SttSettingsStore, SteelmanWakeSettingsStore],
})
export class SttModule {}
