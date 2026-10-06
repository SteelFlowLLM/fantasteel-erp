import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { PERMISSION, type AuthUser, type HeatFormation, type PageResult, type ProductionPlanDetail, type ProductionPlanSummary, type HotRollingDetail, type ProductionResultView, type ReproductionResult, type SimulationResult, type WorkContext } from '@fantasteel/shared';
import { CurrentUser, RequirePermission } from '../../common/auth/auth.decorators';
import { AppException } from '../../common/errors/app.exception';
import { ConfirmHotRollingDto, ReleaseHotRollingDto } from './dto/hot-rolling.dto';
import { CancelProductionPlanDto, CreateReproductionPlanDto, ListProductionPlansDto } from './dto/production-plan.dto';
import { SimulateResultsDto } from './dto/simulation.dto';
import { CompleteProductionResultDto, ListProductionResultsDto, RegisterProductionResultDto } from './dto/production-result.dto';
import { HotRollingService } from './hot-rolling.service';
import { ProductionResultService } from './production-result.service';
import { ProductionSimulationService } from './production-simulation.service';
import { ProductionService } from './production.service';

const resultId = () => new ParseIntPipe({ exceptionFactory: () => new AppException('COM-004', '작업 실적 id는 정수여야 해요') });
const allocationId = () => new ParseIntPipe({ exceptionFactory: () => new AppException('COM-004', '배정 id는 정수여야 해요') });
const planId = () => new ParseIntPipe({ exceptionFactory: () => new AppException('COM-004', '생산계획 id는 정수여야 해요') });

/**
 * 라우팅·DTO 검증·권한만 둔다. 업무 로직 금지 (컨벤션 6장).
 * 경로는 API 명세서와 docs/backend/production.md. 리소스가 여러 개라 메서드마다 전체 경로를 쓴다.
 * 전역 prefix /api/v1은 main.ts가 붙인다.
 */
@Controller()
export class ProductionController {
  constructor(
    private readonly service: ProductionService,
    private readonly results: ProductionResultService,
    private readonly hotRolling: HotRollingService,
    private readonly simulation: ProductionSimulationService,
  ) {}

  /** 생산계획 목록 (API-200) */
  @Get('production-plans')
  @RequirePermission(PERMISSION.PRODUCTION_PLAN_CONFIRM, 'VIEW')
  listPlans(@Query() query: ListProductionPlansDto): Promise<PageResult<ProductionPlanSummary>> {
    return this.service.listPlans(query);
  }

  /** 재생산 계획 생성 (API-202): 일반 계획은 수주 등록 때 자동으로 생기므로 이 API는 재생산용 */
  @Post('production-plans')
  @RequirePermission(PERMISSION.PRODUCTION_PLAN_CONFIRM, 'USE')
  createReproductionPlan(@Body() dto: CreateReproductionPlanDto, @CurrentUser() user: AuthUser): Promise<ReproductionResult> {
    return this.service.createReproductionPlan(user, dto.salesOrderItemId);
  }

  /** 생산계획 상세 (API-201): 연결 수주 품목, 히트 편성표, 진행, 생산 LOT과 판정, 재생산 판단 */
  @Get('production-plans/:id')
  @RequirePermission(PERMISSION.PRODUCTION_PLAN_CONFIRM, 'VIEW')
  getPlan(@Param('id', planId()) id: number): Promise<ProductionPlanDetail> {
    return this.service.getPlanDetail(id);
  }

  /** 히트 편성 미리보기 (API-203): 저장하지 않는다 */
  @Post('production-plans/:id/heat-preview')
  @HttpCode(200)
  @RequirePermission(PERMISSION.PRODUCTION_PLAN_CONFIRM, 'USE')
  previewHeatPlan(@Param('id', planId()) id: number): Promise<HeatFormation> {
    return this.service.previewHeatPlan(id);
  }

  /** 히트 편성 확정 (API-204): 시작 전 계획의 히트 수를 지금 기준정보로 다시 계산해 저장 */
  @Post('production-plans/:id/confirm')
  @HttpCode(200)
  @RequirePermission(PERMISSION.PRODUCTION_PLAN_CONFIRM, 'USE')
  confirmHeatPlan(@Param('id', planId()) id: number): Promise<ProductionPlanDetail> {
    return this.service.confirmHeatPlan(id);
  }

  /** 생산계획 취소 (API-205): 계획(PLANNED) 상태에서만 */
  @Post('production-plans/:id/cancel')
  @HttpCode(200)
  @RequirePermission(PERMISSION.PRODUCTION_PLAN_CONFIRM, 'USE')
  cancelPlan(@Param('id', planId()) id: number, @Body() dto: CancelProductionPlanDto, @CurrentUser() user: AuthUser): Promise<ProductionPlanDetail> {
    return this.service.cancelPlan(user, id, dto);
  }

  /** 실적 입력 기준값: 수율·히트 용량, 쓸 수 있는 용선·원료 잔량, 연주 전 히트, 작업 중 실적 (API 명세서에 없어 추가) */
  @Get('production-plans/:id/work-context')
  @RequirePermission(PERMISSION.PRODUCTION_RESULT_CONFIRM, 'VIEW')
  workContext(@Param('id', planId()) id: number): Promise<WorkContext> {
    return this.results.workContext(id);
  }

  /** 작업 실적 목록 (API-207) */
  @Get('production-results')
  @RequirePermission(PERMISSION.PRODUCTION_RESULT_CONFIRM, 'VIEW')
  listResults(@Query() query: ListProductionResultsDto): Promise<PageResult<ProductionResultView>> {
    return this.results.listResults(query);
  }

  @Get('production-results/:id')
  @RequirePermission(PERMISSION.PRODUCTION_RESULT_CONFIRM, 'VIEW')
  getResult(@Param('id', resultId()) id: number): Promise<ProductionResultView> {
    return this.results.getResult(id);
  }

  /** 작업 실적 등록 (API-208): completedAt이 없으면 작업 시작만, 있으면 시작·완료를 한 번에 */
  @Post('production-results')
  @RequirePermission(PERMISSION.PRODUCTION_RESULT_CONFIRM, 'USE')
  registerResult(@Body() dto: RegisterProductionResultDto, @CurrentUser() user: AuthUser): Promise<ProductionResultView> {
    return this.results.register(user, dto);
  }

  /** 작업 완료·실적 등록 (API 목록 초안 행 API-101을 v1 경로로): 작업 시작으로 만든 실적을 마친다 */
  @Post('production-results/:id/complete')
  @HttpCode(200)
  @RequirePermission(PERMISSION.PRODUCTION_RESULT_CONFIRM, 'USE')
  completeResult(@Param('id', resultId()) id: number, @Body() dto: CompleteProductionResultDto, @CurrentUser() user: AuthUser): Promise<ProductionResultView> {
    return this.results.complete(user, id, dto);
  }

  /** 열연 투입 화면: 필요 매수, 대응 슬래브 재고, FIFO 후보, 배정, 만든 코일 (API 목록 초안 행 API-102를 생산 화면용으로) */
  @Get('production-plans/:id/hot-rolling')
  @RequirePermission(PERMISSION.HOT_ROLLING_ALLOCATE, 'VIEW')
  hotRollingDetail(@Param('id', planId()) id: number): Promise<HotRollingDetail> {
    return this.hotRolling.detail(id);
  }

  /** 열연 투입 FIFO 추천: 저장하지 않고 작업 로그만 (12.2 allocations/recommend의 열연 목적) */
  @Post('production-plans/:id/hot-rolling/recommend')
  @HttpCode(200)
  @RequirePermission(PERMISSION.HOT_ROLLING_ALLOCATE, 'USE')
  recommendHotRolling(@Param('id', planId()) id: number, @CurrentUser() user: AuthUser): Promise<HotRollingDetail> {
    return this.hotRolling.recommend(user, id);
  }

  /** 열연 투입 배정 확정 (API-103을 v1 경로로) */
  @Post('production-plans/:id/hot-rolling/allocations')
  @HttpCode(200)
  @RequirePermission(PERMISSION.HOT_ROLLING_ALLOCATE, 'USE')
  confirmHotRolling(@Param('id', planId()) id: number, @Body() dto: ConfirmHotRollingDto, @CurrentUser() user: AuthUser): Promise<HotRollingDetail> {
    return this.hotRolling.confirm(user, id, dto);
  }

  /** 열연 배정 해제·변경 (투입 전만) */
  @Post('production-plans/:id/hot-rolling/allocations/:allocationId/release')
  @HttpCode(200)
  @RequirePermission(PERMISSION.HOT_ROLLING_ALLOCATE, 'USE')
  releaseHotRolling(
    @Param('id', planId()) id: number,
    @Param('allocationId', allocationId()) allocationIdParam: number,
    @Body() dto: ReleaseHotRollingDto,
    @CurrentUser() user: AuthUser,
  ): Promise<HotRollingDetail> {
    return this.hotRolling.release(user, id, allocationIdParam, dto);
  }

  /** 실적 시뮬레이션 (API-209, BP-SEED-01): 계획을 골라 공정별 실적을 한 번에 만든다. 검사는 하지 않는다 */
  @Post('production-plans/:id/simulate-results')
  @HttpCode(200)
  @RequirePermission(PERMISSION.PRODUCTION_RESULT_CONFIRM, 'USE')
  simulate(@Param('id', planId()) id: number, @Body() dto: SimulateResultsDto, @CurrentUser() user: AuthUser): Promise<SimulationResult> {
    return this.simulation.simulate(user, id, dto);
  }
}
