import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';
import { PROCESS_CODE, PRODUCTION_RESULT_STATUS } from '@fantasteel/shared';

export class ListProductionResultsDto {
  @IsOptional() @Type(() => Number) @IsInt()
  planId?: number;

  @IsOptional() @IsIn(Object.values(PROCESS_CODE))
  processCode?: string;

  @IsOptional() @IsIn(Object.values(PRODUCTION_RESULT_STATUS))
  status?: string;
}
