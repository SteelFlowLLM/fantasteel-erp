import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { AiActionCardExecuteResult, AiAssistantReplyView, AiAssistantSuggestedQuestionsView, AuthUser } from '@fantasteel/shared';
import { CurrentUser } from '../../common/auth/auth.decorators';
import { AskAiAssistantDto, ExecuteAiActionCardDto } from './dto/ai-assistant.dto';
import { AiAssistantService } from './ai-assistant.service';

/**
 * 라우팅·DTO 검증만 둔다. 경로는 API 명세서(API-262·263), 전역 prefix /api/v1은 main.ts가 붙인다.
 * 질문·추천 질문은 권한 없음(로그인만): 데이터는 도구마다 사용자 권한 범위로 막는다. 실행 카드 실행은 업무·일정·구매요청 초안을 만드는
 * 로그인한 사용자 본인의 작업이다(구매요청은 구매요청 등록 권한을 service가 확인한다).
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

  /** 🟡 명세에 없는 API (REQ-AST-005 실행 카드). 업무·일정·구매요청 초안이 만들어지므로 201 */
  @Post('ai-assistant/action-cards/execute')
  executeActionCard(@CurrentUser() user: AuthUser, @Body() dto: ExecuteAiActionCardDto): Promise<AiActionCardExecuteResult> {
    return this.service.executeActionCard(user, dto);
  }
}
