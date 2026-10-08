import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { CHAT_ROOM_NAME_MAX, CHAT_ROOM_TYPE, MESSAGE_CONTENT_MAX, MESSAGE_PAGE_SIZE_MAX, MESSAGE_SEARCH_QUERY_MAX, type ChatRoomType } from '@fantasteel/shared';

export class CreateChatRoomDto {
  @IsIn(Object.values(CHAT_ROOM_TYPE), { message: '채팅방 유형은 DIRECT, GROUP, WORK 중 하나여야 해요' })
  chatRoomType!: ChatRoomType;

  /** 나를 뺀 멤버. 나는 자동으로 들어간다. 업무방은 비워도 된다 */
  @IsArray({ message: 'memberIds는 사원 id 배열이어야 해요' })
  @IsInt({ each: true, message: 'memberIds는 사원 id 배열이어야 해요' })
  memberIds!: number[];

  /** 그룹방만 쓴다 */
  @IsOptional()
  @IsString({ message: '방 이름은 글자여야 해요' })
  @MaxLength(CHAT_ROOM_NAME_MAX, { message: `방 이름은 ${CHAT_ROOM_NAME_MAX}자까지예요` })
  chatRoomName?: string | null;

  /** 업무방만, 필수 */
  @IsOptional()
  @IsInt({ message: 'salesOrderId는 수주 id여야 해요' })
  salesOrderId?: number | null;
}

export class ListMessagesQuery {
  /** 이 메시지 id보다 오래된 메시지 (이전 메시지 더 보기) */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'before는 메시지 id여야 해요' })
  @Min(1)
  before?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit는 정수여야 해요' })
  @Min(1)
  @Max(MESSAGE_PAGE_SIZE_MAX, { message: `limit는 ${MESSAGE_PAGE_SIZE_MAX}까지예요` })
  limit?: number;
}

export class SendMessageDto {
  @IsString({ message: '메시지는 글자여야 해요' })
  @MaxLength(MESSAGE_CONTENT_MAX, { message: `메시지는 ${MESSAGE_CONTENT_MAX}자까지 보낼 수 있어요` })
  content!: string;

  /** @멘션한 사원 (본문을 해석하지 않고 따로 받는다, 2026-10-07 결정). 방 멤버가 아니면 무시한다 */
  @IsOptional()
  @IsArray({ message: 'mentionedEmployeeIds는 사원 id 배열이어야 해요' })
  @IsInt({ each: true, message: 'mentionedEmployeeIds는 사원 id 배열이어야 해요' })
  mentionedEmployeeIds?: number[];

  /** 화면이 만든 보내기 id(UUID 권장). 같은 id로 다시 보내면 새로 저장하지 않고 처음 메시지를 돌려준다 (#151) */
  @IsOptional()
  @IsString({ message: 'clientMessageId는 글자여야 해요' })
  @MaxLength(64, { message: 'clientMessageId는 64자까지예요' })
  @Matches(/^[A-Za-z0-9-]+$/, { message: 'clientMessageId는 영문·숫자·-만 쓸 수 있어요' })
  clientMessageId?: string;

  /** 답글 대상 메시지 (같은 방, 삭제되지 않은 일반 메시지) */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'parentMessageId는 메시지 id여야 해요' })
  parentMessageId?: number;
}

export class MarkReadDto {
  /** 화면에서 마지막으로 본 메시지 id. 이 방의 메시지여야 한다 */
  @IsInt({ message: 'lastMessageId는 메시지 id여야 해요' })
  lastMessageId!: number;
}

/** 첨부 업로드(multipart)의 글 필드. 파일은 file 필드로 받는다 */
export class UploadAttachmentDto {
  @IsOptional()
  @IsString({ message: '메시지는 글자여야 해요' })
  @MaxLength(MESSAGE_CONTENT_MAX, { message: `메시지는 ${MESSAGE_CONTENT_MAX}자까지 보낼 수 있어요` })
  content?: string;

  /** 화면이 만든 보내기 id(UUID 권장). 같은 id로 다시 보내면 새로 저장하지 않고 처음 메시지를 돌려준다 (#151) */
  @IsOptional()
  @IsString({ message: 'clientMessageId는 글자여야 해요' })
  @MaxLength(64, { message: 'clientMessageId는 64자까지예요' })
  @Matches(/^[A-Za-z0-9-]+$/, { message: 'clientMessageId는 영문·숫자·-만 쓸 수 있어요' })
  clientMessageId?: string;

  /** 답글 대상 메시지 (같은 방, 삭제되지 않은 일반 메시지) */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'parentMessageId는 메시지 id여야 해요' })
  parentMessageId?: number;
}

export class InviteMembersDto {
  /** 초대할 사원. 이미 멤버인 사원은 건너뛴다 */
  @IsArray({ message: 'memberIds는 사원 id 배열이어야 해요' })
  @IsInt({ each: true, message: 'memberIds는 사원 id 배열이어야 해요' })
  memberIds!: number[];
}

export class RenameChatRoomDto {
  /** 비우면 이름 없음(null) */
  @IsOptional()
  @IsString({ message: '방 이름은 글자여야 해요' })
  @MaxLength(CHAT_ROOM_NAME_MAX, { message: `방 이름은 ${CHAT_ROOM_NAME_MAX}자까지예요` })
  chatRoomName?: string | null;
}

export class SearchMessagesQuery {
  /** 본문에 들어 있는 글자 (대소문자 무시) */
  @IsString({ message: '검색어를 넣어 주세요' })
  @MaxLength(MESSAGE_SEARCH_QUERY_MAX, { message: `검색어는 ${MESSAGE_SEARCH_QUERY_MAX}자까지예요` })
  q!: string;

  /** 이 메시지 id보다 오래된 결과 (더 보기) */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'before는 메시지 id여야 해요' })
  @Min(1)
  before?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit는 정수여야 해요' })
  @Min(1)
  @Max(MESSAGE_PAGE_SIZE_MAX, { message: `limit는 ${MESSAGE_PAGE_SIZE_MAX}까지예요` })
  limit?: number;
}

export class EditMessageDto {
  /** 첨부가 있는 메시지는 비울 수 있다 */
  @IsString({ message: '메시지는 글자여야 해요' })
  @MaxLength(MESSAGE_CONTENT_MAX, { message: `메시지는 ${MESSAGE_CONTENT_MAX}자까지 보낼 수 있어요` })
  content!: string;
}
