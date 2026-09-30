import { Global, Module } from '@nestjs/common';
import { AttachmentInterceptor } from './attachment.interceptor';
import { ChatRoomController } from './chat-room.controller';
import { ChatRoomService } from './chat-room.service';
import { ChatSystemMessenger } from './chat-system-messenger';
import { ErpReferenceResolver } from './erp-reference.resolver';
import { MessageController } from './message.controller';
import { MessagePublisher } from './message.publisher';
import { MessageService } from './message.service';
import { MessengerRepository } from './messenger.repository';

// ChatSystemMessenger는 다른 모듈이 업무방에 시스템 메시지를 남길 때 쓰므로 전역으로 내보낸다.
// 실시간 연결(인증·사원별 채널)은 common의 RealtimeGateway가 맡고, 메시지 보내기는 REST로만 받는다.
@Global()
@Module({
  controllers: [ChatRoomController, MessageController],
  providers: [MessengerRepository, ErpReferenceResolver, MessagePublisher, ChatRoomService, MessageService, ChatSystemMessenger, AttachmentInterceptor],
  exports: [ChatSystemMessenger],
})
export class MessengerModule {}
