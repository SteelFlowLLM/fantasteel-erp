import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import type { ActionDraftCreateResult, ActionDraftExecutionResult, ActionDraftView, AgentCandidateExecutionResult, AgentCandidateView, AuthUser } from '@fantasteel/shared';
import { CurrentUser } from '../../common/auth/auth.decorators';
import { FactoryAgentService } from '../factory-agent/factory-agent.service';
import { ConfirmActionDraftDto, ListActionDraftsQuery, RejectActionDraftDto, UpdateActionDraftDto } from './dto/action-draft.dto';
import { MessageActionService } from './message-action.service';

/**
 * 라우팅·DTO 검증·권한만 둔다. 업무 로직 금지 (컨벤션 6장).
 * 경로는 API 명세서와 docs/backend/message-action.md. 리소스가 여러 개라 메서드마다 전체 경로를 쓴다 (예: @Get('sales-orders/:id')).
 * 전역 prefix /api/v1은 main.ts가 붙인다.
 * Agent 대응 후보(REQ-AGT-005·006)는 같은 경로로 들어와 factory-agent로 넘긴다(메시지 초안과 확정 주체·권한이 다르다).
 * 기능 권한 데코레이터 없이 service가 확인한다(모듈 문서 3장): 생성은 방 멤버(API-251), 조회는 요청자 본인·방 멤버, 수정·확정·반려는 요청자 본인.
 */
@Controller()
export class MessageActionController {
  constructor(
    private readonly service: MessageActionService,
    private readonly agent: FactoryAgentService,
  ) {}

  @Post('messages/:id/action-drafts')
  create(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) messageId: number): Promise<ActionDraftCreateResult> {
    return this.service.create(user, messageId);
  }

  @Get('action-drafts')
  list(@CurrentUser() user: AuthUser, @Query() query: ListActionDraftsQuery): Promise<ActionDraftView[] | AgentCandidateView[]> {
    return query.source === 'agent' ? this.agent.list(user) : this.service.list(user, query);
  }

  @Get('action-drafts/:id')
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number): Promise<ActionDraftView | AgentCandidateView> {
    return (await this.agent.findCandidate(user, id)) ?? this.service.get(user, id);
  }

  @Patch('action-drafts/:id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateActionDraftDto): Promise<ActionDraftView> {
    return this.service.update(user, id, dto);
  }

  /** API-255. 확정하고 바로 구매요청을 만든다 */
  @Post('action-drafts/:id/confirm')
  @HttpCode(200)
  async confirm(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: ConfirmActionDraftDto): Promise<ActionDraftExecutionResult | AgentCandidateExecutionResult> {
    return (await this.agent.isCandidate(id)) ? this.agent.confirm(user, id, dto.expectedUpdatedAt) : this.service.confirm(user, id, dto);
  }

  /** 명세에 없는 API: 확정했지만 구매요청을 만들지 못한 초안을 다시 실행한다 (모듈 문서 9장) */
  @Post('action-drafts/:id/execute')
  @HttpCode(200)
  async execute(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number): Promise<ActionDraftExecutionResult | AgentCandidateExecutionResult> {
    return (await this.agent.isCandidate(id)) ? this.agent.execute(user, id) : this.service.execute(user, id);
  }

  /** API-256 */
  @Post('action-drafts/:id/reject')
  @HttpCode(200)
  async reject(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: RejectActionDraftDto): Promise<ActionDraftView | AgentCandidateView> {
    return (await this.agent.isCandidate(id)) ? this.agent.reject(user, id, dto.rejectReason, dto.expectedUpdatedAt) : this.service.reject(user, id, dto);
  }
}
