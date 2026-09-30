import { Global, Module } from '@nestjs/common';
import { QualityModule } from '../quality/quality.module';
import { ProductionMaterialService } from './production-material.service';
import { ProductionPlanProgressService } from './production-plan-progress.service';
import { ProductionPlanController } from './production-plan.controller';
import { ProductionPlanService } from './production-plan.service';
import { ProductionPlanWriter } from './production-plan.writer';
import { ProductionResultController } from './production-result.controller';
import { ProductionResultService } from './production-result.service';
import { ProductionRepository } from './production.repository';
import { ResultSimulationService } from './result-simulation.service';
import { YieldCalculator } from './yield.calculator';

// Writer·계산기는 수주·구매 모듈도 쓰고, 계획 진행 서비스는 품질 모듈(검사 판정 뒤 계획 완료 확인)이 쓰므로 전역.
// 실적 시뮬레이션이 검사 등록을 같은 코드 경로로 부르기 위해 QualityModule을 가져온다.
@Global()
@Module({
  imports: [QualityModule],
  controllers: [ProductionPlanController, ProductionResultController],
  providers: [
    ProductionPlanWriter, YieldCalculator, ProductionRepository, ProductionMaterialService, ProductionPlanProgressService,
    ProductionPlanService, ProductionResultService, ResultSimulationService,
  ],
  exports: [ProductionPlanWriter, YieldCalculator, ProductionPlanProgressService],
})
export class ProductionModule {}
