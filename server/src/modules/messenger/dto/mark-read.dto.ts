import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class MarkReadDto {
  /** 여기까지 읽음. 없으면 방의 최신 메시지까지. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  lastReadMessageId?: number;
}
