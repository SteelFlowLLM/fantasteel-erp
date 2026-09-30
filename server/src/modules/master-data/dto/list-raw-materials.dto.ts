import { IsIn, IsOptional } from 'class-validator';
import { RAW_MATERIAL_TYPE } from '@fantasteel/shared';
import { ListMasterDto } from './list-master.dto';

export class ListRawMaterialsDto extends ListMasterDto {
  @IsOptional()
  @IsIn(Object.values(RAW_MATERIAL_TYPE))
  rawMaterialType?: string;
}
