import { Body, Controller, Delete, Get, HttpCode, Injectable, Logger, Param, ParseUUIDPipe, Post, Query, Res, type PipeTransform } from '@nestjs/common';
import type {
  AiActionCardExecuteResult,
  AiAssistantCapabilitiesView,
  AiAssistantReplyView,
  AiAssistantStreamEvent,
  AiAssistantSuggestedQuestionsView,
  AiBrowserWindowView,
  AiChatThreadSummaryView,
  AiChatThreadView,
  AuthUser,
  PageResult,
} from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import type { Response } from 'express';
import { LlmAbortedError, LlmRequestError } from '../llm/llm.client';
import { CurrentUser } from '../../common/auth/auth.decorators';
import { AskAiAssistantDto, ExecuteAiActionCardDto, ListAiChatThreadsQuery, AgentControlDto, AgentInputDto, AgentNoteDto, BrowserWindowDto, ScreenActionResultDto, agentInputOf } from './dto/ai-assistant.dto';
import { AiAssistantService } from './ai-assistant.service';
import { AiChatThreadService } from './chat/ai-chat-thread.service';

/** 대화 id: 1~int4 상한의 정수만. 아니면 없는 대화(AST-001) — 넘는 값이 DB 오류(500)가 되지 않게 */
@Injectable()
export class ChatThreadIdPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    const id = /^\d{1,10}$/.test(value) ? Number(value) : NaN;
    if (!Number.isInteger(id) || id < 1 || id > 2147483647) throw new AppException('AST-001');
    return id;
  }
}

/**
 * 라우팅·DTO 검증만 둔다. 경로는 API 명세서(API-262·263), 전역 prefix /api/v1은 main.ts가 붙인다.
 * 질문·추천 질문은 권한 없음(로그인만): 데이터는 도구마다 사용자 권한 범위로 막는다. 실행 카드 실행은 업무·일정·구매요청 초안을 만드는
 * 로그인한 사용자 본인의 작업이다(구매요청은 구매요청 등록 권한을 service가 확인한다).
 */
@Controller()
export class AiAssistantController {
  private readonly logger = new Logger(AiAssistantController.name);

  constructor(
    private readonly service: AiAssistantService,
    private readonly chatThreads: AiChatThreadService,
  ) {}

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
      const reply = await prepared.run(write, abort.signal);
      // 저장은 답이 다 만들어진 뒤에 (실패·멈춘 질문은 저장하지 않는다, 이슈 #399)
      const thread = prepared.saveThread ? await prepared.saveThread(reply) : undefined;
      write({ type: 'done', reply, ...(thread !== undefined ? { thread } : {}) });
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

  /**
   * 화면 조작 결과 (문서에 없는 기능, 이슈 #382, 시험 중). 실시간 답이 보낸 ui_action을 사용자의 브라우저가 실행하고 결과를 돌려준다.
   * 그 답을 물은 사원만 보낼 수 있고 처음 온 결과만 쓴다. 기다리는 자리가 없으면 COM-003
   */
  @Post('ai-assistant/ui-actions/:actionId')
  @HttpCode(200)
  settleUiAction(@CurrentUser() user: AuthUser, @Param('actionId', new ParseUUIDPipe()) actionId: string, @Body() dto: ScreenActionResultDto): { accepted: true } {
    this.service.settleUiAction(user, actionId, dto);
    return { accepted: true };
  }

  /**
   * 답하는 동안 브라우저·화면 조작을 멈춤·한 단계·계속 (문서에 없는 기능, 이슈 #425). 그 답을 물은 사원만 보낼 수 있다.
   * 답하는 중인 열쇠가 없으면(이미 끝남) COM-003
   */
  @Post('ai-assistant/agent-control/:controlId')
  @HttpCode(200)
  controlAgent(@CurrentUser() user: AuthUser, @Param('controlId', new ParseUUIDPipe()) controlId: string, @Body() dto: AgentControlDto): { accepted: true } {
    this.service.controlAgent(user, controlId, dto.command);
    return { accepted: true };
  }

  /**
   * 멈춘 동안 사람이 실시간 화면을 눌러 서버 Chrome을 직접 조작 (문서에 없는 기능, 이슈 #433). 그 답을 물은 사원만 보낼 수 있고,
   * 브라우저를 쓰는 답이 동작 앞에서 멈춰 기다리는 중일 때만 받는다. 입력한 글은 저장하지도 로그에 남기지도 않는다
   */
  @Post('ai-assistant/agent-control/:controlId/input')
  @HttpCode(200)
  async humanInput(@CurrentUser() user: AuthUser, @Param('controlId', new ParseUUIDPipe()) controlId: string, @Body() dto: AgentInputDto): Promise<{ accepted: true }> {
    await this.service.humanInput(user, controlId, agentInputOf(dto));
    return { accepted: true };
  }

  /**
   * 답하는 중에 말 덧붙이기 (문서에 없는 기능, 이슈 #430). 서비스가 다음 모델 호출 앞에서 user 메시지로 넣는다.
   * 그 답을 물은 사원만 보낼 수 있고, 답하는 중인 열쇠가 없으면(이미 끝남) COM-003
   */
  @Post('ai-assistant/agent-control/:controlId/notes')
  @HttpCode(200)
  addAgentNote(@CurrentUser() user: AuthUser, @Param('controlId', new ParseUUIDPipe()) controlId: string, @Body() dto: AgentNoteDto): { accepted: true } {
    this.service.addAgentNote(user, controlId, dto.text);
    return { accepted: true };
  }

  /**
   * [브라우저 창 열기] (문서에 없는 기능, 이슈 #433). 이 대화 열쇠의 빈 브라우저 탭을 미리 열어 둔다. 서버 컴퓨터에 창이 뜨는 설정(BROWSER_HEADLESS=false)에서
   * 사람이 창의 주소창에 직접 넣어 옮긴 페이지를 다음 질문의 AI가 '지금 페이지'로 안다. 열쇠는 사원 번호와 묶여 남의 탭은 쓰지 않는다
   */
  @Post('ai-assistant/browser/window')
  @HttpCode(200)
  openBrowserWindow(@CurrentUser() user: AuthUser, @Body() dto: BrowserWindowDto): Promise<AiBrowserWindowView> {
    return this.service.openBrowserWindow(user, dto.browserSessionId);
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

  /** 저장한 대화 목록 (문서에 없는 기능, 이슈 #399). 내 대화만, 마지막으로 묻고 답한 순서 */
  @Get('ai-assistant/threads')
  listThreads(@CurrentUser() user: AuthUser, @Query() query: ListAiChatThreadsQuery): Promise<PageResult<AiChatThreadSummaryView>> {
    return this.chatThreads.list(user, query);
  }

  @Get('ai-assistant/threads/:id')
  getThread(@CurrentUser() user: AuthUser, @Param('id', ChatThreadIdPipe) id: number): Promise<AiChatThreadView> {
    return this.chatThreads.get(user, id);
  }

  /** 이 회의에 물은 내 대화 (문서에 없는 기능, 2026-10-21). 아직 묻지 않았으면 null. 지우기는 대화 지우기(DELETE threads/:id)를 쓴다 */
  @Get('ai-assistant/meeting-threads/:meetingMinutesId')
  getMeetingThread(@CurrentUser() user: AuthUser, @Param('meetingMinutesId', ChatThreadIdPipe) meetingMinutesId: number): Promise<AiChatThreadView | null> {
    return this.chatThreads.meetingThread(user, meetingMinutesId);
  }

  /** 대화와 메시지를 모두 지운다. 지운 대화의 목록 줄을 돌려준다 */
  @Delete('ai-assistant/threads/:id')
  deleteThread(@CurrentUser() user: AuthUser, @Param('id', ChatThreadIdPipe) id: number): Promise<AiChatThreadSummaryView> {
    return this.chatThreads.delete(user, id);
  }

  /** 🟡 명세에 없는 API (REQ-AST-005 실행 카드). 업무·일정·구매요청 초안이 만들어지므로 201 */
  @Post('ai-assistant/action-cards/execute')
  executeActionCard(@CurrentUser() user: AuthUser, @Body() dto: ExecuteAiActionCardDto): Promise<AiActionCardExecuteResult> {
    return this.service.executeActionCard(user, dto);
  }
}
