import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import type { ActionDraftCreateResult, ActionDraftView, AuthUser } from '@fantasteel/shared';
import { CurrentUser } from '../../common/auth/auth.decorators';
import { ListActionDraftsQuery, UpdateActionDraftDto } from './dto/action-draft.dto';
import { MessageActionService } from './message-action.service';

/**
 * 라우팅·DTO 검증·권한만 둔다. 업무 로직 금지 (컨벤션 6장).
 * 경로는 API 명세서와 docs/backend/message-action.md. 리소스가 여러 개라 메서드마다 전체 경로를 쓴다 (예: @Get('sales-orders/:id')).
 * 전역 prefix /api/v1은 main.ts가 붙인다.
 * 기능 권한 데코레이터 없이 service가 확인한다(모듈 문서 3장): 생성은 방 멤버(API-251), 조회는 요청자 본인·방 멤버, 수정은 요청자 본인.
 */
@Controller()
export class MessageActionController {
  constructor(private readonly service: MessageActionService) {}

  @Post('messages/:id/action-drafts')
  create(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) messageId: number): Promise<ActionDraftCreateResult> {
    return this.service.create(user, messageId);
  }

  @Get('action-drafts')
  list(@CurrentUser() user: AuthUser, @Query() query: ListActionDraftsQuery): Promise<ActionDraftView[]> {
    return this.service.list(user, query);
  }

  @Get('action-drafts/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number): Promise<ActionDraftView> {
    return this.service.get(user, id);
  }

  @Patch('action-drafts/:id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateActionDraftDto): Promise<ActionDraftView> {
    return this.service.update(user, id, dto);
  }
}
