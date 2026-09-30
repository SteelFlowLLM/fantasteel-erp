import { IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsCalendarDate, IsLinkPath } from './task-fields';

export class CreateTaskDto {
  @IsString() @MinLength(1) @MaxLength(200)
  title: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  @IsInt()
  assigneeId: number;

  /** YYYY-MM-DD */
  @IsOptional() @IsCalendarDate()
  dueDate?: string;

  @IsOptional() @IsLinkPath() @MaxLength(300)
  linkPath?: string;
}
