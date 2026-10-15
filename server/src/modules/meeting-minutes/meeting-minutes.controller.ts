import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MEETING_AUDIO_MAX_BYTES, type AuthUser, type MeetingMinutesPage, type MeetingMinutesView } from '@fantasteel/shared';
import { CurrentUser } from '../../common/auth/auth.decorators';
import { CreateMeetingMinutesAudioDto, CreateMeetingMinutesDto, ListMeetingMinutesQuery } from './dto/meeting-minutes.dto';
import { MeetingMinutesService, type UploadedMeetingAudio } from './meeting-minutes.service';

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

  /**
   * 음성으로 만든다. 명세의 API-258은 JSON 한 개라 multipart와 본문이 달라 경로를 나눴다(2026-10-15 결정).
   * 전사는 응답 뒤 백그라운드로 돈다. 용량을 넘으면 multer가 끝까지 읽지 않고 413으로 끊는다.
   */
  @Post('audio')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MEETING_AUDIO_MAX_BYTES, files: 1 } }))
  createFromAudio(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateMeetingMinutesAudioDto,
    @UploadedFile() file: UploadedMeetingAudio | undefined,
  ): Promise<MeetingMinutesView> {
    return this.service.createFromAudio(user, dto, file);
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
