import { Body, Controller, Get, HttpCode, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PERMISSION, type SttConnectionView, type SttSettingsView, type SttTranscribeTestView } from '@fantasteel/shared';
import { RequirePermission } from '../../common/auth/auth.decorators';
import { TestSttConnectionDto, UpdateSttSettingsDto } from './dto/stt-settings.dto';
import { SttService, type UploadedAudio } from './stt.service';

const AUDIO_TEST_MAX_BYTES = 100 * 1024 * 1024;

/**
 * 음성 인식(STT) 연결 설정 (문서에 없는 기능, Voice2ERP 1단계). 경로는 API 명세서에 없어 새로 정했다.
 * LLM 설정과 같이 설정 전용 권한 코드가 없어 부서·권한 관리(ORG_MANAGE)를 쓴다(가정).
 */
@Controller()
export class SttController {
  constructor(private readonly service: SttService) {}

  @Get('stt/settings')
  @RequirePermission(PERMISSION.ORG_MANAGE, 'VIEW')
  getSettings(): Promise<SttSettingsView> {
    return this.service.getSettings();
  }

  @Put('stt/settings')
  @RequirePermission(PERMISSION.ORG_MANAGE, 'USE')
  updateSettings(@Body() dto: UpdateSttSettingsDto): Promise<SttSettingsView> {
    return this.service.updateSettings(dto);
  }

  @Post('stt/connection-test')
  @HttpCode(200)
  @RequirePermission(PERMISSION.ORG_MANAGE, 'USE')
  testConnection(@Body() dto: TestSttConnectionDto): Promise<SttConnectionView> {
    return this.service.testConnection(dto);
  }

  /** multipart: file(오디오 1개). 용량을 넘으면 multer가 끝까지 읽지 않고 413으로 끊는다 */
  @Post('stt/transcribe-test')
  @HttpCode(200)
  @RequirePermission(PERMISSION.ORG_MANAGE, 'USE')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: AUDIO_TEST_MAX_BYTES, files: 1 } }))
  testTranscribe(@UploadedFile() file: UploadedAudio | undefined): Promise<SttTranscribeTestView> {
    return this.service.testTranscribe(file);
  }
}
