import { Global, Module } from '@nestjs/common';
import { LotGraphModule } from '../lot/lot-graph.module';
import { BusinessEventController } from './business-event.controller';
import { BusinessEventRecorder } from './business-event.recorder';
import { BusinessEventRepository } from './business-event.repository';
import { BusinessEventService } from './business-event.service';

// 기록기는 모든 모듈이 쓰므로 전역. 조회 API는 LOT 관계 탐색(LotGraphModule)을 쓴다.
@Global()
@Module({
  imports: [LotGraphModule],
  controllers: [BusinessEventController],
  providers: [BusinessEventRecorder, BusinessEventRepository, BusinessEventService],
  exports: [BusinessEventRecorder],
})
export class BusinessEventModule {}
