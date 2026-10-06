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
  // 판정 뒤 재고 반영(적격·자동 예약·불합격 배정 해제)은 inventory가 한다
  imports: [InventoryModule],
  // RejectedLotController가 먼저: 같은 모듈 안에서 고정 경로(lots/rejected)를 :id 경로보다 먼저 등록한다
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
