import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import type { AuthUser, NotificationPage, NotificationReadAllResult, NotificationView, PageResult, TaskView } from '@fantasteel/shared';
import { CurrentUser } from '../../common/auth/auth.decorators';
import { ListNotificationsQuery } from './dto/notification.dto';
import { CreateTaskDto, ListTasksQuery } from './dto/task.dto';
import { NotificationService } from './notification.service';
import { TaskService } from './task.service';

/**
 * 라우팅·DTO 검증·권한만 둔다. 업무 로직 금지 (컨벤션 6장).
 * 경로는 API 명세서와 docs/backend/notification.md. 리소스가 여러 개라 메서드마다 전체 경로를 쓴다 (예: @Get('sales-orders/:id')).
 * 전역 prefix /api/v1은 main.ts가 붙인다. 업무·알림은 전 역할이라 권한 코드 없이 로그인만 본다.
 */
@Controller()
export class NotificationController {
  constructor(
    private readonly service: NotificationService,
    private readonly tasks: TaskService,
  ) {}

  /** API-239. 내 담당 업무만 */
  @Get('tasks')
  listTasks(@CurrentUser() user: AuthUser, @Query() query: ListTasksQuery): Promise<PageResult<TaskView>> {
    return this.tasks.list(user, query);
  }

  /** API-240 */
  @Post('tasks')
  createTask(@CurrentUser() user: AuthUser, @Body() dto: CreateTaskDto): Promise<TaskView> {
    return this.tasks.create(user, dto);
  }

  /** API-241. 담당자 본인인지 service가 확인한다 */
  @Post('tasks/:id/complete')
  @HttpCode(200)
  completeTask(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number): Promise<TaskView> {
    return this.tasks.complete(user, id);
  }

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
