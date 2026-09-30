import { IsIn, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { ITEM_TYPE } from '@fantasteel/shared';
import { NumericInput } from './numeric';

/**
 * 제품 규격 등록. 이론중량은 받지 않는다 — 서버가 치수로 계산한다 (REQ-MST-003).
 * 품목은 itemId 또는 itemType(SLAB|COIL) 중 하나로 정한다.
 */
export class CreateProductSpecDto {
  @IsOptional()
  @IsInt()
  itemId?: number;

  @IsOptional()
  @IsIn([ITEM_TYPE.SLAB, ITEM_TYPE.COIL])
  itemType?: string;

  @IsInt()
  steelGradeId: number;

  @NumericInput()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(2000)
  thicknessMm: number;

  @NumericInput()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(5000)
  widthMm: number;

  @NumericInput()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(5000000)
  lengthMm: number;

  @IsOptional()
  @IsInt()
  yardId?: number | null;
}
