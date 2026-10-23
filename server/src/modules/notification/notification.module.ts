import { forwardRef, Module } from '@nestjs/common';
import { IntegrationModule } from '../integration/integration.module';
import { OrganizationModule } from '../organization/organization.module';
import { NotificationController } from './notification.controller';
import { NotificationRepository } from './notification.repository';
import { NotificationService } from './notification.service';
import { TaskRepository } from './task.repository';
import { TaskService } from './task.service';

/**
 * 업무·알림 (REQ-NTF-001~002). 작업 안내: docs/backend/notification.md
 * 연동 장애 알림(이슈 #518)이 IntegrationModule에서 NotificationService를 쓰고 업무가 NotionWorkspaceService를 써서 두 모듈이 서로 가져오므로 forwardRef로 잇는다.
 */
@Module({
  imports: [OrganizationModule, forwardRef(() => IntegrationModule)],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationRepository, TaskService, TaskRepository],
  // 다른 모듈(구매·메신저 등)이 본 거래 tx에서 notifyEmployees·notifyDepartment를 부르고, 회의록 확정이 TaskService.createInTx를 부른다
  exports: [NotificationService, TaskService],
})
export class NotificationModule {}
