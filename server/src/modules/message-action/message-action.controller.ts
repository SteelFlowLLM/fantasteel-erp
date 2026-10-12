import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { PERMISSION, type ActionDraftView, type AuthUser } from '@fantasteel/shared';
import { CurrentUser, RequirePermission } from '../../common/auth/auth.decorators';
import { ListActionDraftsQuery } from './dto/action-draft.dto';
import { MessageActionService } from './message-action.service';

/**
 * 라우팅·DTO 검증·권한만 둔다. 업무 로직 금지 (컨벤션 6장).
 * 경로는 API 명세서와 docs/backend/message-action.md. 리소스가 여러 개라 메서드마다 전체 경로를 쓴다 (예: @Get('sales-orders/:id')).
 * 전역 prefix /api/v1은 main.ts가 붙인다.
 * 초안은 구매요청을 만드는 일이라 구매요청 등록 권한으로 본다(조회 VIEW). 방 멤버는 service가 확인한다.
 */
@Controller()
export class MessageActionController {
  constructor(private readonly service: MessageActionService) {}

  @Get('action-drafts')
  @RequirePermission(PERMISSION.PURCHASE_REQUISITION_CREATE, 'VIEW')
  list(@CurrentUser() user: AuthUser, @Query() query: ListActionDraftsQuery): Promise<ActionDraftView[]> {
    return this.service.list(user, query);
  }

  @Get('action-drafts/:id')
  @RequirePermission(PERMISSION.PURCHASE_REQUISITION_CREATE, 'VIEW')
  get(@Param('id', ParseIntPipe) id: number): Promise<ActionDraftView> {
    return this.service.get(id);
  }
}
