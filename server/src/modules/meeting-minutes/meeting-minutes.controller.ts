import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import type { AuthUser, MeetingMinutesPage, MeetingMinutesView } from '@fantasteel/shared';
import { CurrentUser } from '../../common/auth/auth.decorators';
import { CreateMeetingMinutesDto, ListMeetingMinutesQuery } from './dto/meeting-minutes.dto';
import { MeetingMinutesService } from './meeting-minutes.service';

/**
 * 라우팅·DTO 검증·권한만 둔다. 업무 로직 금지 (컨벤션 6장).
 * 경로는 API 명세서(API-258·259)와 docs/backend/meeting-minutes.md. 회의록은 전 역할이라 권한 코드 없이 로그인만 본다.
 */
@Controller('meeting-minutes')
export class MeetingMinutesController {
  constructor(private readonly service: MeetingMinutesService) {}

  /** API-258. 글로 붙여 넣은 전사로 회의록을 만든다 */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateMeetingMinutesDto): Promise<MeetingMinutesView> {
    return this.service.create(user, dto);
  }

  /** API-259 목록 */
  @Get()
  list(@Query() query: ListMeetingMinutesQuery): Promise<MeetingMinutesPage> {
    return this.service.list(query);
  }

  /** API-259 상세 */
  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number): Promise<MeetingMinutesView> {
    return this.service.get(id);
  }
}
