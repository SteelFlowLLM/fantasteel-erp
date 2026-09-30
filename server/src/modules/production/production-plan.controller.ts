import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { PERMISSION, type AuthUser } from '@fantasteel/shared';
import { CurrentUser, RequireUse, RequireView } from '../../common/auth/auth.decorators';
import { CancelProductionPlanDto } from './dto/cancel-production-plan.dto';
import { CreateReproductionPlanDto, ReproductionPreviewDto } from './dto/create-reproduction-plan.dto';
import { HeatPlanDto } from './dto/heat-plan.dto';
import { ListProductionPlansDto } from './dto/list-production-plans.dto';
import { SimulateResultsDto } from './dto/simulate-results.dto';
import { ProductionPlanService } from './production-plan.service';
import { ResultSimulationService } from './result-simulation.service';

@Controller('production-plans')
export class ProductionPlanController {
  constructor(
    private readonly service: ProductionPlanService,
    private readonly simulation: ResultSimulationService,
  ) {}

  @Get() @RequireView(PERMISSION.PLAN_CONFIRM)
  list(@Query() q: ListProductionPlansDto) {
    return this.service.list(q);
  }

  /** 재생산 전 확인 (추가 필요 매수·가용 재고·여재). `:id`보다 위에 둔다. */
  @Get('reproduction-preview') @RequireView(PERMISSION.PLAN_CONFIRM)
  reproductionPreview(@Query() q: ReproductionPreviewDto) {
    return this.service.reproductionPreview(q.salesOrderItemId);
  }

  @Get(':id') @RequireView(PERMISSION.PLAN_CONFIRM)
  get(@Param('id', ParseIntPipe) id: number) {
    return this.service.get(id);
  }

  /** 재생산 계획 생성 (REQ-PRD-006). */
  @Post() @RequireUse(PERMISSION.PLAN_CONFIRM)
  createReproduction(@Body() dto: CreateReproductionPlanDto, @CurrentUser() user: AuthUser) {
    return this.service.createReproduction(dto, user);
  }

  /** 히트 편성 미리보기 (저장하지 않음). */
  @Post(':id/heat-preview') @HttpCode(200) @RequireView(PERMISSION.PLAN_CONFIRM)
  heatPreview(@Param('id', ParseIntPipe) id: number, @Body() dto: HeatPlanDto) {
    return this.service.heatPreview(id, dto);
  }

  @Post(':id/confirm') @HttpCode(200) @RequireUse(PERMISSION.PLAN_CONFIRM)
  confirm(@Param('id', ParseIntPipe) id: number, @Body() dto: HeatPlanDto, @CurrentUser() user: AuthUser) {
    return this.service.confirm(id, dto, user);
  }

  @Post(':id/cancel') @HttpCode(200) @RequireUse(PERMISSION.PLAN_CONFIRM)
  cancel(@Param('id', ParseIntPipe) id: number, @Body() dto: CancelProductionPlanDto, @CurrentUser() user: AuthUser) {
    return this.service.cancel(id, dto, user);
  }

  /** 실적 시뮬레이션 (REQ-PRD-007): 남은 공정을 시스템이 끝까지 만든다. */
  @Post(':id/simulate-results') @HttpCode(200) @RequireUse(PERMISSION.RESULT_CONFIRM)
  simulate(@Param('id', ParseIntPipe) id: number, @Body() dto: SimulateResultsDto, @CurrentUser() user: AuthUser) {
    return this.simulation.simulate(id, dto, user);
  }
}
