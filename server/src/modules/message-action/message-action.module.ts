import { Module } from '@nestjs/common';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { MessageActionController } from './message-action.controller';
import { MessageActionRepository } from './message-action.repository';
import { MessageActionService } from './message-action.service';

/** Message → ERP 구매요청 초안 (REQ-ACT-001~004, BP-ACT-01). 작업 안내: docs/backend/message-action.md */
@Module({
  imports: [PurchasingModule],
  controllers: [MessageActionController],
  providers: [MessageActionService, MessageActionRepository],
})
export class MessageActionModule {}
