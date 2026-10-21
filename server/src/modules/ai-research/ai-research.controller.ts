import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, Patch, Post, Put, Query, StreamableFile, type PipeTransform } from '@nestjs/common';
import type { AiResearchCapabilities, AiResearchNotionExportResult, AiResearchPlanSuggestion, AiResearchReportVersionView, AiResearchRunSummaryView, AiResearchRunView, AiResearchScheduleView, AuthUser, PageResult } from '@fantasteel/shared';
import { CurrentUser } from '../../common/auth/auth.decorators';
import { AppException } from '../../common/errors/app.exception';
import { INT4_MAX, AiResearchPdfQuery, CreateAiResearchRunDto, ExportAiResearchNotionDto, GetAiResearchRunQuery, ListAiResearchRunsQuery, CreateAiResearchRevisionDto, RenameAiResearchRunDto, SetAiResearchScheduleDto, StartAiResearchRunDto, SuggestAiResearchPlanDto, UpdateAiResearchPlanDto } from './dto/ai-research.dto';
import { AiResearchService } from './ai-research.service';

/**
 * 철강맨AI 심층 조사 (이슈 #378, 문서에 없는 기능). 권한 코드 없이 로그인만 본다: ERP 데이터를 읽지 않고, 자기 조사만 다룬다(service가 확인).
 * 진행은 소켓이 아니라 화면이 GET runs/:id?afterSeq=로 2초쯤마다 받아 간다(회의록 AI 정리와 같은 방식).
 */
/** 조사 id: 1~int4 상한의 정수만. 아니면 없는 조사(RES-001) — 넘는 값이 DB 오류(500)가 되지 않게 */
@Injectable()
export class ResearchRunIdPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    const id = /^\d{1,10}$/.test(value) ? Number(value) : NaN;
    if (!Number.isInteger(id) || id < 1 || id > INT4_MAX) throw new AppException('RES-001');
    return id;
  }
}

@Controller()
export class AiResearchController {
  constructor(private readonly service: AiResearchService) {}

  @Get('ai-research/capabilities')
  capabilities(): Promise<AiResearchCapabilities> {
    return this.service.capabilities();
  }

  @Post('ai-research/runs')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAiResearchRunDto): Promise<AiResearchRunView> {
    return this.service.create(user, dto);
  }

  @Get('ai-research/runs')
  list(@CurrentUser() user: AuthUser, @Query() query: ListAiResearchRunsQuery): Promise<PageResult<AiResearchRunSummaryView>> {
    return this.service.list(user, query);
  }

  @Get('ai-research/runs/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ResearchRunIdPipe) id: number, @Query() query: GetAiResearchRunQuery): Promise<AiResearchRunView> {
    return this.service.get(user, id, query.afterSeq ?? 0);
  }

  @Put('ai-research/runs/:id/plan')
  updatePlan(@CurrentUser() user: AuthUser, @Param('id', ResearchRunIdPipe) id: number, @Body() dto: UpdateAiResearchPlanDto): Promise<AiResearchRunView> {
    return this.service.updatePlan(user, id, dto.revision, dto.plan);
  }

  /** 계획을 말로 고치기 (이슈 #416): 고친 계획을 돌려주기만 하고 저장하지 않는다 */
  @Post('ai-research/runs/:id/plan/suggest')
  @HttpCode(200)
  suggestPlan(@CurrentUser() user: AuthUser, @Param('id', ResearchRunIdPipe) id: number, @Body() dto: SuggestAiResearchPlanDto): Promise<AiResearchPlanSuggestion> {
    return this.service.suggestPlan(user, id, dto);
  }

  @Patch('ai-research/runs/:id/title')
  rename(@CurrentUser() user: AuthUser, @Param('id', ResearchRunIdPipe) id: number, @Body() dto: RenameAiResearchRunDto): Promise<AiResearchRunView> {
    return this.service.rename(user, id, dto.revision, dto.title);
  }

  @Post('ai-research/runs/:id/rerun')
  rerun(@CurrentUser() user: AuthUser, @Param('id', ResearchRunIdPipe) id: number): Promise<AiResearchRunView> {
    return this.service.rerun(user, id);
  }

  @Post('ai-research/runs/:id/start')
  @HttpCode(200)
  start(@CurrentUser() user: AuthUser, @Param('id', ResearchRunIdPipe) id: number, @Body() dto: StartAiResearchRunDto): Promise<AiResearchRunView> {
    return this.service.start(user, id, dto.revision);
  }

  @Post('ai-research/runs/:id/extend')
  @HttpCode(200)
  extend(@CurrentUser() user: AuthUser, @Param('id', ResearchRunIdPipe) id: number): Promise<AiResearchRunView> {
    return this.service.extend(user, id);
  }

  /** 보고서를 말로 고치기 (이슈 #418): 부탁을 저장하고 다시 줄에 세운다. 고친 보고서는 판으로 남는다 */
  @Post('ai-research/runs/:id/revisions')
  @HttpCode(200)
  revise(@CurrentUser() user: AuthUser, @Param('id', ResearchRunIdPipe) id: number, @Body() dto: CreateAiResearchRevisionDto): Promise<AiResearchRunView> {
    return this.service.revise(user, id, dto.instruction, dto.search ?? true);
  }

  /** 보고서 판 하나 (본문·차트) */
  @Get('ai-research/runs/:id/versions/:version')
  getVersion(@CurrentUser() user: AuthUser, @Param('id', ResearchRunIdPipe) id: number, @Param('version', ResearchRunIdPipe) version: number): Promise<AiResearchReportVersionView> {
    return this.service.getVersion(user, id, version);
  }

  /** 보고서 PDF (이슈 #521). ?version=이 없으면 지금 보고서. 응답 포맷으로 감싸지 않고 파일 그대로 보낸다 */
  @Get('ai-research/runs/:id/pdf')
  async reportPdf(@CurrentUser() user: AuthUser, @Param('id', ResearchRunIdPipe) id: number, @Query() query: AiResearchPdfQuery): Promise<StreamableFile> {
    const { fileName, content } = await this.service.reportPdf(user, id, query.version);
    return new StreamableFile(content, {
      type: 'application/pdf',
      // 한글 이름은 filename*로, 옛 브라우저용 이름은 영문으로
      disposition: `attachment; filename="research-${id}.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      length: content.length,
    });
  }

  /** Notion 내보내기. version을 주면 그 판, 없으면 지금 판. 다시 내보내면 새 페이지를 만든다 (이슈 #521) */
  @Post('ai-research/runs/:id/notion-export')
  @HttpCode(200)
  exportToNotion(@CurrentUser() user: AuthUser, @Param('id', ResearchRunIdPipe) id: number, @Body() dto: ExportAiResearchNotionDto): Promise<AiResearchNotionExportResult> {
    return this.service.exportToNotion(user, id, dto.version);
  }

  /** 내 반복 목록 (이슈 #521) */
  @Get('ai-research/schedules')
  listSchedules(@CurrentUser() user: AuthUser): Promise<AiResearchScheduleView[]> {
    return this.service.listSchedules(user);
  }

  /** 반복 걸기·바꾸기 (이슈 #521). 반복이 만든 조사면 그 반복을 바꾼다 */
  @Put('ai-research/runs/:id/schedule')
  setSchedule(@CurrentUser() user: AuthUser, @Param('id', ResearchRunIdPipe) id: number, @Body() dto: SetAiResearchScheduleDto): Promise<AiResearchScheduleView> {
    return this.service.setSchedule(user, id, dto);
  }

  /** 반복 끄기 (지우지 않고 꺼 둔다) */
  @Delete('ai-research/runs/:id/schedule')
  disableSchedule(@CurrentUser() user: AuthUser, @Param('id', ResearchRunIdPipe) id: number): Promise<AiResearchScheduleView> {
    return this.service.disableSchedule(user, id);
  }

  @Post('ai-research/runs/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ResearchRunIdPipe) id: number): Promise<AiResearchRunView> {
    return this.service.cancel(user, id);
  }
}
