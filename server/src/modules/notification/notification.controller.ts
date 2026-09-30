import { Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import type { AuthUser } from '@fantasteel/shared';
import { CurrentUser } from '../../common/auth/auth.decorators';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { NotificationService } from './notification.service';

// 내 알림만 다룬다. 로그인한 누구나 쓰므로 권한 데코레이터는 없다.
@Controller('notifications')
export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  @Get()
  list(@Query() q: ListNotificationsDto, @CurrentUser() user: AuthUser) {
    return this.service.listMine(q, user);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.service.unreadCount(user);
  }

  @Post('read-all') @HttpCode(200)
  readAll(@CurrentUser() user: AuthUser) {
    return this.service.markAllRead(user);
  }

  @Post(':id/read') @HttpCode(200)
  read(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.markRead(id, user);
  }
}
