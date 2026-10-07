import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { PERMISSION, type LlmChatTestView, type LlmConnectionView, type LlmSettingsView } from '@fantasteel/shared';
import { RequirePermission } from '../../common/auth/auth.decorators';
import { TestLlmConnectionDto, UpdateLlmSettingsDto } from './dto/llm-settings.dto';
import { LlmService } from './llm.service';

/**
 * LLM 연결 설정 (문서에 없는 기능, 2026-10-07 추가). 경로는 API 명세서에 없어 새로 정했다.
 * 설정 전용 권한 코드가 없어 부서·권한 관리(ORG_MANAGE)를 쓴다(가정): 관리자만 바꾼다.
 * 연결 확인도 서버가 입력한 주소로 요청을 보내므로 사용 권한으로 막는다.
 */
@Controller()
export class LlmController {
  constructor(private readonly service: LlmService) {}

  @Get('llm/settings')
  @RequirePermission(PERMISSION.ORG_MANAGE, 'VIEW')
  getSettings(): Promise<LlmSettingsView> {
    return this.service.getSettings();
  }

  @Put('llm/settings')
  @RequirePermission(PERMISSION.ORG_MANAGE, 'USE')
  updateSettings(@Body() dto: UpdateLlmSettingsDto): Promise<LlmSettingsView> {
    return this.service.updateSettings(dto);
  }

  @Post('llm/connection-test')
  @HttpCode(200)
  @RequirePermission(PERMISSION.ORG_MANAGE, 'USE')
  testConnection(@Body() dto: TestLlmConnectionDto): Promise<LlmConnectionView> {
    return this.service.testConnection(dto);
  }

  @Post('llm/chat-test')
  @HttpCode(200)
  @RequirePermission(PERMISSION.ORG_MANAGE, 'USE')
  testChat(): Promise<LlmChatTestView> {
    return this.service.testChat();
  }
}
