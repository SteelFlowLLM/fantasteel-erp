import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ITEM_TYPE, PRODUCTION_PLAN_STATUS, type ItemType, type ProductionPlanStatus } from '@fantasteel/shared';

const PRODUCT_TYPES = [ITEM_TYPE.SLAB, ITEM_TYPE.COIL];

export class ListProductionPlansDto {
  @IsOptional()
  @IsIn(Object.values(PRODUCTION_PLAN_STATUS), { message: '계획 상태는 PLANNED·IN_PROGRESS·COMPLETED·CANCELLED 중 하나여야 해요' })
  productionPlanStatus?: ProductionPlanStatus;

  @IsOptional()
  @IsIn(PRODUCT_TYPES, { message: '품목 유형은 SLAB 또는 COIL이어야 해요' })
  itemType?: ItemType;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '수주 id는 정수여야 해요' })
  @Min(1, { message: '수주 id는 1 이상이어야 해요' })
  salesOrderId?: number;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean({ message: 'isReproduction은 true 또는 false여야 해요' })
  isReproduction?: boolean;

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

export class CancelProductionPlanDto {
  @IsOptional()
  @IsString({ message: '사유는 문자열이어야 해요' })
  @MaxLength(200, { message: '사유는 200자까지 쓸 수 있어요' })
  reason?: string;
}

export class CreateReproductionPlanDto {
  @IsInt({ message: '수주 품목 id는 정수여야 해요' })
  @Min(1, { message: '수주 품목 id는 1 이상이어야 해요' })
  salesOrderItemId!: number;
}
