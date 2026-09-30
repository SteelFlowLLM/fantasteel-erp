import { IsIn, IsOptional } from 'class-validator';
import { YARD_TYPE } from '@fantasteel/shared';
import { ListMasterDto } from './list-master.dto';

export class ListYardsDto extends ListMasterDto {
  @IsOptional()
  @IsIn(Object.values(YARD_TYPE))
  yardType?: string;
}
