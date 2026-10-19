import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MEETING_AUDIO_MAX_BYTES, type AuthUser, type MeetingMinutesPage, type MeetingRegisterResult, type MeetingMinutesView, type MeetingNotionExportResult } from '@fantasteel/shared';
import { CurrentUser } from '../../common/auth/auth.decorators';
import { CreateMeetingMinutesAudioDto, CreateMeetingMinutesDto, CreateMeetingMinutesFromDriveDto, ListMeetingMinutesQuery, UpdateMeetingCandidateDto, UpdateMeetingSpeakersDto, UpdateMeetingSummaryDto } from './dto/meeting-minutes.dto';
import { MeetingMinutesService, type UploadedMeetingAudio } from './meeting-minutes.service';

/**
 * 라우팅·DTO 검증·권한만 둔다. 업무 로직 금지 (컨벤션 6장).
 * 경로는 API 명세서(API-258·259·260)와 docs/backend/meeting-minutes.md. 회의록은 전 역할이라 권한 코드 없이 로그인만 본다.
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

  /**
   * 회사 Google Drive 폴더의 녹음으로 만든다 (이슈 #361, 문서에 없는 경로). 음성 올리기와 같은 권한(로그인)·같은 전사 작업을 쓴다.
   * 파일 확인(폴더·종류·크기)까지 하고 바로 돌려주며, 받기와 전사는 응답 뒤 백그라운드로 돈다.
   */
  @Post('audio/from-drive')
  createFromDrive(@CurrentUser() user: AuthUser, @Body() dto: CreateMeetingMinutesFromDriveDto): Promise<MeetingMinutesView> {
    return this.service.createFromDrive(user, dto);
  }

  /** API-260. 작성자가 AI 정리를 시킨다. 바로 ANALYZING 상세를 돌려주고 분석은 백그라운드로 돈다 */
  @Post(':id/analyze')
  analyze(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number): Promise<MeetingMinutesView> {
    return this.service.analyze(user, id);
  }

  /** API-261 확인 단계. 작성자가 후보를 고치고 허가·제외한다 */
  @Patch(':id/candidates/:key')
  updateCandidate(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Param('key') key: string, @Body() dto: UpdateMeetingCandidateDto): Promise<MeetingMinutesView> {
    return this.service.updateCandidate(user, id, key, dto);
  }

  /** 검토 중 AI 요약을 작성자가 고친다 */
  @Patch(':id/summary')
  updateSummary(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMeetingSummaryDto): Promise<MeetingMinutesView> {
    return this.service.updateSummary(user, id, dto);
  }

  /** 화자 이름표를 회의 참석자에게 연결한다 (Voice2ERP 묶음 1). 작성자만 */
  @Patch(':id/speakers')
  updateSpeakers(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMeetingSpeakersDto): Promise<MeetingMinutesView> {
    return this.service.updateSpeakers(user, id, dto);
  }

  /** API-261. 허가한 후보를 등록하고 회의록을 확정한다 */
  @Post(':id/register')
  @HttpCode(200)
  register(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number): Promise<MeetingRegisterResult> {
    return this.service.register(user, id);
  }

  /** 확정한 회의록을 Notion 페이지로 내보낸다 (이슈 #358, 문서에 없는 경로). 작성자나 관리자만, 한 번만 */
  @Post(':id/notion-export')
  @HttpCode(200)
  exportToNotion(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number): Promise<MeetingNotionExportResult> {
    return this.service.exportToNotion(user, id);
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
