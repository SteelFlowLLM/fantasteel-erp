import { Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import type { AuthUser, NotificationPage, NotificationReadAllResult, NotificationView } from '@fantasteel/shared';
import { CurrentUser } from '../../common/auth/auth.decorators';
import { ListNotificationsQuery } from './dto/notification.dto';
import { NotificationService } from './notification.service';

/**
 * 라우팅·DTO 검증·권한만 둔다. 업무 로직 금지 (컨벤션 6장).
 * 경로는 API 명세서와 docs/backend/notification.md. 리소스가 여러 개라 메서드마다 전체 경로를 쓴다 (예: @Get('sales-orders/:id')).
 * 전역 prefix /api/v1은 main.ts가 붙인다. 업무·알림은 전 역할이라 권한 코드 없이 로그인만 본다.
 */
@Controller()
export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  /** API-242. 내 알림만 */
  @Get('notifications')
  listNotifications(@CurrentUser() user: AuthUser, @Query() query: ListNotificationsQuery): Promise<NotificationPage> {
    return this.service.list(user, query);
  }

  /** 명세에 없는 임시 API (2026-10-07 사용자 결정). 상태 변경 액션 URL (컨벤션 5장, chat-rooms/:id/read와 같은 모양) */
  @Post('notifications/read-all')
  @HttpCode(200)
  readAllNotifications(@CurrentUser() user: AuthUser): Promise<NotificationReadAllResult> {
    return this.service.readAll(user);
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  readNotification(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number): Promise<NotificationView> {
    return this.service.read(user, id);
  }
}
