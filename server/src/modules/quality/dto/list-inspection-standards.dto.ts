import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import type { ProcessType } from '@fantasteel/shared';
import { INSPECTED_PROCESS_TYPES } from './list-quality-inspections.dto';

export class ListInspectionStandardsDto {
  @IsOptional()
  @IsIn(INSPECTED_PROCESS_TYPES, { message: '공정은 제강·연주·열연 중 하나여야 해요' })
  processType?: ProcessType;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '강종 id는 정수여야 해요' })
  @Min(1, { message: '강종 id는 1 이상이어야 해요' })
  steelGradeId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page는 정수여야 해요' })
  @Min(1, { message: 'page는 1 이상이어야 해요' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'size는 정수여야 해요' })
  @Min(1, { message: 'size는 1 이상이어야 해요' })
  @Max(100, { message: 'size는 100 이하여야 해요' })
  size?: number;
}
