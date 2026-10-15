import { Controller, Get, Query } from '@nestjs/common';
import type { AuthUser, ScheduleEventView } from '@fantasteel/shared';
import { CurrentUser } from '../../common/auth/auth.decorators';
import { ListScheduleEventsQuery } from './dto/schedule-event.dto';
import { ScheduleEventService } from './schedule-event.service';

/** 라우팅·DTO 검증만 둔다. 내 일정은 전 역할이라 권한 코드 없이 로그인만 본다 */
@Controller()
export class ScheduleEventController {
  constructor(private readonly service: ScheduleEventService) {}

  @Get('schedule-events')
  list(@CurrentUser() user: AuthUser, @Query() query: ListScheduleEventsQuery): Promise<ScheduleEventView[]> {
    return this.service.listMine(user, query);
  }
}
