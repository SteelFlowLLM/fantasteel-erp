import { Body, Controller, Get, HttpCode, Injectable, Param, Post, Put, Query, type PipeTransform } from '@nestjs/common';
import type { AiResearchCapabilities, AiResearchNotionExportResult, AiResearchRunSummaryView, AiResearchRunView, AuthUser, PageResult } from '@fantasteel/shared';
import { CurrentUser } from '../../common/auth/auth.decorators';
import { AppException } from '../../common/errors/app.exception';
import { INT4_MAX, CreateAiResearchRunDto, GetAiResearchRunQuery, ListAiResearchRunsQuery, StartAiResearchRunDto, UpdateAiResearchPlanDto } from './dto/ai-research.dto';
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

  @Post('ai-research/runs/:id/notion-export')
  @HttpCode(200)
  exportToNotion(@CurrentUser() user: AuthUser, @Param('id', ResearchRunIdPipe) id: number): Promise<AiResearchNotionExportResult> {
    return this.service.exportToNotion(user, id);
  }

  @Post('ai-research/runs/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ResearchRunIdPipe) id: number): Promise<AiResearchRunView> {
    return this.service.cancel(user, id);
  }
}
