import { Body, Controller, Get, HttpCode, Logger, Post, Res } from '@nestjs/common';
import type { AiActionCardExecuteResult, AiAssistantCapabilitiesView, AiAssistantReplyView, AiAssistantStreamEvent, AiAssistantSuggestedQuestionsView, AuthUser } from '@fantasteel/shared';
import type { Response } from 'express';
import { LlmAbortedError, LlmRequestError } from '../llm/llm.client';
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
  private readonly logger = new Logger(AiAssistantController.name);

  constructor(private readonly service: AiAssistantService) {}

  /** API-262. 대화가 저장되지 않아 새로 만드는 자원이 없으므로 200 */
  @Post('ai-assistant/messages')
  @HttpCode(200)
  ask(@CurrentUser() user: AuthUser, @Body() dto: AskAiAssistantDto): Promise<AiAssistantReplyView> {
    return this.service.ask(user, dto);
  }

  /**
   * API-262의 실시간 판 (문서에 없는 기능, 2026-10-16 추가). 생각 글·도구 호출·답 글을 한 줄에 JSON 하나씩(NDJSON) 보낸다.
   * 모델 미설정·없는 회의록처럼 시작 전에 알 수 있는 오류는 평소 API 오류로 돌려주고, 시작한 뒤의 실패는 error 이벤트로 보낸다.
   * 브라우저가 연결을 끊으면(멈추기) LLM 요청도 끊는다.
   */
  @Post('ai-assistant/messages/stream')
  async askStream(@CurrentUser() user: AuthUser, @Body() dto: AskAiAssistantDto, @Res() res: Response): Promise<void> {
    const prepared = await this.service.prepare(user, dto, { interactive: true });
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });
    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    // 프록시가 모아 보내지 않게 한다
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const write = (event: AiAssistantStreamEvent) => {
      if (!res.writableEnded && !abort.signal.aborted) res.write(`${JSON.stringify(event)}\n`);
    };
    try {
      write({ type: 'done', reply: await prepared.run(write, abort.signal) });
    } catch (error) {
      if (error instanceof LlmAbortedError) return;
      if (error instanceof LlmRequestError) {
        this.logger.warn(`AI 어시스턴트 LLM 호출 실패: ${error.message}`);
        write({ type: 'error', message: error.message });
      } else {
        this.logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
        write({ type: 'error', message: '답을 만드는 중에 문제가 생겼어요. 잠시 뒤 다시 물어봐 주세요' });
      }
    } finally {
      res.end();
    }
  }

  /** 지금 모델이 사진·생각 정도를 지원하는지, 웹 검색 엔진·장소 검색·브라우저 사용을 쓸 수 있는지 (문서에 없는 기능, 2026-10-16 추가, 이슈 #367·#373) */
  @Get('ai-assistant/capabilities')
  capabilities(): Promise<AiAssistantCapabilitiesView> {
    return this.service.capabilities();
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
