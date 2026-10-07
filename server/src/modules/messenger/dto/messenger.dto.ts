import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CHAT_ROOM_NAME_MAX, CHAT_ROOM_TYPE, MESSAGE_CONTENT_MAX, MESSAGE_PAGE_SIZE_MAX, type ChatRoomType } from '@fantasteel/shared';

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
}
