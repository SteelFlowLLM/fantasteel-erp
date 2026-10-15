import { Module } from '@nestjs/common';
import { FactoryAgentModule } from '../factory-agent/factory-agent.module';
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
  // 판정 뒤 재고 반영(onLotsEligibilityChanged)을 같은 tx에서 부른다. 검사 등록 뒤 Agent 합격 매수 부족 감지(REQ-AGT-001)도 부른다
  imports: [InventoryModule, FactoryAgentModule],
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
  // AI 어시스턴트 검사 결과·불합격 LOT 조회 도구가 쓴다
  exports: [QualityService, RejectedLotService],
})
export class QualityModule {}
