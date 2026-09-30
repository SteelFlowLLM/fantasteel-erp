import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';

export const INSPECTION_PROCESS_CODES = ['CASTING', 'HOT_ROLLING'] as const;

export class ListInspectionItemsDto {
  @IsOptional()
  @IsIn(INSPECTION_PROCESS_CODES)
  processCode?: string;

  /** 강종 id. 그 강종 전용 항목과 공통(강종 없음) 항목을 함께 준다. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  steelGradeId?: number;
}
