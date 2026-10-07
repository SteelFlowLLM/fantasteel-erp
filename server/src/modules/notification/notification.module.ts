import { Module } from '@nestjs/common';
import { OrganizationModule } from '../organization/organization.module';
import { NotificationController } from './notification.controller';
import { NotificationRepository } from './notification.repository';
import { NotificationService } from './notification.service';

/** 업무·알림 (REQ-NTF-001~002). 작업 안내: docs/backend/notification.md */
@Module({
  imports: [OrganizationModule],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationRepository],
  // 다른 모듈(구매·메신저 등)이 본 거래 tx에서 notifyEmployees·notifyDepartment를 부른다
  exports: [NotificationService],
})
export class NotificationModule {}
