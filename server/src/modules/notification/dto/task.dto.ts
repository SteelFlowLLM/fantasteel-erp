import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { TASK_STATUS, type TaskStatus } from '@fantasteel/shared';

// 제목·설명 길이는 화면과 같은 가정값 (client/src/api/tasks.ts TASK_TITLE_MAX·TASK_DESCRIPTION_MAX)
export class CreateTaskDto {
  @IsString({ message: '제목을 입력해 주세요' })
  @IsNotEmpty({ message: '제목을 입력해 주세요' })
  @MaxLength(200, { message: '제목은 200자까지 쓸 수 있어요' })
  taskTitle!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: '설명은 2000자까지 쓸 수 있어요' })
  taskDescription?: string | null;

  @IsInt({ message: '담당자를 골라 주세요' })
  assigneeId!: number;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '마감일은 YYYY-MM-DD로 입력해 주세요' })
  dueDate!: string;
}

export class ListTasksQuery {
  @IsOptional()
  @IsIn(Object.values(TASK_STATUS), { message: '업무 상태 값이 올바르지 않아요' })
  taskStatus?: TaskStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size?: number;
}
