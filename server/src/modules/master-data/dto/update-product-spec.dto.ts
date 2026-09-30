import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { NumericInput } from './numeric';

/**
 * 제품 규격 수정. 사용된 규격(수주·재고·LOT가 참조)은 강종·치수를 바꿀 수 없다 (MST-002).
 * 값이 현재와 같으면 바꾼 것으로 보지 않는다. 품목(슬래브/코일)은 바꿀 수 없다.
 */
export class UpdateProductSpecDto {
  @IsOptional()
  @IsInt()
  steelGradeId?: number;

  @IsOptional()
  @NumericInput()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(2000)
  thicknessMm?: number;

  @IsOptional()
  @NumericInput()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(5000)
  widthMm?: number;

  @IsOptional()
  @NumericInput()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(5000000)
  lengthMm?: number;

  @IsOptional()
  @IsInt()
  yardId?: number | null;
}
