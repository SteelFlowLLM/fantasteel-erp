import { Module } from '@nestjs/common';
import { ShipmentController } from './shipment.controller';
import { ShipmentRepository } from './shipment.repository';
import { ShipmentService } from './shipment.service';

/** 출하요청·출고 확정·밀시트 (REQ-SHP-001~004, BP-SHP-01). 작업 안내: docs/backend/shipment.md */
@Module({
  controllers: [ShipmentController],
  providers: [ShipmentService, ShipmentRepository],
})
export class ShipmentModule {}
