import { IsInt, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { IsCalendarDate, IsLinkPath } from './task-fields';

// 생략(undefined) = 변경 없음, null = 비움 (설명·마감일·이동 경로).
export class UpdateTaskDto {
  @ValidateIf((_o, v) => v !== undefined) @IsString() @MinLength(1) @MaxLength(200)
  title?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string | null;

  @ValidateIf((_o, v) => v !== undefined) @IsInt()
  assigneeId?: number;

  @IsOptional() @IsCalendarDate()
  dueDate?: string | null;

  @IsOptional() @IsLinkPath() @MaxLength(300)
  linkPath?: string | null;
}
