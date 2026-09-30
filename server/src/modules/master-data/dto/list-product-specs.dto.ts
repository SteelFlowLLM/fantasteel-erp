import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';
import { ITEM_TYPE } from '@fantasteel/shared';
import { ListMasterDto } from './list-master.dto';

export class ListProductSpecsDto extends ListMasterDto {
  @IsOptional()
  @IsIn([ITEM_TYPE.SLAB, ITEM_TYPE.COIL])
  itemType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  steelGradeId?: number;
}
