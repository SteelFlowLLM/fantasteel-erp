import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import type { AuthUser } from '@fantasteel/shared';
import { CurrentUser } from '../../common/auth/auth.decorators';
import { ActionDraftService } from './action-draft.service';
import { CreateActionDraftDto, ListActionDraftsDto, RejectActionDraftDto, UpdateActionDraftDto } from './dto/action-draft.dto';

// 필요한 권한이 업무 유형마다 달라 권한 데코레이터 대신 service가 유형 정의의 requiredPermission으로 검사한다.
@Controller()
export class ActionDraftController {
  constructor(private readonly service: ActionDraftService) {}

  @Post('messages/:id/action-drafts')
  create(@Param('id', ParseIntPipe) messageId: number, @Body() dto: CreateActionDraftDto, @CurrentUser() user: AuthUser) {
    return this.service.createFromMessage(messageId, dto.actionType, user);
  }

  @Get('action-drafts')
  list(@Query() q: ListActionDraftsDto, @CurrentUser() user: AuthUser) {
    return this.service.list(q, user);
  }

  @Get('action-drafts/:id')
  detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.detail(id, user);
  }

  @Patch('action-drafts/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateActionDraftDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto.payload, user);
  }

  @Post('action-drafts/:id/confirm')
  @HttpCode(200)
  confirm(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.confirm(id, user);
  }

  @Post('action-drafts/:id/reject')
  @HttpCode(200)
  reject(@Param('id', ParseIntPipe) id: number, @Body() dto: RejectActionDraftDto, @CurrentUser() user: AuthUser) {
    return this.service.reject(id, dto.rejectReason, user);
  }
}
