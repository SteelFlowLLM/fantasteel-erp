import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import type { AuthUser } from '@fantasteel/shared';
import { CurrentUser, RequireView } from '../../common/auth/auth.decorators';
import { AttachmentInterceptor } from './attachment.interceptor';
import { ChatRoomService, SALES_ORDER_VIEW_PERMISSIONS } from './chat-room.service';
import { AddChatRoomMembersDto } from './dto/add-chat-room-members.dto';
import { CreateChatRoomDto } from './dto/create-chat-room.dto';
import { ListMessagesDto } from './dto/list-messages.dto';
import { MarkReadDto } from './dto/mark-read.dto';
import { PostMessageDto } from './dto/post-message.dto';
import { UploadFileDto } from './dto/upload-file.dto';
import { WorkRoomQueryDto } from './dto/work-room-query.dto';
import { MessageService, type UploadedAttachment } from './message.service';

/** 메신저는 역할 권한이 아니라 방 멤버 여부로 막는다 (service에서 검사). */
@Controller('chat-rooms')
export class ChatRoomController {
  constructor(
    private readonly rooms: ChatRoomService,
    private readonly messages: MessageService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.rooms.list(user);
  }

  @Post()
  create(@Body() dto: CreateChatRoomDto, @CurrentUser() user: AuthUser) {
    return this.rooms.create(dto, user);
  }

  // 고정 경로는 ':id'보다 먼저 둔다
  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.rooms.unreadCount(user);
  }

  /** ERP 화면의 "업무방" 버튼. 없으면 만들고 나를 멤버로 넣으므로 GET이지만 데이터가 바뀔 수 있다. */
  @Get('work-room')
  @RequireView(...SALES_ORDER_VIEW_PERMISSIONS)
  workRoom(@Query() query: WorkRoomQueryDto, @CurrentUser() user: AuthUser) {
    return this.rooms.openWorkRoom(query.salesOrderId, user);
  }

  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.rooms.detail(id, user);
  }

  @Post(':id/members')
  @HttpCode(200)
  addMembers(@Param('id', ParseIntPipe) id: number, @Body() dto: AddChatRoomMembersDto, @CurrentUser() user: AuthUser) {
    return this.rooms.addMembers(id, dto, user);
  }

  @Delete(':id/members/me')
  leave(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.rooms.leave(id, user);
  }

  @Get(':id/messages')
  listMessages(@Param('id', ParseIntPipe) id: number, @Query() query: ListMessagesDto, @CurrentUser() user: AuthUser) {
    return this.messages.list(id, query, user);
  }

  @Post(':id/messages')
  postMessage(@Param('id', ParseIntPipe) id: number, @Body() dto: PostMessageDto, @CurrentUser() user: AuthUser) {
    return this.messages.post(id, dto, user);
  }

  @Post(':id/files')
  @UseInterceptors(AttachmentInterceptor)
  postFile(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: UploadedAttachment | undefined,
    @Body() dto: UploadFileDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.messages.postFile(id, file, dto?.content, user);
  }

  @Put(':id/read')
  markRead(@Param('id', ParseIntPipe) id: number, @Body() dto: MarkReadDto, @CurrentUser() user: AuthUser) {
    return this.rooms.markRead(id, dto, user);
  }
}
