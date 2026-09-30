import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { NumericInput } from './numeric';

/** 공정·강종·항목 코드는 바꿀 수 없다 (다르게 쓰려면 새 항목을 등록). */
export class UpdateInspectionItemDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  inspectionItemName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string | null;

  @IsOptional()
  @NumericInput()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(-1000000)
  @Max(1000000)
  minValue?: number | null;

  @IsOptional()
  @NumericInput()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(-1000000)
  @Max(1000000)
  maxValue?: number | null;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
