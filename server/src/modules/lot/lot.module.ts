import { Module } from '@nestjs/common';
import { LotController } from './lot.controller';
import { LotRepository } from './lot.repository';
import { LotService } from './lot.service';

/** LOT 조회·정·역추적 (REQ-LOT-001~005, BP-LOT-01). 작업 안내: docs/backend/lot.md */
@Module({
  controllers: [LotController],
  providers: [LotService, LotRepository],
})
export class LotModule {}
