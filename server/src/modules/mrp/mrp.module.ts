import { Module } from '@nestjs/common';
import { MrpController } from './mrp.controller';
import { MrpRepository } from './mrp.repository';
import { MrpService } from './mrp.service';

/** MRP 소요량 계산 조회 (REQ-PRD-005, BP-PRD-01). 작업 안내: docs/backend/mrp.md */
@Module({
  controllers: [MrpController],
  providers: [MrpService, MrpRepository],
  // factory-agent의 원료 부족 규칙이 같은 계산을 쓴다 (REQ-AGT-002)
  exports: [MrpService],
})
export class MrpModule {}
