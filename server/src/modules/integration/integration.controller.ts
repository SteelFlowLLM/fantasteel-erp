import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PERMISSION, type AuthUser, type IntegrationConnectResult, type IntegrationConnectionView, type IntegrationTestResult, type NotionCalendarOption } from '@fantasteel/shared';
import { AuthTokenService } from '../../common/auth/auth-token.service';
import { CurrentUser, Public, RequirePermission } from '../../common/auth/auth.decorators';
import { UpdateIntegrationSettingsDto, UpdateNotionCalendarDto, type OAuthCallbackQuery } from './dto/integration.dto';
import { IntegrationService } from './integration.service';

/**
 * 외부 서비스 연결 (문서에 없는 기능, 2026-10-16 이슈 #358). 경로는 API 명세서에 없어 새로 정했다.
 * 설정 전용 권한 코드가 없어 LLM 연결처럼 부서·권한 관리(ORG_MANAGE)를 쓴다(가정): 관리자만 연결·설정한다.
 * 목록은 로그인만 본다: 회의록 화면이 Notion 내보내기 버튼을 보일지 정하려고 읽는다 (비밀값은 담지 않는다).
 */
@Controller()
export class IntegrationController {
  constructor(
    private readonly service: IntegrationService,
    private readonly tokens: AuthTokenService,
  ) {}

  @Get('integrations')
  list(): Promise<IntegrationConnectionView[]> {
    return this.service.list();
  }

  /**
   * OAuth 콜백. OAuth 서버가 브라우저를 돌려보내므로 로그인 쿠키가 없을 수 있어 공개로 두고, 저장해 둔 state로 확인한다.
   * 로그인 쿠키가 있으면 연결을 시작한 관리자인지 service가 본다. 응답은 JSON이 아니라 화면(관리 > 외부 연결)으로 보내는 302다.
   */
  @Public()
  @Get('integrations/oauth/callback')
  async callback(@Query() query: OAuthCallbackQuery, @Req() req: Request, @Res() res: Response): Promise<void> {
    const sessionEmployeeId = await this.tokens.verifyCookieHeader(req.headers.cookie);
    res.redirect(302, await this.service.handleCallback(query, sessionEmployeeId));
  }

  @Put('integrations/:providerKey/settings')
  @RequirePermission(PERMISSION.ORG_MANAGE, 'USE')
  updateSettings(@Param('providerKey') providerKey: string, @Body() dto: UpdateIntegrationSettingsDto): Promise<IntegrationConnectionView> {
    return this.service.updateSettings(providerKey, dto);
  }

  /** 허용 화면 주소를 돌려준다. 화면이 브라우저를 그 주소로 옮긴다 */
  @Post('integrations/:providerKey/connect')
  @HttpCode(200)
  @RequirePermission(PERMISSION.ORG_MANAGE, 'USE')
  connect(@CurrentUser() user: AuthUser, @Param('providerKey') providerKey: string): Promise<IntegrationConnectResult> {
    return this.service.connect(user, providerKey);
  }

  @Post('integrations/:providerKey/disconnect')
  @HttpCode(200)
  @RequirePermission(PERMISSION.ORG_MANAGE, 'USE')
  disconnect(@Param('providerKey') providerKey: string): Promise<IntegrationConnectionView> {
    return this.service.disconnect(providerKey);
  }

  /** Notion 업무 공간(일정·회의록·할 일 데이터베이스) 만들기 (이슈 #391). 이미 있으면 만들지 않는다 */
  @Post('integrations/notion/workspace')
  @HttpCode(200)
  @RequirePermission(PERMISSION.ORG_MANAGE, 'USE')
  setupNotionWorkspace(): Promise<IntegrationConnectionView> {
    return this.service.setupNotionWorkspace();
  }

  /** 회사 Notion 계정에 연결된 캘린더 (이슈 #391 2단계). 서버가 Notion에 물어보므로 사용 권한으로 막는다 */
  @Get('integrations/notion/calendars')
  @RequirePermission(PERMISSION.ORG_MANAGE, 'USE')
  listNotionCalendars(): Promise<NotionCalendarOption[]> {
    return this.service.listNotionCalendars();
  }

  /** 일정을 함께 만들 Notion 캘린더와 참석자 초대 여부 (이슈 #391 2단계) */
  @Put('integrations/notion/calendar')
  @RequirePermission(PERMISSION.ORG_MANAGE, 'USE')
  updateNotionCalendar(@Body() dto: UpdateNotionCalendarDto): Promise<IntegrationConnectionView> {
    return this.service.updateNotionCalendar(dto);
  }

  /** 저장된 연결로 도구 목록을 받아 본다. 서버가 외부로 요청을 보내므로 사용 권한으로 막는다 */
  @Post('integrations/:providerKey/test')
  @HttpCode(200)
  @RequirePermission(PERMISSION.ORG_MANAGE, 'USE')
  test(@Param('providerKey') providerKey: string): Promise<IntegrationTestResult> {
    return this.service.test(providerKey);
  }
}
