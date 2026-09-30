import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListNotificationsDto {
  @IsOptional() @Transform(({ value }) => value === true || value === 'true' || value === '1') @IsBoolean()
  unreadOnly?: boolean;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  /** 이전 응답의 nextCursor. 이 id보다 오래된 알림부터 준다. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  cursor?: number;
}
