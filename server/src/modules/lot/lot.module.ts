import { Module } from '@nestjs/common';
import { LotGraphModule } from './lot-graph.module';
import { LotController } from './lot.controller';
import { LotTraceService } from './lot-trace.service';
import { LotRepository } from './lot.repository';
import { LotService } from './lot.service';

@Module({
  imports: [LotGraphModule],
  controllers: [LotController],
  providers: [LotRepository, LotService, LotTraceService],
})
export class LotModule {}
