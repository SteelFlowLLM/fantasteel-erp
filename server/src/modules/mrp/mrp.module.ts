import { Module } from '@nestjs/common';
import { MrpController } from './mrp.controller';
import { MrpRepository } from './mrp.repository';
import { MrpService } from './mrp.service';

// MRP 계산 (REQ-PRD-005). 구매요청 자동 생성은 P2라 여기서는 계산·저장·조회만 한다.
@Module({ controllers: [MrpController], providers: [MrpRepository, MrpService], exports: [MrpService] })
export class MrpModule {}
