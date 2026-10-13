import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { AiAssistantReplyView, AiAssistantSuggestedQuestionsView, AuthUser } from '@fantasteel/shared';
import { CurrentUser } from '../../common/auth/auth.decorators';
import { AskAiAssistantDto } from './dto/ai-assistant.dto';
import { AiAssistantService } from './ai-assistant.service';

/**
 * 라우팅·DTO 검증만 둔다. 경로는 API 명세서(API-262·263), 전역 prefix /api/v1은 main.ts가 붙인다.
 * 두 API 모두 권한 없음(로그인만): 데이터 조회·실행은 다음 단계에서 사용자 권한 범위로 막는다.
 */
@Controller()
export class AiAssistantController {
  constructor(private readonly service: AiAssistantService) {}

  /** API-262. 대화가 저장되지 않아 새로 만드는 자원이 없으므로 200 */
  @Post('ai-assistant/messages')
  @HttpCode(200)
  ask(@CurrentUser() user: AuthUser, @Body() dto: AskAiAssistantDto): Promise<AiAssistantReplyView> {
    return this.service.ask(user, dto);
  }

  /** API-263 */
  @Get('ai-assistant/suggested-questions')
  suggestedQuestions(@CurrentUser() user: AuthUser): AiAssistantSuggestedQuestionsView {
    return this.service.suggestedQuestions(user);
  }
}
