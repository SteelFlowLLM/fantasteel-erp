import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { LOT_STATUS, LOT_TYPE, type LotStatus, type LotType } from '@fantasteel/shared';

export class ListLotsDto {
  @IsOptional()
  @IsIn(Object.values(LOT_TYPE), { message: 'lotType 값이 올바르지 않습니다' })
  lotType?: LotType;

  @IsOptional()
  @IsIn(Object.values(LOT_STATUS), { message: 'lotStatus 값이 올바르지 않습니다' })
  lotStatus?: LotStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'productSpecId는 정수여야 합니다' })
  @Min(1, { message: 'productSpecId는 1 이상이어야 합니다' })
  productSpecId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'steelGradeId는 정수여야 합니다' })
  @Min(1, { message: 'steelGradeId는 1 이상이어야 합니다' })
  steelGradeId?: number;

  /** LOT 번호 일부 */
  @IsOptional()
  @IsString()
  @MaxLength(60, { message: '검색어는 60자 이하로 입력해 주세요' })
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit는 정수여야 합니다' })
  @Min(1, { message: 'limit는 1 이상이어야 합니다' })
  @Max(200, { message: 'limit는 200 이하여야 합니다' })
  limit?: number;
}
