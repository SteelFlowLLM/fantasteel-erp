import { Module } from '@nestjs/common';
import { QualityInspectionController } from './quality-inspection.controller';
import { QualityInspectionService } from './quality-inspection.service';
import { QualityRepository } from './quality.repository';
import { RejectedLotController } from './rejected-lot.controller';
import { RejectedLotService } from './rejected-lot.service';

// QualityInspectionService.registerInspection(tx, …)은 실적 시뮬레이션(production 모듈)도 쓴다.
@Module({
  controllers: [QualityInspectionController, RejectedLotController],
  providers: [QualityInspectionService, RejectedLotService, QualityRepository],
  exports: [QualityInspectionService],
})
export class QualityModule {}
