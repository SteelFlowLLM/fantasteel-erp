import { Type } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';

export class ListSpecificConsumptionsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  rawMaterialId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  steelGradeId?: number;
}
