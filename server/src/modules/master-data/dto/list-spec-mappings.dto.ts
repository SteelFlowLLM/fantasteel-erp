import { Type } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';

export class ListSpecMappingsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  steelGradeId?: number;
}
