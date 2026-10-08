import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MESSAGE_ATTACHMENT_MAX_BYTES, type AuthUser, type ChatMessagePage, type ChatMessageView, type ChatRoomDetail, type ChatRoomListItem, type ChatRoomReadResult, type CreateChatRoomResult, type InviteChatMembersResult, type RenameChatRoomResult } from '@fantasteel/shared';
import { CurrentUser } from '../../common/auth/auth.decorators';
import { CreateChatRoomDto, EditMessageDto, InviteMembersDto, ListMessagesQuery, MarkReadDto, RenameChatRoomDto, SearchMessagesQuery, SendMessageDto, UploadAttachmentDto } from './dto/messenger.dto';
import { MessengerService, type UploadedAttachment } from './messenger.service';

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

  /** 그룹방 이름 바꾸기 (명세에 없는 API, 방 관리) */
  @Patch('chat-rooms/:id')
  renameRoom(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: RenameChatRoomDto): Promise<RenameChatRoomResult> {
    return this.service.renameRoom(user, id, dto);
  }

  /** 멤버 초대 (명세에 없는 API, 방 관리). 1:1 방은 안 된다 */
  @Post('chat-rooms/:id/members')
  inviteMembers(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: InviteMembersDto): Promise<InviteChatMembersResult> {
    return this.service.inviteMembers(user, id, dto);
  }

  @Get('chat-rooms/:id/messages')
  listMessages(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: ListMessagesQuery): Promise<ChatMessagePage> {
    return this.service.listMessages(user, id, query);
  }

  /** 방 안 메시지 검색 (명세에 없는 API, 편의 기능) */
  @Get('chat-rooms/:id/messages/search')
  searchMessages(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: SearchMessagesQuery): Promise<ChatMessagePage> {
    return this.service.searchMessages(user, id, query);
  }

  /** 파일 모아보기: 첨부가 있는 메시지만 (명세에 없는 API, 편의 기능) */
  @Get('chat-rooms/:id/attachments')
  listAttachments(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: ListMessagesQuery): Promise<ChatMessagePage> {
    return this.service.listAttachments(user, id, query);
  }

  @Post('chat-rooms/:id/messages')
  sendMessage(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SendMessageDto): Promise<ChatMessageView> {
    return this.service.sendMessage(user, id, dto);
  }

  /** 내 메시지 고치기 (명세에 없는 API, #151) */
  @Patch('messages/:id')
  editMessage(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: EditMessageDto): Promise<ChatMessageView> {
    return this.service.editMessage(user, id, dto);
  }

  /** 내 메시지 삭제 — 삭제 표시만 한다 (명세에 없는 API, #151) */
  @Delete('messages/:id')
  deleteMessage(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number): Promise<ChatMessageView> {
    return this.service.deleteMessage(user, id);
  }

  /** 업로드 = 메시지 1건 생성. multipart: file(파일), content(글, 선택). 용량을 넘으면 multer가 끝까지 읽지 않고 413(COM-004)으로 끊는다 */
  @Post('chat-rooms/:id/attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MESSAGE_ATTACHMENT_MAX_BYTES, files: 1 } }))
  sendAttachment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: UploadedAttachment | undefined,
    @Body() dto: UploadAttachmentDto,
  ): Promise<ChatMessageView> {
    return this.service.sendAttachment(user, id, file, dto);
  }

  /** id는 메시지 id. 응답 포맷으로 감싸지 않고 파일 그대로 보낸다 */
  @Get('attachments/:id')
  async readAttachment(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number): Promise<StreamableFile> {
    const { fileName, content } = await this.service.readAttachment(user, id);
    return new StreamableFile(content, {
      type: 'application/octet-stream',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      length: content.length,
    });
  }

  @Post('chat-rooms/:id/read')
  @HttpCode(200)
  markRead(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: MarkReadDto): Promise<ChatRoomReadResult> {
    return this.service.markRead(user, id, dto);
  }
}
