import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { InspectionStandardController } from './inspection-standard.controller';
import { InspectionStandardRepository } from './inspection-standard.repository';
import { InspectionStandardService } from './inspection-standard.service';
import { QualityController } from './quality.controller';
import { QualityRepository } from './quality.repository';
import { QualityService } from './quality.service';
import { RejectedLotController } from './rejected-lot.controller';
import { RejectedLotRepository } from './rejected-lot.repository';
import { RejectedLotService } from './rejected-lot.service';

/** 검사 기준·검사·자동 판정·불합격 처리 (REQ-QC-001~004, BP-QC-01). 작업 안내: docs/backend/quality.md */
@Module({
  // 판정 뒤 재고 반영(onLotsEligibilityChanged)을 같은 tx에서 부른다
  imports: [InventoryModule],
  // RejectedLotController가 먼저: quality-inspections/rejected-lots가 quality-inspections/:id보다 먼저 잡혀야 한다
  controllers: [RejectedLotController, QualityController, InspectionStandardController],
  providers: [
    QualityService,
    QualityRepository,
    InspectionStandardService,
    InspectionStandardRepository,
    RejectedLotService,
    RejectedLotRepository,
  ],
})
export class QualityModule {}
