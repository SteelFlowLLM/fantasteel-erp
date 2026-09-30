import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { ITEM_TYPE, PRODUCTION_PLAN_STATUS } from '@fantasteel/shared';

export class ListProductionPlansDto {
  @IsOptional() @IsIn(Object.values(PRODUCTION_PLAN_STATUS))
  status?: string;

  @IsOptional() @IsIn([ITEM_TYPE.SLAB, ITEM_TYPE.COIL])
  itemType?: string;

  /** true = 편성 전이거나 대기·작업 중인 실적이 있는 계획만 */
  @IsOptional() @Transform(({ value }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value)) @IsBoolean()
  needsAction?: boolean;
}
