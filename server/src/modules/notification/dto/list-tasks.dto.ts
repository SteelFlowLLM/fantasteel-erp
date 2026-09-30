import { IsIn, IsOptional } from 'class-validator';
import { TASK_STATUS } from '@fantasteel/shared';

export const TASK_SCOPE = { MINE: 'mine', CREATED: 'created', ALL: 'all' } as const;
export type TaskScope = (typeof TASK_SCOPE)[keyof typeof TASK_SCOPE];

export class ListTasksDto {
  /** mine=내가 담당(기본), created=내가 만든 것, all=내가 담당하거나 만든 것 */
  @IsOptional() @IsIn(Object.values(TASK_SCOPE))
  scope?: TaskScope;

  @IsOptional() @IsIn(Object.values(TASK_STATUS))
  status?: string;
}
