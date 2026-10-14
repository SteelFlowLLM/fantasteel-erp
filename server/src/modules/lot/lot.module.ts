import { Module } from '@nestjs/common';
import { LotController } from './lot.controller';
import { LotRepository } from './lot.repository';
import { LotService } from './lot.service';

/** LOT 조회·정·역추적 (REQ-LOT-001~005, BP-LOT-01). 작업 안내: docs/backend/lot.md */
@Module({
  controllers: [LotController],
  providers: [LotService, LotRepository],
  // AI 어시스턴트 LOT 추적 조회 도구가 쓴다
  exports: [LotService],
})
export class LotModule {}
