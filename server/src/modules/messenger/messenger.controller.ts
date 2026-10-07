import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import type { AuthUser, ChatMessagePage, ChatMessageView, ChatRoomDetail, ChatRoomListItem, CreateChatRoomResult } from '@fantasteel/shared';
import { CurrentUser } from '../../common/auth/auth.decorators';
import { CreateChatRoomDto, ListMessagesQuery, SendMessageDto } from './dto/messenger.dto';
import { MessengerService } from './messenger.service';

/**
 * 라우팅·DTO 검증·권한만 둔다. 업무 로직 금지 (컨벤션 6장).
 * 경로는 API 명세서와 docs/backend/messenger.md. 리소스가 여러 개라 메서드마다 전체 경로를 쓴다 (예: @Get('sales-orders/:id')).
 * 전역 prefix /api/v1은 main.ts가 붙인다. 메신저는 전 역할이라 권한 코드 없이 로그인만 보고, 방 멤버 확인은 service가 한다.
 */
@Controller()
export class MessengerController {
  constructor(private readonly service: MessengerService) {}

  /** 내가 멤버인 방 */
  @Get('chat-rooms')
  listRooms(@CurrentUser() user: AuthUser): Promise<ChatRoomListItem[]> {
    return this.service.listRooms(user);
  }

  /** 업무방은 연결 수주 조회 권한을 service가 확인한다 */
  @Post('chat-rooms')
  createRoom(@CurrentUser() user: AuthUser, @Body() dto: CreateChatRoomDto): Promise<CreateChatRoomResult> {
    return this.service.createRoom(user, dto);
  }

  @Get('chat-rooms/:id')
  getRoom(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number): Promise<ChatRoomDetail> {
    return this.service.getRoom(user, id);
  }

  @Get('chat-rooms/:id/messages')
  listMessages(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: ListMessagesQuery): Promise<ChatMessagePage> {
    return this.service.listMessages(user, id, query);
  }

  @Post('chat-rooms/:id/messages')
  sendMessage(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SendMessageDto): Promise<ChatMessageView> {
    return this.service.sendMessage(user, id, dto);
  }
}
