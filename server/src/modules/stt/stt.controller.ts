import { Body, Controller, Get, HttpCode, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PERMISSION, STT_WAKE_CLIP_LIMITS, type AuthUser, type SteelmanWakeSettingsView, type SttConnectionView, type SttLocalServerActionView, type SttLocalServerView, type SttSettingsView, type SttTranscribeTestView, type SttWakeClipView } from '@fantasteel/shared';
import { CurrentUser, RequirePermission } from '../../common/auth/auth.decorators';
import { LocalServerActionDto, TestSttConnectionDto, UpdateSteelmanWakeSettingsDto, UpdateSttSettingsDto, WakeClipDto } from './dto/stt-settings.dto';
import { SttLocalServerService } from './stt-local-server.service';
import { SttService, type UploadedAudio } from './stt.service';

const AUDIO_TEST_MAX_BYTES = 100 * 1024 * 1024;

/**
 * 음성 인식(STT) 연결 설정 (문서에 없는 기능, Voice2ERP 1단계). 경로는 API 명세서에 없어 새로 정했다.
 * LLM 설정과 같이 설정 전용 권한 코드가 없어 부서·권한 관리(ORG_MANAGE)를 쓴다(가정).
 */
@Controller()
export class SttController {
  constructor(
    private readonly service: SttService,
    private readonly localServer: SttLocalServerService,
  ) {}

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

  /** 철강맨 부르기 회사 설정 (이슈 #457). 음성 설정과 같은 권한 */
  @Get('stt/wake-settings')
  @RequirePermission(PERMISSION.ORG_MANAGE, 'VIEW')
  getWakeSettings(): Promise<SteelmanWakeSettingsView> {
    return this.service.getWakeSettings();
  }

  @Put('stt/wake-settings')
  @RequirePermission(PERMISSION.ORG_MANAGE, 'USE')
  updateWakeSettings(@Body() dto: UpdateSteelmanWakeSettingsDto): Promise<SteelmanWakeSettingsView> {
    return this.service.updateWakeSettings(dto);
  }

  /**
   * 철강맨 부르기 (이슈 #457): 말소리 조각(16kHz WAV, 최대 8초) 하나를 글로. 설정 화면이 아니라 모든 사원이 쓰므로 권한 코드 없이 로그인만 본다.
   * 사원당 1분 횟수는 service가 막는다
   */
  @Post('stt/wake-clip')
  @HttpCode(200)
  // 가장 큰 종류(명령 덩어리)에 맞춰 받고, 종류별 크기·길이는 service가 본다 (이슈 #494)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: STT_WAKE_CLIP_LIMITS.commandMaxBytes, files: 1 } }))
  transcribeWakeClip(@CurrentUser() user: AuthUser, @UploadedFile() file: UploadedAudio | undefined, @Body() dto: WakeClipDto): Promise<SttWakeClipView> {
    return this.service.transcribeWakeClip(user, file, dto.mode ?? 'wake');
  }

  /** ERP 서버와 같은 Mac의 음성 서버(LaunchAgent) 상태 (이슈 #450). macOS가 아니면 supported: false */
  @Get('stt/local-server')
  @RequirePermission(PERMISSION.ORG_MANAGE, 'VIEW')
  getLocalServer(): Promise<SttLocalServerView> {
    return this.localServer.status();
  }

  /** 켜져 있으면 다시 켠다. 받아쓰는 중이면 confirmBusy 없이는 하지 않고 경고를 돌려준다 (이슈 #522) */
  @Post('stt/local-server/start')
  @HttpCode(200)
  @RequirePermission(PERMISSION.ORG_MANAGE, 'USE')
  startLocalServer(@Body() dto: LocalServerActionDto): Promise<SttLocalServerActionView> {
    return this.localServer.start(dto);
  }

  /** 지금만 끈다. 다음 로그인 때 다시 켜진다. 받아쓰는 중이면 다시 켜기와 같이 확인을 받는다 */
  @Post('stt/local-server/stop')
  @HttpCode(200)
  @RequirePermission(PERMISSION.ORG_MANAGE, 'USE')
  stopLocalServer(@Body() dto: LocalServerActionDto): Promise<SttLocalServerActionView> {
    return this.localServer.stop(dto);
  }
}
