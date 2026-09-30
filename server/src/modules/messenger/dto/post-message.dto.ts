import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export const MESSAGE_CONTENT_MAX_LENGTH = 4000;

export class PostMessageDto {
  @IsString()
  @MaxLength(MESSAGE_CONTENT_MAX_LENGTH)
  content: string;

  /** 화면에서 고른 멘션 대상. 없으면 서버가 내용의 `@이름`을 방 멤버 이름과 맞춰 찾는다. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @Type(() => Number)
  @IsInt({ each: true })
  mentionEmployeeIds?: number[];
}
