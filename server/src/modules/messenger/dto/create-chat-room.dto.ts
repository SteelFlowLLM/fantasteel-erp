import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { CHAT_ROOM_TYPE, type ChatRoomType } from '@fantasteel/shared';

export class CreateChatRoomDto {
  @IsIn(Object.values(CHAT_ROOM_TYPE))
  chatRoomType: ChatRoomType;

  /** 조직도에서 고른 사원 id. 만든 사람은 넣지 않아도 항상 포함된다. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @Type(() => Number)
  @IsInt({ each: true })
  memberIds?: number[];

  @IsOptional()
  @IsString()
  @MaxLength(50)
  chatRoomName?: string;

  /** 업무방(WORK)일 때 필수 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  salesOrderId?: number;
}
