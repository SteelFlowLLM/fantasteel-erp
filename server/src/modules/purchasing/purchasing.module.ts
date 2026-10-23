import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { PurchasingController } from './purchasing.controller';
import { PurchasingRepository } from './purchasing.repository';
import { PurchasingService } from './purchasing.service';

/** 구매요청·부서장 승인·발주·입고 (REQ-PUR-001~004, BP-PUR-01·02). 작업 안내: docs/backend/purchasing.md */
@Module({
  // 승인 요청·결과 알림을 본 거래 tx에서 보낸다
  imports: [NotificationModule],
  controllers: [PurchasingController],
  providers: [PurchasingService, PurchasingRepository],
  // message-action이 초안 확정 트랜잭션에서 createRequisition을 부른다
  exports: [PurchasingService],
})
export class PurchasingModule {}
