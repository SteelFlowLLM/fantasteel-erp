import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

/** 재생산 계획 (REQ-PRD-006). 매수는 서버가 계산한다. */
export class CreateReproductionPlanDto {
  @IsInt()
  salesOrderItemId: number;

  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}

export class ReproductionPreviewDto {
  @Type(() => Number) @IsInt()
  salesOrderItemId: number;
}
