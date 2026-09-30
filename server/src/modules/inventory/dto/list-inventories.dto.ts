import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { ITEM_TYPE, type ItemType } from '@fantasteel/shared';

export class ListInventoriesDto {
  /** SLAB·COIL이면 제품만, RAW_MATERIAL이면 원료만. 없으면 둘 다 */
  @IsOptional()
  @IsIn(Object.values(ITEM_TYPE), { message: 'itemType은 RAW_MATERIAL, SLAB, COIL 중 하나여야 합니다' })
  itemType?: ItemType;

  /** 강종 코드 (SS275 등). 제품에만 적용 */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  steelGrade?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  productSpecId?: number;
}

export class ListSurplusDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  steelGrade?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  productSpecId?: number;
}
