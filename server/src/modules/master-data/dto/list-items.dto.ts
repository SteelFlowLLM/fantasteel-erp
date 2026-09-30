import { IsIn, IsOptional } from 'class-validator';
import { ITEM_TYPE } from '@fantasteel/shared';
import { ListMasterDto } from './list-master.dto';

export class ListItemsDto extends ListMasterDto {
  @IsOptional()
  @IsIn(Object.values(ITEM_TYPE))
  itemType?: string;
}
