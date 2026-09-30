import { Global, Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationRepository } from './notification.repository';
import { NotificationSender } from './notification.sender';
import { NotificationService } from './notification.service';
import { TaskController } from './task.controller';
import { TaskRepository } from './task.repository';
import { TaskService } from './task.service';

// 알림·업무 조회 API + 발송기. 발송기는 모든 모듈이 쓰므로 전역.
@Global()
@Module({
  controllers: [NotificationController, TaskController],
  providers: [NotificationSender, NotificationService, NotificationRepository, TaskService, TaskRepository],
  exports: [NotificationSender],
})
export class NotificationModule {}
