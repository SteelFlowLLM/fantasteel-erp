import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';
import { PROCESS_CODE } from '@fantasteel/shared';

export class ListInspectionsDto {
  /** pending = 검사 대기 LOT(기본), done = 등록된 검사 */
  @IsOptional() @IsIn(['pending', 'done'])
  status?: 'pending' | 'done';

  /** STEELMAKING(히트 성분) | CASTING(슬래브) | HOT_ROLLING(코일) */
  @IsOptional() @IsIn([PROCESS_CODE.STEELMAKING, PROCESS_CODE.CASTING, PROCESS_CODE.HOT_ROLLING])
  processCode?: string;

  @IsOptional() @Type(() => Number) @IsInt()
  lotId?: number;
}
