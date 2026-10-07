import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { MessengerController } from './messenger.controller';
import { MessengerGateway } from './messenger.gateway';
import { MessengerRepository } from './messenger.repository';
import { MessengerService } from './messenger.service';

/** 채팅방·메시지·첨부·읽음·실시간 (REQ-MSG-001~006, BP-MSG-01). 작업 안내: docs/backend/messenger.md */
@Module({
  imports: [NotificationModule],
  controllers: [MessengerController],
  providers: [MessengerService, MessengerRepository, MessengerGateway],
})
export class MessengerModule {}
