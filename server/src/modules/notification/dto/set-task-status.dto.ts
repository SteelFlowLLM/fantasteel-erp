import { IsIn } from 'class-validator';
import { TASK_STATUS } from '@fantasteel/shared';

export class SetTaskStatusDto {
  @IsIn(Object.values(TASK_STATUS))
  taskStatus: string;
}
