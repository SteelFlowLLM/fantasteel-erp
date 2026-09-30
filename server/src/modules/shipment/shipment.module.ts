import { Module } from '@nestjs/common';
import { GoodsIssueController } from './goods-issue.controller';
import { GoodsIssueService } from './goods-issue.service';
import { MillSheetPdfRenderer } from './mill-sheet-pdf.renderer';
import { MillSheetController } from './mill-sheet.controller';
import { MillSheetRepository } from './mill-sheet.repository';
import { MillSheetService } from './mill-sheet.service';
import { ShipmentRequestController } from './shipment-request.controller';
import { ShipmentRequestService } from './shipment-request.service';
import { ShipmentRepository } from './shipment.repository';

// ShipmentRequestService는 수주 취소(미출고 출하요청 취소)에서도 쓰므로 내보낸다.
@Module({
  controllers: [ShipmentRequestController, GoodsIssueController, MillSheetController],
  providers: [ShipmentRequestService, GoodsIssueService, MillSheetService, MillSheetRepository, MillSheetPdfRenderer, ShipmentRepository],
  exports: [ShipmentRequestService],
})
export class ShipmentModule {}
