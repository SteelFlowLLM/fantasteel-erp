import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { TASK_SCOPES, TASK_STATUS, type TaskScope, type TaskStatus } from '@fantasteel/shared';

/** 연결 화면: '/'로 시작하는 화면 경로 (화면 isScreenPath와 같은 규칙, 300자) */
const SCREEN_PATH = /^\/(?!\/)\S{0,299}$/;
const SCREEN_PATH_MESSAGE = '"/"로 시작하는 화면 경로만 넣을 수 있어요 (예: /goods-receipts)';

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

  /** 메신저 메시지에서 등록할 때 원본 메시지 (16번, 명세에 없는 값). 그 방 멤버만, 삭제·시스템 메시지는 안 된다 */
  @IsOptional()
  @IsInt({ message: '메시지 id가 올바르지 않아요' })
  messageId?: number;

  @IsOptional()
  @Matches(SCREEN_PATH, { message: SCREEN_PATH_MESSAGE })
  linkPath?: string | null;
}

/** API-274. 보내지 않은 칸은 그대로 두고, 설명·연결 화면은 null이면 비운다 */
export class UpdateTaskDto {
  @IsOptional()
  @IsString({ message: '제목을 입력해 주세요' })
  @IsNotEmpty({ message: '제목을 입력해 주세요' })
  @MaxLength(200, { message: '제목은 200자까지 쓸 수 있어요' })
  taskTitle?: string;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(2000, { message: '설명은 2000자까지 쓸 수 있어요' })
  taskDescription?: string | null;

  @IsOptional()
  @IsInt({ message: '담당자를 골라 주세요' })
  assigneeId?: number;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '마감일은 YYYY-MM-DD로 입력해 주세요' })
  dueDate?: string;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Matches(SCREEN_PATH, { message: SCREEN_PATH_MESSAGE })
  linkPath?: string | null;
}

export class ListTasksQuery {
  @IsOptional()
  @IsIn(Object.values(TASK_STATUS), { message: '업무 상태 값이 올바르지 않아요' })
  taskStatus?: TaskStatus;

  /** 없으면 mine(내 담당) */
  @IsOptional()
  @IsIn(TASK_SCOPES, { message: '업무 범위 값이 올바르지 않아요' })
  scope?: TaskScope;

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
